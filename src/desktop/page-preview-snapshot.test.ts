import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteLibrary } from "../core/sqlite-library";
import { libraryReadSnapshot, readLibraryFile } from "../core/library-runtime";
import { pagePreviewSnapshot } from "./page-preview-snapshot";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const context = {
  actor: { kind: "human" as const },
  channel: "desktop" as const,
};

it("releases the writer lease before compilation and keeps captured source bytes pinned", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-preview-snapshot-"));
  roots.push(root);
  const library = new SqliteLibrary(root);
  await library.initialize();
  const path = "projects/project-a/packages/components/chart/1.0.0/source.ts";
  await library.writeFiles(
    new Map([[path, Buffer.from("export const value = 1;")]]),
    context,
  );
  const snapshot = await pagePreviewSnapshot(root, "project-a", "page-a");
  expect(snapshot).toBeDefined();
  await expect(access(join(root, "local/writer.lock"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await library.writeFiles(
    new Map([[path, Buffer.from("export const value = 2;")]]),
    context,
  );
  expect((await library.readFile(path)).toString()).toContain("value = 2");
  const frozen = await libraryReadSnapshot.run(snapshot!, () =>
    readLibraryFile(root, join(root, "workspace", path)),
  );
  expect(frozen?.toString()).toContain("value = 1");
});

it("limits frozen package inputs to the target project and shared catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-preview-scope-"));
  roots.push(root);
  const library = new SqliteLibrary(root);
  await library.initialize();
  const shared = "packages/components/shared/1.0.0/index.ts",
    other = "projects/project-b/packages/components/private/1.0.0/index.ts";
  await library.writeFiles(
    new Map([
      [shared, Buffer.from("shared source")],
      [other, Buffer.from("other source")],
    ]),
    context,
  );
  const snapshot = await pagePreviewSnapshot(root, "project-a", "page-a");
  expect((await snapshot!.library.readFile(shared)).toString()).toBe(
    "shared source",
  );
  await expect(snapshot!.library.readFile(other)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
