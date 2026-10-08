import { expect, test } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteMetadata, DiskObjects } from "./node";
import { prepareMetadata } from "./migrations";
import { Revisions } from "./revisions";
import {
  canonical,
  snapshotRevision,
  syncProtocol,
  type ProjectSnapshot,
} from "../sync/protocol";

test("explicit inline conversion preserves revision, source, parent order and sequence and can roll back", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-manifest-migration-")),
    db = new SQLiteMetadata(join(home, "metadata.sqlite")),
    objects = new DiskObjects(join(home, "objects"));
  try {
    await prepareMetadata(db, true);
    await db.run(
      "INSERT INTO users(id,name,password_salt,password_hash,created_at) VALUES('user','User','salt','hash','2026-01-01')",
    );
    await db.run(
      "INSERT INTO projects(id,name,created_at) VALUES('project','Project','2026-01-01')",
    );
    let parent: string | undefined;
    const original: string[] = [];
    for (let sequence = 1; sequence <= 3; sequence++) {
      const snapshot: ProjectSnapshot = {
        format: syncProtocol,
        projectId: "project",
        parents: parent ? [parent] : [],
        files: { "projects/project/project.json": "a".repeat(64) },
        change: {
          at: "2026-01-01T00:00:00Z",
          actor: { kind: "unknown" },
          channel: "external",
          operationId: `original-${sequence}`,
          paths: [],
        },
      };
      const revision = await snapshotRevision(snapshot),
        serialized = canonical(snapshot);
      await db.run(
        "INSERT INTO revisions(project_id,revision,manifest,user_id,created_at,sequence,manifest_bytes,published) VALUES('project',?,?,'user','2026-01-01',?,?,1)",
        [revision, serialized, sequence, Buffer.byteLength(serialized)],
      );
      original.push(revision);
      parent = revision;
    }
    const store = new Revisions(db, objects);
    expect((await store.migrateInline(undefined, 2)).migrated).toBe(2);
    expect((await store.migrateInline(undefined, 2)).migrated).toBe(1);
    expect((await store.migrateInline()).migrated).toBe(0);
    const rows = await db.all<{
      revision: string;
      sequence: number;
      created_at: string;
      user_id: string;
      manifest_key: string;
    }>("SELECT * FROM revisions ORDER BY sequence");
    expect(rows.map((row) => row.revision)).toEqual(original);
    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(
      rows.every(
        (row) => row.user_id === "user" && row.created_at === "2026-01-01",
      ),
    ).toBe(true);
    const first = (await store.row("project", original[0]))!;
    const path = join(objects.root, first.manifest_key!);
    const bytes = await readFile(path);
    await writeFile(path, "corrupt manifest");
    await expect(store.snapshot("project", first)).rejects.toMatchObject({
      code: "CORRUPT_MANIFEST",
    });
    await writeFile(path, bytes);
    await db.run(
      "UPDATE revisions SET manifest_key=NULL,manifest_digest=NULL WHERE project_id='project'",
    );
    expect(
      (
        await store.snapshot(
          "project",
          (await store.row("project", original[2]))!,
        )
      ).parents,
    ).toEqual([original[1]]);
  } finally {
    db.close();
    await rm(home, { recursive: true });
  }
});
