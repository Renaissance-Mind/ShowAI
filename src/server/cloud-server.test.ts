import { afterEach, expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ShowAIServer } from "./cloud-server";
import { token } from "../sync/protocol";
import type { WorkerEnvironment } from "./worker";

/** The parts of the Durable Object runtime the server uses, over node:sqlite. */
function durableState(database: DatabaseSync, sockets: FakeSocket[]) {
  const values = new Map<string, unknown>();
  const state = {
    autoResponse: undefined as unknown,
    storage: {
      sql: {
        exec(sql: string, ...bindings: unknown[]) {
          const statement = database.prepare(sql);
          const parameters = bindings.map((value) =>
            value instanceof ArrayBuffer ? new Uint8Array(value) : value,
          ) as never[];
          const rows = statement.columns().length
            ? (statement.all(...parameters) as Record<string, unknown>[])
            : (statement.run(...parameters), []);
          return {
            toArray: () => rows,
            one: () => {
              if (!rows[0]) throw new Error("Expected one row.");
              return rows[0];
            },
          };
        },
      },
      transactionSync<T>(run: () => T) {
        database.exec("BEGIN");
        try {
          const result = run();
          database.exec("COMMIT");
          return result;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
      async get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
      async put(key: string, value: unknown) {
        values.set(key, value);
      },
      async setAlarm() {},
    },
    acceptWebSocket(socket: FakeSocket) {
      sockets.push(socket);
    },
    getWebSockets: () => sockets,
    async blockConcurrencyWhile<T>(run: () => Promise<T>) {
      return run();
    },
    setWebSocketAutoResponse(pair: unknown) {
      state.autoResponse = pair;
    },
  };
  return state;
}
class FakeSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  closed?: number;
  constructor(private attachment: unknown) {}
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
  send(message: string) {
    this.sent.push(message);
  }
  close(code: number) {
    this.closed = code;
  }
}
const previousPair = (globalThis as Record<string, unknown>)
  .WebSocketRequestResponsePair;
afterEach(() => {
  (globalThis as Record<string, unknown>).WebSocketRequestResponsePair =
    previousPair;
});

function fixture() {
  (globalThis as Record<string, unknown>).WebSocketRequestResponsePair = class {
    constructor(
      readonly request: string,
      readonly response: string,
    ) {}
  };
  const database = new DatabaseSync(":memory:"),
    sockets: FakeSocket[] = [];
  const env = {
    SHOWAI_SERVER_URL: "https://cloud.test/cloud",
    SHOWAI_REGISTRATION_KEY: "contract-key",
    SHOWAI_VAULT_KEY: token(),
    SHOWAI_OPERATIONS_KEY: token(),
  } as unknown as WorkerEnvironment;
  const start = () => {
    const ctx = durableState(database, sockets);
    return { ctx, server: new ShowAIServer(ctx as never, env) };
  };
  return { database, sockets, start };
}
const request = (
  server: ShowAIServer,
  path: string,
  method = "GET",
  data?: unknown,
  credential?: string,
) =>
  server.fetch(
    new Request(`https://cloud.test/cloud${path}`, {
      method,
      headers: {
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
  );

test("a reset Durable Object releases write admissions left by the previous instance", async () => {
  const f = fixture();
  const first = f.start();
  expect((await request(first.server, "/api/info")).status).toBe(200);
  for (let index = 0; index < 64; index++)
    f.database
      .prepare(
        "INSERT INTO server_write_leases(id,started_at,kind) VALUES(?,?,'object')",
      )
      .run(`leaked-${index}`, new Date().toISOString());
  const second = f.start();
  expect((await request(second.server, "/api/info")).status).toBe(200);
  expect(
    f.database
      .prepare("SELECT COUNT(*) AS count FROM server_write_leases")
      .get(),
  ).toEqual({ count: 0 });
});

test("hibernated sockets keep subscriptions outside their attachment and pings never wake the object", async () => {
  const f = fixture();
  const first = f.start();
  expect(first.ctx.autoResponse).toMatchObject({
    request: JSON.stringify({ type: "ping" }),
    response: JSON.stringify({ type: "pong" }),
  });
  const registered = await request(first.server, "/api/auth/register", "POST", {
    name: "owner",
    password: "test-password",
    registrationKey: "contract-key",
  });
  const account = await registered.json();
  const ids = Array.from({ length: 400 }, (_, index) => `project-${index}`);
  const socket = new FakeSocket({
    userId: account.user.id,
    sessionDigest: [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(account.token),
        ),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    socketId: "socket-one",
  });
  f.sockets.push(socket);
  await first.server.webSocketMessage(
    socket as never,
    JSON.stringify({ type: "subscribe", ids }),
  );
  expect(socket.closed).toBeUndefined();
  expect(JSON.stringify(socket.deserializeAttachment()).length).toBeLessThan(
    300,
  );
  // A new instance after hibernation restores the subscription from storage.
  const second = f.start();
  await request(second.server, "/api/info");
  const peer = (
    second.server as unknown as {
      peer(socket: FakeSocket): { identity(): { projects: string[] } };
    }
  ).peer(socket);
  expect(peer.identity().projects).toEqual(ids);
  await second.server.webSocketClose(socket as never, 1000, "done");
  expect(
    f.database
      .prepare("SELECT COUNT(*) AS count FROM _showai_event_subscriptions")
      .get(),
  ).toEqual({ count: 0 });
});

/** R2 as the Worker uses it, kept in memory. */
function memoryBucket() {
  const items = new Map<string, Uint8Array>();
  const bytesOf = async (value: Uint8Array | ReadableStream<Uint8Array>) =>
    value instanceof Uint8Array
      ? value.slice()
      : new Uint8Array(await new Response(value).arrayBuffer());
  const binding = {
    async head(key: string) {
      const item = items.get(key);
      return item ? { size: item.length, uploaded: new Date() } : null;
    },
    async list() {
      return {
        objects: [...items].map(([key, item]) => ({
          key,
          size: item.length,
          uploaded: new Date(),
        })),
        truncated: false,
      };
    },
    async get(key: string) {
      const item = items.get(key);
      return item
        ? {
            size: item.length,
            body: new Blob([new Uint8Array(item)]).stream(),
            arrayBuffer: async () => item.slice().buffer,
          }
        : null;
    },
    async put(key: string, value: Uint8Array | ReadableStream<Uint8Array>) {
      items.set(key, await bytesOf(value));
    },
    async delete(key: string) {
      items.delete(key);
    },
    async createMultipartUpload(key: string) {
      const parts = new Map<number, Uint8Array>();
      return {
        async uploadPart(index: number, bytes: Uint8Array) {
          parts.set(index, bytes.slice());
          return { partNumber: index, etag: String(index) };
        },
        async complete(list: { partNumber: number }[]) {
          items.set(
            key,
            Buffer.concat(list.map((part) => parts.get(part.partNumber)!)),
          );
        },
        async abort() {},
      };
    },
  };
  return { items, binding };
}

test("large objects stream between the Worker and R2 while the Durable Object keeps authority", async () => {
  // Workers provide DigestStream; node:crypto stands in for it here.
  const { createHash } = await import("node:crypto");
  class DigestStream extends WritableStream<Uint8Array> {
    digest: Promise<ArrayBuffer>;
    constructor() {
      const hash = createHash("sha256");
      let done!: (value: ArrayBuffer) => void;
      const digest = new Promise<ArrayBuffer>((resolve) => (done = resolve));
      super({
        write: (chunk) => void hash.update(chunk),
        close: () => done(new Uint8Array(hash.digest()).buffer),
      });
      this.digest = digest;
    }
  }
  Object.defineProperty(globalThis.crypto, "DigestStream", {
    value: DigestStream,
    configurable: true,
  });
  const worker = (await import("./worker")).default;
  const f = fixture();
  const bucket = memoryBucket();
  const seen: (string | null)[] = [];
  const env = {
    SHOWAI_SERVER_URL: "https://cloud.test/cloud",
    SHOWAI_REGISTRATION_KEY: "contract-key",
    SHOWAI_VAULT_KEY: token(),
    SHOWAI_METADATA_DRIVER: "durable",
    CONTENT: bucket.binding,
  } as unknown as WorkerEnvironment;
  const ctx = durableState(f.database, f.sockets);
  const server = new ShowAIServer(ctx as never, env);
  (env as unknown as { SERVER: unknown }).SERVER = {
    idFromName: () => "server",
    get: () => ({
      fetch: (request: Request) => {
        seen.push(request.headers.get("x-showai-transfer"));
        return server.fetch(request);
      },
    }),
  };
  const call = (path: string, init: RequestInit & { token?: string } = {}) =>
    worker.fetch(
      new Request(`https://cloud.test/cloud${path}`, {
        ...init,
        headers: {
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
          ...(init.headers as Record<string, string>),
        },
      }),
      env,
    );
  const account = await (
    await call("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "owner",
        password: "test-password",
        registrationKey: "contract-key",
      }),
    })
  ).json();
  const id = crypto.randomUUID();
  expect(
    (
      await call("/api/projects", {
        method: "POST",
        token: account.token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, name: "Transfer" }),
      })
    ).status,
  ).toBe(201);
  const bytes = new Uint8Array(300 * 1024).map((_, index) => index % 251);
  const digest = createHash("sha256").update(bytes).digest("hex");
  seen.length = 0;
  const stored = await call(`/api/projects/${id}/objects/${digest}`, {
    method: "PUT",
    token: account.token,
    headers: { "content-length": String(bytes.length) },
    body: bytes,
  });
  expect(stored.status).toBe(200);
  expect(seen).toEqual(["admit", "commit"]);
  expect(bucket.items.get(`projects/${id}/objects/${digest}`)).toEqual(bytes);
  const count = (sql: string) =>
    (f.database.prepare(sql).get() as { count: number }).count;
  expect(count("SELECT COUNT(*) AS count FROM _showai_hot_objects")).toBe(0);
  expect(count("SELECT COUNT(*) AS count FROM server_write_leases")).toBe(0);
  expect(count("SELECT COUNT(*) AS count FROM storage_reservations")).toBe(0);
  seen.length = 0;
  const read = await call(`/api/projects/${id}/objects/${digest}`, {
    token: account.token,
  });
  expect(read.status).toBe(200);
  expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
  expect(seen).toEqual(["read"]);
  // A body that does not match its digest is refused and releases capacity.
  const wrong = new Uint8Array(bytes.length).fill(9);
  const refused = await call(`/api/projects/${id}/objects/${"a".repeat(64)}`, {
    method: "PUT",
    token: account.token,
    headers: { "content-length": String(wrong.length) },
    body: wrong,
  });
  expect(refused.status).toBe(400);
  expect((await refused.json()).error.code).toBe("DIGEST_MISMATCH");
  expect(count("SELECT COUNT(*) AS count FROM server_write_leases")).toBe(0);
  expect(count("SELECT COUNT(*) AS count FROM storage_reservations")).toBe(0);
  // Clients cannot speak the internal protocol themselves.
  seen.length = 0;
  const forged = await call(`/api/projects/${id}/objects/${digest}`, {
    method: "POST",
    token: account.token,
    headers: {
      "x-showai-transfer": "commit",
      "content-type": "application/json",
    },
    body: JSON.stringify({ reservation: "x", lease: "y", length: 1 }),
  });
  expect(seen).toEqual([null]);
  expect(forged.status).toBe(404);
});
