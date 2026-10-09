import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import {
  verifyServerBackup,
  readBackupDescriptor,
  loadBackupMetadata,
} from "./backup";
import { SQLiteMetadata, DiskObjects } from "./node-storage";
import type { SqlValue } from "./storage";
import { Revisions } from "./revisions";

async function* rows(path: string) {
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of lines)
    yield JSON.parse(line) as Record<string, SqlValue>;
}
/** This report is bound to a verified frozen backup generation. It deliberately
 * performs no deletion and retains all history, reservations and upload tasks. */
export async function planServerCleanup(input: {
  backup: string;
  destination: string;
  retentionDays?: number;
}) {
  if (!isAbsolute(input.backup) || !isAbsolute(input.destination))
    throw new Error("Cleanup report paths must be absolute.");
  const retentionDays = input.retentionDays ?? 30;
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 30 ||
    retentionDays > 3650
  )
    throw new Error("Retention must be between 30 and 3650 days.");
  const verified = await verifyServerBackup(input.backup);
  const descriptorBytes = await readFile(join(input.backup, "backup.json"));
  const descriptor = JSON.parse(descriptorBytes.toString("utf8"));
  const temporary = await mkdtemp(join(tmpdir(), "showai-cleanup-plan-"));
  const db = new SQLiteMetadata(join(temporary, "metadata.sqlite"));
  const file = await open(input.destination, "wx", 0o600);
  let candidates = 0,
    candidateBytes = 0,
    protectedObjects = 0,
    recentObjects = 0,
    unknownAge = 0;
  try {
    await loadBackupMetadata(
      input.backup,
      db,
      await readBackupDescriptor(input.backup),
    );
    await db.run("CREATE TEMP TABLE reachable_objects(key TEXT PRIMARY KEY)");
    await db.run(
      "INSERT OR IGNORE INTO reachable_objects SELECT manifest_key FROM revisions WHERE manifest_key IS NOT NULL",
    );
    await db.run(
      "INSERT OR IGNORE INTO reachable_objects SELECT 'projects/'||project_id||'/'||CASE kind WHEN 'manifest' THEN 'manifests' ELSE 'objects' END||'/'||digest FROM storage_reservations",
    );
    await db.run(
      "INSERT OR IGNORE INTO reachable_objects SELECT 'projects/'||project_id||'/objects/'||digest FROM object_uploads",
    );
    await db.run(
      "INSERT OR IGNORE INTO reachable_objects SELECT 'projects/'||u.project_id||'/uploads/'||u.id||'/parts/'||p.digest FROM object_upload_parts p JOIN object_uploads u ON u.id=p.upload_id",
    );
    const revisions = new Revisions(
      db,
      new DiskObjects(join(input.backup, "objects")),
    );
    let cursor = 0;
    while (true) {
      const selected = await db.all<{
        cursor: number;
        project_id: string;
        revision: string;
      }>(
        "SELECT rowid AS cursor,project_id,revision FROM revisions WHERE rowid>? ORDER BY rowid LIMIT 100",
        [cursor],
      );
      if (!selected.length) break;
      for (const item of selected) {
        const row = await revisions.row(item.project_id, item.revision);
        if (!row) throw new Error("Missing retained history source.");
        const snapshot = await revisions.snapshot(item.project_id, row);
        const digests = [...new Set(Object.values(snapshot.files))];
        for (let offset = 0; offset < digests.length; offset += 100)
          await db.batch(
            digests.slice(offset, offset + 100).map((digest) => ({
              sql: "INSERT OR IGNORE INTO reachable_objects VALUES(?)",
              values: [`projects/${item.project_id}/objects/${digest}`],
            })),
          );
        cursor = item.cursor;
      }
    }
    const cutoff =
      new Date(descriptor.completedAt).getTime() - retentionDays * 86400_000;
    if (!Number.isFinite(cutoff))
      throw new Error("Invalid backup completion time.");
    await file.writeFile(
      JSON.stringify({
        format: "showai-cleanup-dry-run-v1",
        serverId: verified.serverId,
        epoch: descriptor.frozen.epoch,
        backupSha256: createHash("sha256")
          .update(descriptorBytes)
          .digest("hex"),
        retentionDays,
        cutoff: new Date(cutoff).toISOString(),
        operation: "report-only",
      }) + "\n",
    );
    for await (const item of rows(join(input.backup, "inventory.ndjson"))) {
      if (
        (
          await db.all("SELECT key FROM reachable_objects WHERE key=?", [
            item.key,
          ])
        ).length
      ) {
        protectedObjects++;
        continue;
      }
      const uploaded =
        typeof item.uploadedAt === "string" ? Date.parse(item.uploadedAt) : NaN;
      if (!Number.isFinite(uploaded)) {
        unknownAge++;
        continue;
      }
      if (uploaded > cutoff) {
        recentObjects++;
        continue;
      }
      await file.writeFile(
        JSON.stringify({
          candidate: item.key,
          bytes: item.bytes,
          sha256: item.sha256,
          uploadedAt: item.uploadedAt,
          reason: "absent-from-all-history-reservations-and-upload-tasks",
        }) + "\n",
      );
      candidates++;
      candidateBytes += Number(item.bytes);
    }
    await file.sync();
  } finally {
    await file.close();
    db.close();
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    operation: "cleanup-dry-run",
    serverId: verified.serverId,
    candidates,
    candidateBytes,
    protectedObjects,
    recentObjects,
    unknownAge,
    retentionDays,
    report: input.destination,
    deleted: 0,
  };
}
