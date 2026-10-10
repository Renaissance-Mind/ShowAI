import { CAPACITY } from "../portable/capacity.mjs";
import {
  hash,
  validateSnapshot,
  snapshotRevision,
  canonical,
} from "../sync/protocol";
import {
  validateReaderClosure,
  validatePackageClosure,
} from "../sync/dependency-validation";
import { Quotas, type Reservation } from "./quotas";
import { manifestMaximum } from "./revisions";
import type { MetadataStore, ObjectStore, SqlStatement } from "./storage";

interface PendingRow {
  id: string;
  project_id: string;
  user_id: string;
  kind: "object" | "manifest";
  digest: string;
  bytes: number;
  created_at: string;
}
interface Decision {
  id: string;
  action:
    | "finalize-object"
    | "retain-upload"
    | "release-empty"
    | "release-ready"
    | "finalize-manifest"
    | "retain-corrupt";
  bytes?: number;
  reason?: string;
}
export class ReservationReconciliation {
  constructor(
    readonly db: MetadataStore,
    readonly objects: ObjectStore,
  ) {}
  async inspect(row: PendingRow): Promise<Decision> {
    const key = `projects/${row.project_id}/${row.kind === "object" ? "objects" : "manifests"}/${row.digest}`;
    const ready =
      row.kind === "object"
        ? await this.db.all<{ bytes: number }>(
            "SELECT bytes FROM objects WHERE project_id=? AND digest=?",
            [row.project_id, row.digest],
          )
        : await this.db.all<{ bytes: number }>(
            "SELECT manifest_bytes AS bytes FROM revisions WHERE project_id=? AND manifest_digest=?",
            [row.project_id, row.digest],
          );
    const data = await this.objects.open(key);
    if (!data) {
      if (ready.length)
        return {
          id: row.id,
          action: "retain-corrupt",
          reason: "ready-object-missing",
        };
      const tasks = await this.db.all(
        "SELECT id FROM object_uploads WHERE reservation_id=? AND completed=0",
        [row.id],
      );
      return {
        id: row.id,
        action: tasks.length ? "retain-upload" : "release-empty",
      };
    }
    const digest = this.objects.digest();
    let size = 0;
    for await (const block of data.body as unknown as AsyncIterable<Uint8Array>) {
      size += block.byteLength;
      if (
        size > row.bytes ||
        size >
          (row.kind === "manifest" ? manifestMaximum : CAPACITY.syncObjectBytes)
      ) {
        return {
          id: row.id,
          action: "retain-corrupt",
          reason: "unexpected-size",
        };
      }
      await digest.update(block);
    }
    if (size !== data.bytes || (await digest.finish()) !== row.digest)
      return {
        id: row.id,
        action: "retain-corrupt",
        reason: "digest-mismatch",
      };
    if (ready.length)
      return {
        id: row.id,
        action: ready[0].bytes === size ? "release-ready" : "retain-corrupt",
        bytes: size,
        reason: ready[0].bytes === size ? undefined : "metadata-size-mismatch",
      };
    if (
      row.kind === "manifest" &&
      (
        await this.db.all("SELECT 1 FROM settings WHERE key=?", [
          `current-state-boundary:${row.project_id}`,
        ])
      ).length
    )
      return {
        id: row.id,
        action: "release-ready",
        bytes: size,
        reason: "unpublished-current-state",
      };
    if (row.kind === "manifest") {
      try {
        await this.manifest(row);
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          (error instanceof Error && "code" in error)
        )
          return {
            id: row.id,
            action: "retain-corrupt",
            reason: "manifest-closure-invalid",
          };
        throw error;
      }
      return { id: row.id, action: "finalize-manifest", bytes: size };
    }
    return { id: row.id, action: "finalize-object", bytes: size };
  }
  private async manifest(row: PendingRow) {
    const key = `projects/${row.project_id}/manifests/${row.digest}`;
    const bytes = await this.objects.get(key);
    if (!bytes || (await hash(bytes)) !== row.digest)
      throw new Error("Manifest changed during reconciliation.");
    const snapshot = JSON.parse(new TextDecoder().decode(bytes));
    validateSnapshot(snapshot, row.project_id);
    const revision = await snapshotRevision(snapshot);
    if ((await hash(canonical(snapshot))) !== row.digest)
      throw new Error(
        "Manifest serialization differs from its reserved identity.",
      );
    for (const parent of snapshot.parents)
      if (
        !(
          await this.db.all(
            "SELECT revision FROM revisions WHERE project_id=? AND revision=?",
            [row.project_id, parent],
          )
        ).length
      )
        throw new Error("Manifest parent is missing.");
    const names = [...new Set(Object.values(snapshot.files))] as string[];
    for (let offset = 0; offset < names.length; offset += 80) {
      const page = names.slice(offset, offset + 80);
      if (
        (
          await this.db.all(
            `SELECT digest FROM objects WHERE project_id=? AND digest IN(${page.map(() => "?").join(",")})`,
            [row.project_id, ...page],
          )
        ).length !== page.length
      )
        throw new Error("Manifest file reference is missing.");
    }
    const read = async (path: string) => {
      const data = await this.objects.get(
        `projects/${row.project_id}/objects/${snapshot.files[path]}`,
      );
      if (!data || (await hash(data)) !== snapshot.files[path])
        throw new Error("Manifest dependency is absent or corrupt.");
      return data;
    };
    await validateReaderClosure(
      Object.keys(snapshot.files),
      row.project_id,
      read,
    );
    await validatePackageClosure(
      Object.keys(snapshot.files),
      row.project_id,
      read,
    );
    return { revision, bytes: bytes.byteLength };
  }
  async run(ids: string[], apply: boolean) {
    const rows = await this.db.all<PendingRow>(
      `SELECT * FROM storage_reservations ${ids.length ? `WHERE id IN(${ids.map(() => "?").join(",")})` : ""} ORDER BY created_at,id LIMIT 10`,
      ids,
    );
    const decisions: Decision[] = [];
    for (const row of rows) {
      const decision = await this.inspect(row);
      decisions.push(decision);
      if (!apply || decision.action.startsWith("retain-")) continue;
      const reservation: Reservation = {
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        kind: row.kind,
        digest: row.digest,
        bytes: row.bytes,
        day: row.created_at.slice(0, 10),
      };
      const quotas = new Quotas(this.db),
        statements: SqlStatement[] = [];
      if (decision.action === "finalize-object") {
        statements.push({
          sql: "INSERT OR IGNORE INTO objects(project_id,digest,bytes,uploaded_by,uploaded_at) VALUES(?,?,?,?,?)",
          values: [
            row.project_id,
            row.digest,
            decision.bytes!,
            row.user_id,
            row.created_at,
          ],
        });
        statements.push(
          quotas.unusedBudgetStatement(reservation, decision.bytes!),
        );
      }
      if (decision.action === "finalize-manifest") {
        const manifest = await this.manifest(row);
        statements.push({
          sql: "INSERT OR IGNORE INTO revisions(project_id,revision,manifest,user_id,created_at,published,manifest_key,manifest_digest,manifest_bytes,sequence) VALUES(?,?,'',?,?,0,?,?,?,COALESCE((SELECT MAX(sequence)+1 FROM revisions WHERE project_id=?),1))",
          values: [
            row.project_id,
            manifest.revision,
            row.user_id,
            row.created_at,
            `projects/${row.project_id}/manifests/${row.digest}`,
            row.digest,
            manifest.bytes,
            row.project_id,
          ],
        });
      }
      const parts =
        decision.action === "finalize-object" ||
        decision.action === "release-ready"
          ? await this.db.all<{ id: string; digest: string }>(
              "SELECT u.id,p.digest FROM object_uploads u JOIN object_upload_parts p ON p.upload_id=u.id WHERE u.reservation_id=?",
              [row.id],
            )
          : [];
      if (
        row.kind === "object" &&
        (decision.action === "finalize-object" ||
          decision.action === "release-ready")
      )
        statements.push({
          sql: "UPDATE object_uploads SET completed=1 WHERE reservation_id=?",
          values: [row.id],
        });
      statements.push(quotas.releaseStatement(reservation));
      await this.db.batch(statements);
      for (const part of parts)
        await this.objects.remove(
          `projects/${row.project_id}/uploads/${part.id}/parts/${part.digest}`,
        );
      if (parts.length)
        await this.db.run(
          "DELETE FROM object_upload_parts WHERE upload_id IN(SELECT id FROM object_uploads WHERE reservation_id=? AND completed=1)",
          [row.id],
        );
    }
    return {
      dryRun: !apply,
      decisions,
      remaining: (
        await this.db.all<{ count: number }>(
          "SELECT COUNT(*) AS count FROM storage_reservations",
        )
      )[0].count,
      headsChanged: 0,
    };
  }
}
