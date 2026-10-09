import { afterEach, expect, test } from "vitest";
import { createServer, request as forwardRequest } from "node:http";
import { request as forwardSecureRequest } from "node:https";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncManager } from "./manager";
import { ContentLibrary as GitLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { startSyncServer } from "../server/node";
import { eventCapability } from "./events";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0).reverse()) await done();
});
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => Promise<boolean>, maximum = 10_000) {
  const deadline = Date.now() + maximum;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error(
        "Real synchronization did not converge before its deadline.",
      );
    await sleep(50);
  }
}
async function fixture(dropFirstUpload = false) {
  const root = await mkdtemp(join(tmpdir(), "showai-scheduler-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const remote = process.env.SHOWAI_SYNC_TEST_URL;
  const local = remote
    ? undefined
    : await startSyncServer({
        home: join(root, "server"),
        port: 0,
        registrationMode: "open",
      });
  if (local) cleanup.push(() => local.close());
  const target = new URL(remote ?? local!.url);
  const calls: { at: number; method: string; path: string }[] = [];
  let uploading = 0,
    maxUploading = 0;
  // A real streaming reverse proxy counts traffic to the real Node or Wrangler
  // backend without replacing responses or intercepting client methods.
  const proxy = createServer((incoming, outgoing) => {
    calls.push({
      at: Date.now(),
      method: incoming.method ?? "GET",
      path: incoming.url ?? "/",
    });
    if (dropFirstUpload && incoming.method === "PUT") {
      dropFirstUpload = false;
      // A real socket failure precedes forwarding; the retry reaches the same backend.
      incoming.destroy();
      return;
    }
    const upload = incoming.method === "PUT";
    if (upload) maxUploading = Math.max(maxUploading, ++uploading);
    const forwarded = (
      target.protocol === "https:" ? forwardSecureRequest : forwardRequest
    )(
      new URL(incoming.url ?? "/", target.origin),
      {
        method: incoming.method,
        headers: { ...incoming.headers, host: target.host },
      },
      (response) => {
        outgoing.writeHead(response.statusCode!, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", (error) => outgoing.destroy(error));
    outgoing.on("close", () => {
      if (upload) uploading--;
    });
    incoming.pipe(forwarded);
  });
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  cleanup.push(async () => {
    proxy.closeAllConnections();
    await new Promise<void>((done, reject) =>
      proxy.close((error) => (error ? reject(error) : done())),
    );
  });
  const address = proxy.address();
  if (!address || typeof address === "string")
    throw new Error("Missing proxy address.");
  const base = `http://127.0.0.1:${address.port}${target.pathname.replace(/\/$/, "")}`;
  const clients = [];
  for (const kind of ["sender", "receiver"]) {
    const home = join(root, kind),
      library = new GitLibrary(home);
    await library.initialize();
    const store = new FileStore(home),
      manager = new SyncManager(home, { events: false });
    cleanup.push(() => manager.stop());
    const connection = await manager.connect({
      url: base,
      account: `${kind}-${crypto.randomUUID()}`,
      password: "scheduler-test-password",
      register: true,
      registrationKey: process.env.SHOWAI_SYNC_TEST_KEY,
    });
    await manager.stop();
    // This suite measures the real HTTP polling fallback. Dedicated event-stream
    // tests exercise direct WebSocket connections on both deployment adapters.
    const saved = await manager.configuration();
    saved.connections[0].capabilities =
      saved.connections[0].capabilities?.filter(
        (item) => item !== eventCapability,
      );
    await writeFile(
      join(home, "local", "sync", "config.json"),
      JSON.stringify(saved),
    );
    clients.push({ home, library, store, manager, connection });
  }
  return { root, base, calls, clients, maxUploading: () => maxUploading };
}

test("a real upload connection loss retries the immutable object and converges", async () => {
  const {
    calls,
    clients: [alice],
  } = await fixture(true);
  const project = await alice.store.createProject({ name: "Transport retry" });
  await alice.store.createPage(project.id, { title: "Preserved after retry" });
  await alice.manager.attach(alice.connection.id, project.id);
  await alice.manager.stop();
  expect((await alice.manager.status()).projects[0].status).toBe("synced");
  const first = calls.find((item) => item.method === "PUT")!;
  expect(
    calls.filter((item) => item.method === "PUT" && item.path === first.path),
  ).toHaveLength(2);
}, 30_000);

test("batch heads hide private projects and background wakes preserve edits and revocations", async () => {
  const {
    base,
    calls,
    clients: [alice, bob],
    maxUploading,
  } = await fixture();
  const projects: Awaited<ReturnType<FileStore["createProject"]>>[] = [];
  for (let index = 0; index < 10; index++) {
    const project = await alice.store.createProject({
      name: `Scheduler ${index}`,
    });
    await alice.store.createPage(project.id, { title: `Original ${index}` });
    await alice.manager.attach(alice.connection.id, project.id);
    await alice.manager.stop();
    projects.push(project);
  }
  const own = (await alice.manager.configuration()).connections[0];
  const foreign = (await bob.manager.configuration()).connections[0];
  const heads = async (credential: string, ids: string[]) => {
    const response = await fetch(base + "/api/projects/heads", {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids }),
    });
    return { status: response.status, body: await response.json() };
  };
  expect(
    (
      await heads(
        foreign.token,
        projects.map((item) => item.id),
      )
    ).body.projects,
  ).toEqual([]);
  expect(
    (
      await heads(own.token, [
        projects[0].id,
        projects[0].id,
        crypto.randomUUID(),
      ])
    ).body.projects,
  ).toHaveLength(1);
  expect((await heads(own.token, Array(401).fill(projects[0].id))).status).toBe(
    400,
  );
  await alice.manager.run();
  const before = (await alice.manager.status()).scheduler;
  calls.splice(0);
  alice.manager.start();
  alice.manager.wake();
  await until(
    async () =>
      (await alice.manager.status()).scheduler.cycles > before.cycles &&
      !(await alice.manager.status()).running,
  );
  await alice.manager.stop();
  expect(calls.map((item) => item.path)).toEqual([
    new URL(base).pathname.replace(/\/$/, "") + "/api/projects/heads",
  ]);
  const after = (await alice.manager.status()).scheduler;
  expect(after.scanned).toBe(before.scanned);
  expect(after.skipped - before.skipped).toBe(10);
  expect(maxUploading()).toBeLessThanOrEqual(2);
  expect(maxUploading()).toBe(2);
  calls.splice(0);
  await Promise.all(
    Array.from({ length: 20 }, () => alice.manager.run(projects[0].id)),
  );
  expect(
    calls.filter((item) => item.path.endsWith("/api/projects/heads")),
  ).toHaveLength(2);
  expect(calls).toHaveLength(2);

  // A saved connection from a server without the additive batch capability
  // still reads real per-project heads and skips unchanged full scans.
  const legacy = await alice.manager.configuration();
  legacy.connections[0].capabilities =
    legacy.connections[0].capabilities?.filter(
      (item) => item !== "batch-heads-v1",
    );
  await writeFile(
    join(alice.home, "local", "sync", "config.json"),
    JSON.stringify(legacy),
  );
  calls.splice(0);
  const legacyBefore = (await alice.manager.status()).scheduler;
  alice.manager.start();
  alice.manager.wake();
  await until(
    async () =>
      (await alice.manager.status()).scheduler.cycles > legacyBefore.cycles &&
      !(await alice.manager.status()).running,
  );
  await alice.manager.stop();
  expect(calls).toHaveLength(10);
  expect(
    calls.every(
      (item) =>
        item.method === "GET" && /\/api\/projects\/[^/]+$/.test(item.path),
    ),
  ).toBe(true);
  expect((await alice.manager.status()).scheduler.scanned).toBe(
    legacyBefore.scanned,
  );
  // Restore the negotiated capability before the shared edit acceptance.
  const restored = await alice.manager.configuration();
  restored.connections[0].capabilities = own.capabilities;
  await writeFile(
    join(alice.home, "local", "sync", "config.json"),
    JSON.stringify(restored),
  );

  const shared = projects[0];
  const invitation = (await alice.manager.manage(
    alice.connection.id,
    shared.id,
    "invite",
    { role: "editor" },
  )) as { url: string };
  await bob.manager.join(bob.connection.id, invitation.url);
  await bob.manager.stop();
  await bob.manager.run();
  await alice.manager.run();
  const page = (await alice.store.listPages(shared.id))[0];
  const saved = await alice.store.readPage(shared.id, page.id);
  await alice.store.savePage(
    shared.id,
    page.id,
    { ...saved.document, title: "Background local edit" },
    saved.hash,
    saved.revision,
  );
  alice.manager.start();
  bob.manager.start();
  alice.manager.wake([shared.id]);
  bob.manager.wake();
  await until(
    async () =>
      (await bob.store.readPage(shared.id, page.id)).document.title ===
      "Background local edit",
  );
  await alice.manager.manage(alice.connection.id, shared.id, "member", {
    userId: bob.connection.user.id,
    role: null,
  });
  bob.manager.wake();
  await until(
    async () => (await bob.manager.status()).projects[0].status === "revoked",
  );
  expect((await bob.store.readPage(shared.id, page.id)).document.title).toBe(
    "Background local edit",
  );
}, 120_000);

test.runIf(process.env.SHOWAI_SCHEDULER_MEASURE === "1")(
  "measures ten-project idle traffic and active edit visibility on a real backend",
  async () => {
    const {
      calls,
      clients: [alice, bob],
      maxUploading,
    } = await fixture();
    const projects = [];
    for (let index = 0; index < 10; index++) {
      const project = await alice.store.createProject({
        name: `Measured ${index}`,
      });
      await alice.store.createPage(project.id, { title: `Page ${index}` });
      await alice.manager.attach(alice.connection.id, project.id);
      await alice.manager.stop();
      projects.push(project);
    }
    const shared = projects[0];
    const invitation = (await alice.manager.manage(
      alice.connection.id,
      shared.id,
      "invite",
      { role: "editor" },
    )) as { url: string };
    await bob.manager.join(bob.connection.id, invitation.url);
    await bob.manager.stop();
    await alice.manager.run();
    await bob.manager.run();
    const page = (await alice.store.listPages(shared.id))[0];
    alice.manager.start();
    bob.manager.start();
    bob.manager.wake();
    const latency: number[] = [];
    for (let index = 0; index < 20; index++) {
      const record = await alice.store.readPage(shared.id, page.id),
        title = `Measured edit ${index}`;
      const begun = Date.now();
      await alice.store.savePage(
        shared.id,
        page.id,
        { ...record.document, title },
        record.hash,
        record.revision,
      );
      alice.manager.wake([shared.id]);
      await until(
        async () =>
          (await bob.store.readPage(shared.id, page.id)).document.title ===
          title,
        15_000,
      );
      latency.push(Date.now() - begun);
    }
    await bob.manager.stop();
    await until(async () => !(await alice.manager.status()).running);
    // Let the real active window expire; no clock stubs or private-field overrides.
    await until(
      async () =>
        Date.now() > (await alice.manager.status()).scheduler.activeUntil,
      70_000,
    );
    const before = (await alice.manager.status()).scheduler;
    calls.splice(0);
    const begun = Date.now();
    await sleep(65_000);
    await alice.manager.stop();
    const after = (await alice.manager.status()).scheduler;
    const elapsedMs = Date.now() - begun;
    const legacyRequests = 10 * Math.floor(elapsedMs / 5000);
    const reduction = 1 - calls.length / legacyRequests;
    const ordered = [...latency].sort((a, b) => a - b);
    const receipt = {
      backend: process.env.SHOWAI_SYNC_TEST_URL
        ? "wrangler-or-remote"
        : "node-sqlite-disk",
      projects: 10,
      idleWindowMs: elapsedMs,
      requests: calls.length,
      legacyRequests,
      reduction,
      idleScans: after.scanned - before.scanned,
      idleSkipped: after.skipped - before.skipped,
      activeSamples: latency.length,
      activeP50Ms: ordered[Math.ceil(ordered.length * 0.5) - 1],
      activeP95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
      maxConcurrentUploads: maxUploading(),
    };
    if (process.env.SHOWAI_SCHEDULER_RECEIPT) {
      const path = process.env.SHOWAI_SCHEDULER_RECEIPT;
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, JSON.stringify(receipt, null, 2));
    }
    console.log("Synchronization measurement", JSON.stringify(receipt));
    expect(receipt.activeP95Ms).toBeLessThanOrEqual(5000);
    expect(reduction).toBeGreaterThanOrEqual(0.9);
    expect(receipt.idleScans).toBe(0);
  },
  300_000,
);
