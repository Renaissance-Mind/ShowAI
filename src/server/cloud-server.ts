import { createSyncServer } from "./app";
import { backupTables, type SqlValue } from "./storage";
import {
  DurableMetadata,
  DurableObjects,
  type DurableStorage,
} from "./durable-storage";
import { workerObjects, type WorkerEnvironment } from "./worker";
import { eventProtocol, type EventIdentity } from "../sync/events";
import type { EventPeer } from "./events";
import { hash, SyncError } from "../sync/protocol";
import { schemaVersion } from "./migrations";

interface EventSocket extends WebSocket {
  serializeAttachment(value: EventIdentity): void;
  deserializeAttachment(): EventIdentity;
}
interface DurableState {
  storage: DurableStorage;
  acceptWebSocket(socket: EventSocket): void;
  getWebSockets(): EventSocket[];
  blockConcurrencyWhile<T>(run: () => Promise<T>): Promise<T>;
}
interface Bootstrap {
  serverId: string;
  epoch: string;
  table: number;
  offset: number;
  counts: Record<string, number>;
  complete: boolean;
  verified?: number;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

/** One consistent metadata authority per server. Linux uses the same handler
 * against local SQLite; R2 and the database-neutral backup format stay shared. */
export class ShowAIServer {
  readonly metadata: DurableMetadata;
  readonly objects: DurableObjects;
  readonly app: ReturnType<typeof createSyncServer>;
  private ready: Promise<string>;
  constructor(
    readonly ctx: DurableState,
    readonly env: WorkerEnvironment,
  ) {
    this.metadata = new DurableMetadata(ctx.storage);
    this.objects = new DurableObjects(ctx.storage, workerObjects(env));
    this.app = createSyncServer({
      metadata: this.metadata,
      objects: this.objects,
      metadataDriver: "durable-sqlite",
      name: env.SHOWAI_SERVER_NAME,
      publicUrl: env.SHOWAI_SERVER_URL,
      registrationKey: env.SHOWAI_REGISTRATION_KEY,
      registrationMode: "controlled",
      operationsKey: env.SHOWAI_OPERATIONS_KEY,
      accountLimit: env.SHOWAI_ACCOUNT_LIMIT
        ? Number(env.SHOWAI_ACCOUNT_LIMIT)
        : undefined,
      registrationLimit: env.SHOWAI_REGISTRATION_LIMIT
        ? Number(env.SHOWAI_REGISTRATION_LIMIT)
        : undefined,
      storagePolicy: env.SHOWAI_STORAGE_POLICY
        ? JSON.parse(env.SHOWAI_STORAGE_POLICY)
        : undefined,
      requestPolicy: env.SHOWAI_REQUEST_POLICY
        ? JSON.parse(env.SHOWAI_REQUEST_POLICY)
        : undefined,
      allowedOrigins: env.SHOWAI_ALLOWED_ORIGINS?.split(",").filter(Boolean),
      requirePublicOrigin: true,
      eventPeers: () => ctx.getWebSockets().map((socket) => this.peer(socket)),
    });
    this.ready = ctx.blockConcurrencyWhile(() => this.app.initialize());
  }
  private peer(socket: EventSocket): EventPeer {
    return {
      identity: () => socket.deserializeAttachment(),
      remember: (value) => socket.serializeAttachment(value),
      send: (value) => {
        if (socket.readyState === 1) socket.send(value);
      },
      close: (code, reason) => socket.close(code, reason),
      get bufferedAmount() {
        return socket.bufferedAmount;
      },
    };
  }
  private async bootstrap(request: Request) {
    const credential = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    if (
      !credential ||
      !this.env.SHOWAI_OPERATIONS_KEY ||
      (await hash(credential)) !== (await hash(this.env.SHOWAI_OPERATIONS_KEY))
    )
      throw new SyncError(
        401,
        "UNAUTHORIZED",
        "Infrastructure access is required.",
      );
    if (request.method !== "POST")
      throw new SyncError(
        405,
        "METHOD_NOT_ALLOWED",
        "Metadata migration requires POST.",
      );
    // Read directly from the frozen D1 source; credentials and application rows
    // are never transported to, returned by, or logged by the operator client.
    const sourceSettings = (
      await this.env.DB.prepare(
        "SELECT key,value FROM settings WHERE key IN('server_id','schema_version')",
      ).all<{ key: string; value: string }>()
    ).results;
    const serverId = sourceSettings.find(
      (item) => item.key === "server_id",
    )?.value;
    if (
      !serverId ||
      Number(
        sourceSettings.find((item) => item.key === "schema_version")?.value,
      ) !== schemaVersion
    )
      throw new SyncError(
        409,
        "SOURCE_SCHEMA",
        "Migrate and verify the D1 source schema first.",
      );
    const checkSource = async () => {
      const row = (
        await this.env.DB.prepare(
          "SELECT state,epoch,maintenance_owner,(SELECT COUNT(*) FROM server_write_leases) AS active FROM server_operations WHERE id=1",
        ).all<{
          state: string;
          epoch: string;
          maintenance_owner: string | null;
          active: number;
        }>()
      ).results[0];
      if (
        !row ||
        row.state !== "frozen" ||
        row.active !== 0 ||
        row.maintenance_owner !== null
      )
        throw new SyncError(
          409,
          "SOURCE_NOT_FROZEN",
          "Freeze and drain the D1 source before migrating metadata.",
        );
      return row.epoch;
    };
    const epoch = await checkSource();
    let state = await this.ctx.storage.get<Bootstrap>("metadata-bootstrap");
    if (state && (state.serverId !== serverId || state.epoch !== epoch))
      throw new SyncError(
        409,
        "SOURCE_CHANGED",
        "The frozen migration source changed; the target is retained for recovery.",
      );
    if (state?.complete) return json(state);
    if (!state) {
      if ((await this.metadata.all("SELECT id FROM users LIMIT 1")).length)
        throw new SyncError(
          409,
          "TARGET_NOT_EMPTY",
          "Migration requires a new metadata target.",
        );
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE server_operations SET state='frozen',maintenance_owner='metadata-bootstrap' WHERE id=1",
        );
        for (const table of [...backupTables].reverse())
          if (table !== "server_operations")
            this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
      });
      state = {
        serverId,
        epoch,
        table: 0,
        offset: 0,
        counts: {},
        complete: false,
      };
      await this.ctx.storage.put("metadata-bootstrap", state);
    }
    // Each call performs at most five bounded pages, below the concurrency gate
    // deadline. Retrying resumes after a durable checkpoint, without replacing
    // data already imported or allowing either server to become writable.
    for (
      let batch = 0;
      batch < 5 && state.table < backupTables.length;
      batch++
    ) {
      const table = backupTables[state.table];
      const rows = (
        await this.env.DB.prepare(
          `SELECT * FROM ${table} ORDER BY rowid LIMIT 50 OFFSET ?`,
        )
          .bind(state.offset)
          .all<Record<string, SqlValue>>()
      ).results;
      if ((await checkSource()) !== epoch)
        throw new SyncError(
          409,
          "SOURCE_CHANGED",
          "The migration freeze changed.",
        );
      this.ctx.storage.transactionSync(() => {
        for (const row of rows) {
          const columns = Object.keys(row);
          if (columns.some((column) => !/^[a-z_]+$/.test(column)))
            throw new Error("Invalid source metadata column.");
          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
            ...columns.map((column) => row[column]),
          );
        }
      });
      state.offset += rows.length;
      state.counts[table] = state.offset;
      if (rows.length < 50) {
        state.table++;
        state.offset = 0;
      }
      await this.ctx.storage.put("metadata-bootstrap", state);
    }
    if (state.table === backupTables.length) {
      const last = Math.min(backupTables.length, (state.verified ?? 0) + 3);
      for (let index = state.verified ?? 0; index < last; index++) {
        const table = backupTables[index];
        const expected = (
          await this.env.DB.prepare(
            `SELECT COUNT(*) AS count FROM ${table}`,
          ).all<{ count: number }>()
        ).results[0].count;
        const actual = (
          await this.metadata.all<{ count: number }>(
            `SELECT COUNT(*) AS count FROM ${table}`,
          )
        )[0].count;
        if (expected !== actual)
          throw new Error(`Metadata migration count differs: ${table}`);
        state.verified = index + 1;
        await this.ctx.storage.put("metadata-bootstrap", state);
      }
      if (state.verified !== backupTables.length) return json(state);
      if ((await checkSource()) !== epoch)
        throw new SyncError(
          409,
          "SOURCE_CHANGED",
          "The migration freeze changed.",
        );
      const identity = (
        await this.metadata.all<{ value: string }>(
          "SELECT value FROM settings WHERE key='server_id'",
        )
      )[0].value;
      if (identity !== serverId)
        throw new Error("Metadata migration changed the server identity.");
      state.complete = true;
      await this.ctx.storage.put("metadata-bootstrap", state);
      // Rebuild the cached identity only after the complete frozen copy verifies.
      this.ready = this.app.reloadIdentity();
      if ((await this.ready) !== serverId)
        throw new Error("Imported application identity differs.");
    }
    return json(state);
  }
  async fetch(request: Request) {
    await this.ready;
    const path = new URL(request.url).pathname;
    const base = this.env.SHOWAI_SERVER_URL
      ? new URL(this.env.SHOWAI_SERVER_URL).pathname.replace(/\/$/, "")
      : "";
    if (path === `${base}/api/ops/metadata-bootstrap`) {
      try {
        return await this.ctx.blockConcurrencyWhile(() =>
          this.bootstrap(request),
        );
      } catch (error) {
        if (error instanceof SyncError)
          return json(
            { error: { code: error.code, message: error.message } },
            error.status,
          );
        console.error("Cloud metadata migration failed", error);
        return json(
          {
            error: {
              code: "MIGRATION_FAILED",
              message: "The frozen migration is retained for recovery.",
            },
          },
          500,
        );
      }
    }
    const state = await this.ctx.storage.get<Bootstrap>("metadata-bootstrap");
    if (
      (state && !state.complete) ||
      (this.env.SHOWAI_METADATA_IMPORT_REQUIRED === "1" && !state?.complete)
    )
      return json(
        {
          error: {
            code: "MIGRATION_REQUIRED",
            message:
              "Complete the verified frozen metadata migration before using this target.",
          },
        },
        503,
      );
    if (
      path === `${base}/api/events` &&
      request.headers.get("upgrade")?.toLowerCase() === "websocket"
    ) {
      try {
        if (
          !request.headers
            .get("sec-websocket-protocol")
            ?.split(",")
            .map((value) => value.trim())
            .includes(eventProtocol)
        )
          throw new SyncError(
            400,
            "INVALID_PROTOCOL",
            "Select the ShowAI project event protocol.",
          );
        const origin = request.headers.get("origin");
        if (
          origin &&
          origin !==
            new URL(this.env.SHOWAI_SERVER_URL ?? request.url).origin &&
          !this.env.SHOWAI_ALLOWED_ORIGINS?.split(",").includes(origin)
        )
          throw new SyncError(403, "FORBIDDEN", "Untrusted event origin.");
        if (this.ctx.getWebSockets().length >= 1024)
          throw new SyncError(429, "BUSY", "Project update capacity is busy.");
        const identity = await this.app.events!.authenticate(request);
        const Pair = (
          globalThis as unknown as {
            WebSocketPair: new () => { 0: EventSocket; 1: EventSocket };
          }
        ).WebSocketPair;
        const pair = new Pair();
        pair[1].serializeAttachment(identity);
        this.ctx.acceptWebSocket(pair[1]);
        return new Response(null, {
          status: 101,
          webSocket: pair[0],
          headers: { "sec-websocket-protocol": eventProtocol },
        } as ResponseInit);
      } catch (error) {
        if (error instanceof SyncError)
          return json(
            { error: { code: error.code, message: error.message } },
            error.status,
          );
        throw error;
      }
    }
    return this.app.fetch(request, {
      source: request.headers.get("cf-connecting-ip") ?? "unknown",
    });
  }
  async webSocketMessage(socket: EventSocket, message: string | ArrayBuffer) {
    await this.ready;
    try {
      if (typeof message !== "string")
        throw new SyncError(
          400,
          "INVALID_EVENT",
          "Project event requests use JSON.",
        );
      await this.app.events!.receive(this.peer(socket), message);
    } catch (error) {
      const code =
        error instanceof SyncError
          ? error.code
          : error instanceof SyntaxError
            ? "INVALID_JSON"
            : "SERVER_ERROR";
      if (code === "SERVER_ERROR")
        console.error("Cloud project update failed", error);
      socket.send(
        JSON.stringify({
          type: "error",
          code,
          message: "Reconnect after checking server status.",
        }),
      );
      socket.close(
        code === "UNAUTHORIZED" ? 4001 : 1008,
        "Project update request failed.",
      );
    }
  }
  webSocketClose(socket: EventSocket, code: number, reason: string) {
    socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
  }
  async alarm() {
    await this.ready;
    await this.objects.archive();
  }
}
