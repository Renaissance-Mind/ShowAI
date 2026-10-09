import { createServer, type Server } from "node:http";
import { mkdir, readFile, writeFile, chmod, lstat } from "node:fs/promises";
import { Readable } from "node:stream";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  eventProtocol,
  maximumEventInput,
  type EventIdentity,
} from "../sync/events";
import { SyncError, token } from "../sync/protocol";
import type { EventPeer } from "./events";
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
    realtime?: boolean;
  },
): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const home = resolve(options.home);
  await mkdir(home, { recursive: true });
  const keyPath = join(home, "vault.key");
  let vaultKey = options.vaultKey;
  if (!vaultKey) {
    vaultKey = await readFile(keyPath, "utf8").catch(
      async (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        const existing = await lstat(join(home, "metadata.sqlite")).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (existing) {
          const probe = new SQLiteMetadata(join(home, "metadata.sqlite"));
          try {
            for (const table of [
              "account_identities",
              "account_resources",
              "login_flows",
            ]) {
              if (
                (
                  await probe.all(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                    [table],
                  )
                ).length &&
                (await probe.all(`SELECT 1 FROM ${table} LIMIT 1`)).length
              )
                throw new Error(
                  "This restored server contains encrypted credentials. Restore its original vault.key or supply SHOWAI_VAULT_KEY before starting.",
                );
            }
          } finally {
            probe.close();
          }
        }
        const key = token();
        await writeFile(keyPath, key, { mode: 0o600, flag: "wx" }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          },
        );
        return readFile(keyPath, "utf8");
      },
    );
    await chmod(keyPath, 0o600);
  }
  const metadata = new SQLiteMetadata(join(home, "metadata.sqlite"));
  const peers = new Set<EventPeer>();
  const app = createSyncServer({
    ...options,
    vaultKey,
    metadata,
    objects: new DiskObjects(join(home, "objects")),
    eventPeers: options.realtime === false ? undefined : () => peers,
    metadataDriver: "sqlite",
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
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: maximumEventInput,
    handleProtocols: (protocols) =>
      protocols.has(eventProtocol) ? eventProtocol : false,
  });
  const socketWork = new Set<Promise<unknown>>();
  server.on("upgrade", (incoming, socket, head) => {
    const accept = async () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (value)
          headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const request = new Request(
        `http://${incoming.headers.host}${incoming.url}`,
        { headers },
      );
      const basePath = options.publicUrl
        ? new URL(serverBaseUrl(options.publicUrl)).pathname.replace(/\/$/, "")
        : "";
      if (
        !app.events ||
        new URL(request.url).pathname !== `${basePath}/api/events` ||
        peers.size >= 1024
      )
        throw new SyncError(404, "NOT_FOUND", "Unknown event endpoint.");
      const origin = headers.get("origin");
      if (
        origin &&
        origin !==
          (options.publicUrl
            ? new URL(options.publicUrl).origin
            : new URL(request.url).origin) &&
        !options.allowedOrigins?.includes(origin)
      )
        throw new SyncError(403, "FORBIDDEN", "Untrusted event origin.");
      let identity: EventIdentity = await app.events.authenticate(request);
      sockets.handleUpgrade(incoming, socket, head, (connection) => {
        const peer: EventPeer = {
          identity: () => identity,
          remember: (value) => {
            identity = value;
          },
          send: (value) => {
            if (connection.readyState === WebSocket.OPEN)
              connection.send(value);
          },
          close: (code, reason) => connection.close(code, reason),
          get bufferedAmount() {
            return connection.bufferedAmount;
          },
        };
        peers.add(peer);
        let pending = Promise.resolve();
        connection.on("message", (bytes, binary) => {
          const work = pending
            .then(async () => {
              if (binary) {
                connection.close(1003, "Project event requests use JSON.");
                return;
              }
              await app.events!.receive(peer, bytes.toString());
            })
            .catch((error: unknown) => {
              const code =
                error instanceof SyncError
                  ? error.code
                  : error instanceof SyntaxError
                    ? "INVALID_JSON"
                    : "SERVER_ERROR";
              if (code === "SERVER_ERROR")
                console.error("ShowAI event delivery failed", error);
              peer.send(
                JSON.stringify({
                  type: "error",
                  code,
                  message:
                    error instanceof SyncError
                      ? error.message
                      : "The project event request failed.",
                }),
              );
              peer.close(
                code === "UNAUTHORIZED" ? 4001 : 1008,
                "Reconnect after checking server status.",
              );
            });
          pending = work;
          socketWork.add(work);
          void work.finally(() => socketWork.delete(work));
        });
        connection.on("close", () => peers.delete(peer));
        connection.on("error", (error) => {
          console.error("ShowAI event socket failed", error.message);
          peers.delete(peer);
        });
      });
    };
    void accept().catch((error: unknown) => {
      const status = error instanceof SyncError ? error.status : 500;
      if (status === 500) console.error("ShowAI event handshake failed", error);
      socket.end(
        `HTTP/1.1 ${status} Event handshake failed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    });
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
      for (const connection of sockets.clients) connection.terminate();
      await new Promise<void>((done) => sockets.close(() => done()));
      await Promise.allSettled(socketWork);
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      metadata.close();
    },
  };
}
