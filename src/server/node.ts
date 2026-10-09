import { createServer, type Server } from "node:http";
import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { syncProtocol } from "../sync/protocol";
import { serverBaseUrl } from "../sync/server-url";
import { createSyncServer, type ServerOptions } from "./app";
import { SQLiteMetadata, DiskObjects } from "./node-storage";
export { SQLiteMetadata, DiskObjects } from "./node-storage";
export { schema } from "./storage";
export { migrations, prepareMetadata } from "./migrations";
export { Revisions } from "./revisions";
export { planServerCleanup } from "./cleanup-plan";
export {
  exportServerBackup,
  verifyServerBackup,
  restoreServerBackup,
  operationsRequest,
} from "./backup";
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
              ? {
                  body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
                  duplex: "half" as const,
                }
              : {}),
          },
        ),
        { source: incoming.socket.remoteAddress ?? "unknown" },
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body)
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>)
          if (!outgoing.write(chunk)) await once(outgoing, "drain");
      outgoing.end();
      incoming.resume();
    } catch (error) {
      console.error("ShowAI Server HTTP failure", error);
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end("Server request failed.");
    }
  });
  server.requestTimeout = 120_000;
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
    storagePolicy: process.env.SHOWAI_STORAGE_POLICY
      ? JSON.parse(process.env.SHOWAI_STORAGE_POLICY)
      : undefined,
    allowedOrigins:
      process.env.SHOWAI_ALLOWED_ORIGINS?.split(",").filter(Boolean),
    operationsKey: process.env.SHOWAI_OPERATIONS_KEY,
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
