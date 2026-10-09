import { Revisions } from "./revisions";
import { SyncError } from "../sync/protocol";
import { operationObjectKey } from "./maintenance";
import type { MetadataStore, ObjectStore } from "./storage";

export interface CleanupCandidate {
  key: string;
  sha256: string;
  bytes: number;
  uploadedAt: string;
}
export class GarbageCollection {
  constructor(
    readonly db: MetadataStore,
    readonly objects: ObjectStore,
  ) {}
  async run(
    candidates: CleanupCandidate[],
    retentionDays: number,
    apply: boolean,
  ) {
    const decisions: { key: string; action: string; reason?: string }[] = [];
    for (const item of candidates) {
      const match = item.key.match(
        /^projects\/([A-Za-z0-9_-]+)\/(?:objects|manifests)\/([a-f0-9]{64})(\.staging-[A-Za-z0-9_-]+)?$/,
      );
      if (
        !operationObjectKey(item.key) ||
        !match ||
        !Number.isSafeInteger(item.bytes) ||
        item.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(item.sha256)
      )
        throw new SyncError(
          400,
          "INVALID_CLEANUP",
          "Cleanup accepts verified object/manifest candidates; upload task parts are retained.",
        );
      const [, projectId, digest, temporary] = match;
      const info = await this.objects.stat(item.key);
      if (!info) {
        decisions.push({ key: item.key, action: "absent" });
        continue;
      }
      if (
        info.bytes !== item.bytes ||
        info.uploadedAt !== item.uploadedAt ||
        Date.parse(info.uploadedAt) > Date.now() - retentionDays * 86400_000 ||
        !Number.isFinite(Date.parse(info.uploadedAt))
      ) {
        decisions.push({
          key: item.key,
          action: "retain",
          reason: "changed-or-recent",
        });
        continue;
      }
      if (!temporary) {
        const protectedRows = await this.db.all(
          "SELECT 1 FROM storage_reservations WHERE project_id=? AND digest=? UNION ALL SELECT 1 FROM object_uploads WHERE project_id=? AND digest=? UNION ALL SELECT 1 FROM revisions WHERE manifest_key=? LIMIT 1",
          [projectId, digest, projectId, digest, item.key],
        );
        if (protectedRows.length) {
          decisions.push({
            key: item.key,
            action: "retain",
            reason: "reserved-or-referenced",
          });
          continue;
        }
        const size = (
          await this.db.all<{ count: number; bytes: number }>(
            "SELECT COUNT(*) AS count,COALESCE(SUM(manifest_bytes),0) AS bytes FROM revisions WHERE project_id=?",
            [projectId],
          )
        )[0];
        if (size.count > 100 || size.bytes > 16 * 1024 * 1024) {
          decisions.push({
            key: item.key,
            action: "retain",
            reason: "history-exceeds-online-proof-budget",
          });
          continue;
        }
        const rows = await this.db.all<{ revision: string }>(
          "SELECT revision FROM revisions WHERE project_id=? ORDER BY sequence",
          [projectId],
        );
        let referenced = false;
        const revisions = new Revisions(this.db, this.objects);
        for (const row of rows) {
          const snapshot = await revisions.snapshot(
            projectId,
            (await revisions.row(projectId, row.revision))!,
          );
          if (Object.values(snapshot.files).includes(digest)) {
            referenced = true;
            break;
          }
        }
        if (referenced) {
          decisions.push({
            key: item.key,
            action: "retain",
            reason: "historical-file",
          });
          continue;
        }
      }
      const object = await this.objects.open(item.key);
      if (!object) throw new Error("Cleanup object changed after inspection.");
      const hash = this.objects.digest();
      let bytes = 0;
      for await (const block of object.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += block.byteLength;
        if (bytes > item.bytes)
          throw new Error("Cleanup object exceeded its recorded size.");
        await hash.update(block);
      }
      if (bytes !== item.bytes || (await hash.finish()) !== item.sha256) {
        decisions.push({
          key: item.key,
          action: "retain",
          reason: "digest-mismatch",
        });
        continue;
      }
      if (apply) {
        // All histories and durable references are inspected under the exclusive
        // freeze. Object deletion never advances a project head.
        if (!temporary && item.key.includes("/objects/"))
          await this.db.run(
            "DELETE FROM objects WHERE project_id=? AND digest=?",
            [projectId, digest],
          );
        await this.objects.remove(item.key);
      }
      decisions.push({
        key: item.key,
        action: apply ? "deleted" : "candidate",
      });
    }
    return {
      dryRun: !apply,
      decisions,
      deleted: decisions.filter((item) => item.action === "deleted").length,
      headsChanged: 0,
    };
  }
}
