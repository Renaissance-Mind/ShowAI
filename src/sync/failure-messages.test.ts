import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SyncManager, syncFailure } from "./manager";
import { SyncError } from "./protocol";
import { CoreError } from "../core/model";
import { serverFetch } from "./server-fetch";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function listen(handler: Parameters<typeof createServer>[1]) {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () => new Promise((resolve) => server.close(() => resolve(undefined))),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return `http://127.0.0.1:${address.port}`;
}

async function manager() {
  const home = await mkdtemp(join(tmpdir(), "showai-sync-failure-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  return new SyncManager(home);
}

it("classifies sync failures into network, sign-in, server and local writes", async () => {
  expect(syncFailure(new SyncError(401, "UNAUTHORIZED", "expired"))).toMatchObject({
    errorKind: "auth",
    errorDetail: "expired",
  });
  expect(syncFailure(new SyncError(503, "SERVER_ERROR", "down"))).toMatchObject({
    errorKind: "server",
  });
  const local = Object.assign(new Error("ENOSPC: no space left on device"), {
    code: "ENOSPC",
  });
  expect(syncFailure(local)).toEqual({
    error: local.message,
    errorKind: "local",
    errorDetail: local.message,
  });
  expect(syncFailure(new CoreError("INVALID_DATA", "bad"))).toMatchObject({
    errorKind: "local",
  });
  // A real refused connection: the translated sentence first, raw text kept.
  const unreachable = await serverFetch(`http://127.0.0.1:1/api/info`).catch(
    (error: unknown) => error,
  );
  expect(unreachable).toBeInstanceOf(TypeError);
  const network = syncFailure(unreachable);
  expect(network.errorKind).toBe("network");
  expect(network.error).not.toMatch(/ECONNREFUSED/);
  expect(network.errorDetail).toMatch(/ECONNREFUSED|connect/i);
});

it("names a website address instead of failing on its HTML", async () => {
  const url = await listen((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>ShowAI</title><p>Welcome</p>");
  });
  const sync = await manager();
  const error = await sync.serverInfo(url).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(CoreError);
  expect((error as Error).message).toMatch(/\/cloud/);
  expect((error as Error).message).not.toMatch(/SyntaxError|JSON/);
});
