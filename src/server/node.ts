import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, open } from "node:fs/promises";
import { atomicRename } from "../core/atomic-rename";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { syncProtocol } from "../sync/protocol";
import { serverBaseUrl } from "../sync/server-url";
import { createSyncServer, type ServerOptions } from "./app";
import {
  schema,
  type MetadataStore,
  type ObjectStore,
  type SqlStatement,
  type SqlValue,
} from "./storage";
export { schema };
export { migrations } from "./migrations";

export class SQLiteMetadata implements MetadataStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;",
    );
  }
  async all<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...values) as T[];
  }
  async run(sql: string, values: SqlValue[] = []) {
    const result = this.db.prepare(sql).run(...values);
    return { changes: Number(result.changes) };
  }
  async batch(statements: SqlStatement[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => ({
        changes: Number(
          this.db.prepare(statement.sql).run(...(statement.values ?? []))
            .changes,
        ),
      }));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
export class DiskObjects implements ObjectStore {
  constructor(readonly root: string) {}
  private path(key: string) {
    if (!/^projects\/[A-Za-z0-9_-]+\/objects\/[a-f0-9]{64}$/.test(key))
      throw new Error("Invalid object storage key.");
    return join(this.root, key);
  }
  async get(key: string) {
    return readFile(this.path(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  }
  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key),
      folder = dirname(path);
    await mkdir(folder, { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await atomicRename(temporary, path);
    // Windows cannot fsync a directory handle; the object itself is flushed above.
    if (process.platform !== "win32") {
      const directory = await open(folder, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }
}
export async function startSyncServer(
  options: Omit<ServerOptions, "metadata" | "objects"> & {
    home: string;
    host?: string;
    port?: number;
  },
): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const home = resolve(options.home);
  await mkdir(home, { recursive: true });
  const metadata = new SQLiteMetadata(join(home, "metadata.sqlite"));
  const app = createSyncServer({
    ...options,
    metadata,
    objects: new DiskObjects(join(home, "objects")),
  });
  await app.initialize();
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > 64 * 1024 * 1024) {
          outgoing.writeHead(413);
          outgoing.end("Request is too large.");
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (value)
          headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const method = incoming.method ?? "GET";
      const response = await app.fetch(
        new Request(
          `http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`,
          {
            method,
            headers,
            ...(method !== "GET" && method !== "HEAD"
              ? { body: Uint8Array.from(Buffer.concat(chunks)) }
              : {}),
          },
        ),
        { source: incoming.socket.remoteAddress ?? "unknown" },
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body)
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>)
          outgoing.write(chunk);
      outgoing.end();
    } catch (error) {
      console.error("ShowAI Server HTTP failure", error);
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end("Server request failed.");
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8788, options.host ?? "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address.");
  return {
    server,
    url: `http://${options.host === "0.0.0.0" ? "127.0.0.1" : (options.host ?? "127.0.0.1")}:${address.port}${options.publicUrl ? new URL(serverBaseUrl(options.publicUrl)).pathname.replace(/\/$/, "") : ""}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      metadata.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const running = await startSyncServer({
    home: process.env.SHOWAI_SERVER_HOME ?? "./showai-server-data",
    host: process.env.SHOWAI_SERVER_HOST ?? "127.0.0.1",
    port: Number(process.env.SHOWAI_SERVER_PORT ?? 8788),
    name: process.env.SHOWAI_SERVER_NAME,
    publicUrl: process.env.SHOWAI_SERVER_URL,
    registrationKey: process.env.SHOWAI_REGISTRATION_KEY,
    registrationMode: process.env
      .SHOWAI_REGISTRATION_MODE as ServerOptions["registrationMode"],
    registrationLimit: process.env.SHOWAI_REGISTRATION_LIMIT
      ? Number(process.env.SHOWAI_REGISTRATION_LIMIT)
      : undefined,
    accountLimit: process.env.SHOWAI_ACCOUNT_LIMIT
      ? Number(process.env.SHOWAI_ACCOUNT_LIMIT)
      : undefined,
    allowedOrigins:
      process.env.SHOWAI_ALLOWED_ORIGINS?.split(",").filter(Boolean),
  });
  console.log(
    JSON.stringify({
      protocol: syncProtocol,
      url: running.url,
      home: resolve(process.env.SHOWAI_SERVER_HOME ?? "./showai-server-data"),
    }),
  );
  const shutdown = () => {
    void running.close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
