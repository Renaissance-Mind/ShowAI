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
  (globalThis as Record<string, unknown>).WebSocketRequestResponsePair =
    class {
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
    f.database.prepare("SELECT COUNT(*) AS count FROM server_write_leases").get(),
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
