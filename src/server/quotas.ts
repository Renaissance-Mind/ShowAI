import { SyncError, digestId, identifier } from "../sync/protocol";
import type { MetadataStore, SqlStatement } from "./storage";

export interface StoragePolicy {
  projectBytes: number;
  accountBytes: number;
  serviceBytes: number;
  accountDailyBytes: number;
  serviceDailyBytes: number;
  accountDailyUploads: number;
  serviceDailyUploads: number;
  accountProjects: number;
  serviceProjects: number;
}
export const defaultStoragePolicy: StoragePolicy = {
  projectBytes: 1024 ** 3,
  accountBytes: 2 * 1024 ** 3,
  serviceBytes: 64 * 1024 ** 3,
  accountDailyBytes: 1024 ** 3,
  serviceDailyBytes: 16 * 1024 ** 3,
  accountDailyUploads: 50000,
  serviceDailyUploads: 250000,
  accountProjects: 50,
  serviceProjects: 10000,
};
export interface Reservation {
  id: string;
  projectId: string;
  userId: string;
  kind: "object" | "manifest";
  digest: string;
  bytes: number;
  day: string;
}
export class Quotas {
  readonly policy: StoragePolicy;
  constructor(
    readonly db: MetadataStore,
    policy: Partial<StoragePolicy> = {},
  ) {
    for (const key of Object.keys(policy))
      if (!(key in defaultStoragePolicy))
        throw new Error(`Unknown storage policy field: ${key}`);
    this.policy = { ...defaultStoragePolicy, ...policy };
    for (const value of Object.values(this.policy))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(
          "Storage policy values must be positive safe integers.",
        );
  }
  async reserve(
    projectId: string,
    userId: string,
    kind: Reservation["kind"],
    digest: string,
    bytes: number,
    permission: SqlStatement,
  ): Promise<Reservation | null> {
    identifier(projectId);
    identifier(userId);
    digestId(digest);
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new SyncError(400, "INVALID_SIZE", "Invalid upload size.");
    const present =
      kind === "object"
        ? "SELECT 1 FROM objects WHERE project_id=? AND digest=?"
        : "SELECT 1 FROM revisions WHERE project_id=? AND manifest_digest=?";
    if ((await this.db.all(present, [projectId, digest])).length) return null;
    const id = crypto.randomUUID(),
      day = new Date().toISOString().slice(0, 10),
      p = this.policy;
    const sum = (table: string, column: string, where = "") =>
      `COALESCE((SELECT SUM(${column}) FROM ${table}${where ? ` WHERE ${where}` : ""}),0)`;
    const projectTotal = `${sum("objects", "bytes", "project_id=?")}+${sum("revisions", "manifest_bytes", "project_id=?")}+${sum("storage_reservations", "bytes", "project_id=?")}`;
    const accountTotal = `${sum("objects", "bytes", "uploaded_by=?")}+${sum("revisions", "manifest_bytes", "user_id=?")}+${sum("storage_reservations", "bytes", "user_id=?")}`;
    const serviceTotal = `${sum("objects", "bytes")}+${sum("revisions", "manifest_bytes")}+${sum("storage_reservations", "bytes")}`;
    const budget =
      "COALESCE((SELECT bytes FROM upload_budgets WHERE day=? AND user_id=?),0)+?<=? AND COALESCE((SELECT hits FROM upload_budgets WHERE day=? AND user_id=?),0)<?";
    const results = await this.db.batch([
      {
        sql: `INSERT OR IGNORE INTO storage_reservations(id,project_id,user_id,kind,digest,bytes,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(${permission.sql}) AND ${projectTotal}+?<=? AND ${accountTotal}+?<=? AND ${serviceTotal}+?<=? AND (SELECT COUNT(*) FROM storage_reservations WHERE user_id=?)<8 AND ${budget} AND ${budget}`,
        values: [
          id,
          projectId,
          userId,
          kind,
          digest,
          bytes,
          new Date().toISOString(),
          ...permission.values!,
          projectId,
          projectId,
          projectId,
          bytes,
          p.projectBytes,
          userId,
          userId,
          userId,
          bytes,
          p.accountBytes,
          bytes,
          p.serviceBytes,
          userId,
          day,
          userId,
          bytes,
          p.accountDailyBytes,
          day,
          userId,
          p.accountDailyUploads,
          day,
          "*",
          bytes,
          p.serviceDailyBytes,
          day,
          "*",
          p.serviceDailyUploads,
        ],
      },
      {
        sql: "INSERT INTO upload_budgets(day,user_id,hits,bytes) SELECT ?,?,1,? WHERE EXISTS(SELECT 1 FROM storage_reservations WHERE id=?) ON CONFLICT(day,user_id) DO UPDATE SET hits=hits+1,bytes=bytes+excluded.bytes",
        values: [day, userId, bytes, id],
      },
      {
        sql: "INSERT INTO upload_budgets(day,user_id,hits,bytes) SELECT ?,'*',1,? WHERE EXISTS(SELECT 1 FROM storage_reservations WHERE id=?) ON CONFLICT(day,user_id) DO UPDATE SET hits=hits+1,bytes=bytes+excluded.bytes",
        values: [day, bytes, id],
      },
    ]);
    if (!results[0].changes) {
      if (!(await this.db.all(permission.sql, permission.values)).length)
        throw new SyncError(
          403,
          "FORBIDDEN",
          "Upload permission is unavailable.",
        );
      if ((await this.db.all(present, [projectId, digest])).length) return null;
      if (
        (
          await this.db.all(
            "SELECT 1 FROM storage_reservations WHERE project_id=? AND kind=? AND digest=?",
            [projectId, kind, digest],
          )
        ).length
      )
        throw new SyncError(
          409,
          "UPLOAD_IN_PROGRESS",
          "This object has a pending upload or retained recovery reservation.",
        );
      throw new SyncError(
        507,
        "UPLOAD_QUOTA_EXCEEDED",
        "上传容量或今日预算已达上限，本地内容保留。",
        { policy: p },
      );
    }
    return { id, projectId, userId, kind, digest, bytes, day };
  }
  releaseStatement(reservation: Reservation): SqlStatement {
    return {
      sql: "DELETE FROM storage_reservations WHERE id=?",
      values: [reservation.id],
    };
  }
  unusedBudgetStatement(
    reservation: Reservation,
    actual: number,
  ): SqlStatement {
    return {
      sql: "UPDATE upload_budgets SET bytes=bytes-? WHERE day=? AND user_id IN(?,'*') AND EXISTS(SELECT 1 FROM objects WHERE project_id=? AND digest=?)",
      values: [
        Math.max(0, reservation.bytes - actual),
        reservation.day,
        reservation.userId,
        reservation.projectId,
        reservation.digest,
      ],
    };
  }
  async release(reservation: Reservation) {
    await this.db.run("DELETE FROM storage_reservations WHERE id=?", [
      reservation.id,
    ]);
  }
  async usage(projectId: string) {
    return (
      await this.db.all<{
        objects: number;
        manifests: number;
        pending: number;
      }>(
        "SELECT COALESCE((SELECT SUM(bytes) FROM objects WHERE project_id=?),0) AS objects,COALESCE((SELECT SUM(manifest_bytes) FROM revisions WHERE project_id=?),0) AS manifests,COALESCE((SELECT SUM(bytes) FROM storage_reservations WHERE project_id=?),0) AS pending",
        [projectId, projectId, projectId],
      )
    )[0];
  }
}
