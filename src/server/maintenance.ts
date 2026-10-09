import { hash, SyncError } from "../sync/protocol";
import { backupTables, type MetadataStore, type ObjectStore } from "./storage";

export interface MaintenanceState {
  state: "running" | "frozen";
  epoch: string;
  frozen_at: string | null;
  activeWrites: number;
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const unavailable = () =>
  new SyncError(
    503,
    "SERVER_READ_ONLY",
    "The server is frozen for a consistent backup. Local changes are retained.",
  );
export class ServerMaintenance {
  private expected: Promise<string> | undefined;
  constructor(
    readonly db: MetadataStore,
    readonly objects: ObjectStore,
    private readonly credential?: string,
  ) {
    if (credential && !/^[a-f0-9]{64}$/.test(credential))
      throw new Error(
        "SHOWAI_OPERATIONS_KEY must be 32 random bytes encoded as 64 lowercase hex characters.",
      );
  }
  async state(): Promise<MaintenanceState> {
    const rows = await this.db.all<MaintenanceState>(
      "SELECT state,epoch,frozen_at,(SELECT COUNT(*) FROM server_write_leases) AS activeWrites FROM server_operations WHERE id=1",
    );
    if (!rows[0]) throw new Error("Missing operations migration.");
    return rows[0];
  }
  async enterWrite() {
    const id = crypto.randomUUID();
    const result = await this.db.run(
      "INSERT INTO server_write_leases(id,started_at) SELECT ?,? WHERE (SELECT state FROM server_operations WHERE id=1)='running' AND (SELECT COUNT(*) FROM server_write_leases)<64",
      [id, new Date().toISOString()],
    );
    if (!result.changes) {
      if ((await this.state()).state === "frozen") throw unavailable();
      throw new SyncError(
        429,
        "BUSY",
        "The server has too many active writes.",
        { retryAfter: 1 },
      );
    }
    return id;
  }
  async leaveWrite(id: string) {
    await this.db.run("DELETE FROM server_write_leases WHERE id=?", [id]);
  }
  async frozen(epoch: string) {
    const state = await this.state();
    if (state.state !== "frozen" || state.epoch !== epoch)
      throw new SyncError(
        409,
        "BACKUP_CHANGED",
        "The frozen backup generation changed.",
      );
    if (state.activeWrites)
      throw new SyncError(
        409,
        "WRITES_DRAINING",
        "Wait for admitted writes to finish before exporting.",
        { activeWrites: state.activeWrites },
      );
    return state;
  }
  private async authorize(request: Request) {
    if (!this.credential)
      throw new SyncError(
        404,
        "NOT_FOUND",
        "Operations endpoints are disabled.",
      );
    const value = request.headers.get("authorization") ?? "";
    if (!/^Bearer [a-f0-9]{64}$/.test(value))
      throw new SyncError(403, "FORBIDDEN", "Invalid operations credential.");
    this.expected ??= hash(this.credential);
    const [expected, actual] = await Promise.all([
      this.expected,
      hash(value.slice(7)),
    ]);
    let different = 0;
    for (let index = 0; index < expected.length; index++)
      different |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
    if (different)
      throw new SyncError(403, "FORBIDDEN", "Invalid operations credential.");
  }
  async handle(request: Request, path: string) {
    await this.authorize(request);
    const url = new URL(request.url);
    if (path === "/api/ops/state" && request.method === "GET")
      return json(await this.state());
    if (path === "/api/ops/freeze" && request.method === "POST") {
      await this.db.run(
        "UPDATE server_operations SET state='frozen',epoch=?,frozen_at=? WHERE id=1 AND state='running'",
        [crypto.randomUUID(), new Date().toISOString()],
      );
      return json(await this.state());
    }
    const epoch = url.searchParams.get("epoch") ?? "";
    if (path === "/api/ops/resume" && request.method === "POST") {
      const result = await this.db.run(
        "UPDATE server_operations SET state='running',epoch='',frozen_at=NULL WHERE id=1 AND state='frozen' AND epoch=?",
        [epoch],
      );
      if (!result.changes)
        throw new SyncError(
          409,
          "BACKUP_CHANGED",
          "Resume requires the current frozen generation.",
        );
      return json(await this.state());
    }
    await this.frozen(epoch);
    if (path === "/api/ops/export/metadata" && request.method === "GET") {
      const table = url.searchParams.get("table") ?? "";
      if (!backupTables.includes(table as (typeof backupTables)[number]))
        throw new SyncError(400, "INVALID_TABLE", "Unknown backup table.");
      const after = Number(url.searchParams.get("after") ?? "0");
      if (!Number.isSafeInteger(after) || after < 0)
        throw new SyncError(400, "INVALID_CURSOR", "Invalid metadata cursor.");
      let rows: Record<string, unknown>[];
      if (table === "revisions") {
        const sizes = await this.db.all<{ cursor: number; bytes: number }>(
          "SELECT rowid AS cursor,length(CAST(manifest AS BLOB)) AS bytes FROM revisions WHERE rowid>? ORDER BY rowid LIMIT 100",
          [after],
        );
        let budget = 0,
          end = after;
        for (const row of sizes) {
          if (budget && budget + row.bytes > 1024 * 1024) break;
          budget += row.bytes;
          end = row.cursor;
        }
        rows =
          end === after
            ? []
            : await this.db.all(
                "SELECT rowid AS __cursor__,* FROM revisions WHERE rowid>? AND rowid<=? ORDER BY rowid",
                [after, end],
              );
      } else
        rows = await this.db.all(
          `SELECT rowid AS __cursor__,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 100`,
          [after],
        );
      await this.frozen(epoch);
      return json({
        table,
        rows,
        next: rows.length ? rows[rows.length - 1].__cursor__ : null,
      });
    }
    if (path === "/api/ops/export/inventory" && request.method === "GET") {
      const inventory = await this.objects.list(
        url.searchParams.get("after") ?? undefined,
        100,
      );
      await this.frozen(epoch);
      return json(inventory);
    }
    if (path === "/api/ops/export/object" && request.method === "GET") {
      const key = url.searchParams.get("key") ?? "";
      if (!operationObjectKey(key))
        throw new SyncError(
          400,
          "INVALID_OBJECT",
          "Invalid backup object key.",
        );
      const object = await this.objects.open(key);
      if (!object)
        throw new SyncError(404, "NOT_FOUND", "The backup object is missing.");
      return new Response(object.body, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(object.bytes),
          "cache-control": "no-store",
        },
      });
    }
    throw new SyncError(404, "NOT_FOUND", "Unknown operations endpoint.");
  }
}
export function operationObjectKey(key: string) {
  return /^projects\/[A-Za-z0-9_-]+\/(?:(?:objects|manifests)\/[a-f0-9]{64}|uploads\/[A-Za-z0-9_-]+\/parts\/[a-f0-9]{64})(?:\.staging-[A-Za-z0-9_-]+)?$/.test(
    key,
  );
}
