import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { startSyncServer } from "../server/node";
import { ContentLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { SyncManager } from "./manager";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture(proxy = false) {
  const root = await mkdtemp(join(tmpdir(), "showai-lifecycle-"));
  cleanup.push(() =>
    rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  );
  const server = await startSyncServer({
    home: join(root, "server"),
    port: 0,
    registrationMode: "open",
  });
  cleanup.push(() => server.close());
  let intercepted!: () => void,
    release = () => {};
  const objectStarted = new Promise<void>((done) => {
    intercepted = done;
  });
  let hold = proxy;
  let clientUrl = server.url;
  if (proxy) {
    const gateway = createServer(async (req, res) => {
      const bytes: Buffer[] = [];
      for await (const chunk of req) bytes.push(Buffer.from(chunk));
      const upstream = await fetch(server.url + req.url, {
        method: req.method,
        headers: {
          ...(req.headers.authorization
            ? { authorization: req.headers.authorization }
            : {}),
          ...(req.headers["content-type"]
            ? { "content-type": req.headers["content-type"] }
            : {}),
        },
        body: bytes.length ? Buffer.concat(bytes) : undefined,
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
      });
      const throttled =
        hold && req.method === "GET" && req.url?.includes("/objects/");
      if (throttled) {
        res.write(body.subarray(0, 1));
        intercepted();
        await new Promise<void>((done) => {
          release = done;
          res.once("close", done);
        });
      }
      res.end(body.subarray(throttled ? 1 : 0));
    });
    await new Promise<void>((done) => gateway.listen(0, "127.0.0.1", done));
    clientUrl = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
    cleanup.push(async () => {
      release();
      gateway.closeAllConnections();
      await new Promise<void>((done) => gateway.close(() => done()));
    });
  }
  const clients = [];
  for (const [name, url] of [
    ["alice", server.url],
    ["bob", clientUrl],
  ]) {
    const home = join(root, name);
    await new ContentLibrary(home).initialize();
    const manager = new SyncManager(home, { events: false }),
      store = new FileStore(home);
    cleanup.push(() => manager.stop());
    const connection = await manager.connect({
      url,
      account: name,
      password: "lifecycle-test-password",
      register: true,
    });
    await manager.stop();
    clients.push({ home, manager, store, connection });
  }
  const [alice, bob] = clients;
  const project = await alice.store.createProject({
    name: "Lifecycle project",
  });
  const page = await alice.store.createPage(project.id, { title: "Original" });
  await alice.manager.attach(alice.connection.id, project.id);
  await alice.manager.stop();
  const invitation = (await alice.manager.manage(
    alice.connection.id,
    project.id,
    "invite",
    { role: "editor" },
  )) as { url: string };
  await bob.manager.join(bob.connection.id, invitation.url, false);
  return {
    root,
    alice,
    bob,
    project,
    page,
    objectStarted,
    holdObjects: () => {
      hold = true;
      return new Promise<void>((done) => {
        intercepted = done;
      });
    },
    release: () => {
      hold = false;
      release();
    },
  };
}
it("keeps local identity, unsent changes and the merge baseline across stop, restart and resume", async () => {
  const { alice, bob, project, page } = await fixture();
  await bob.manager.subscribe(bob.connection.id, project.id);
  await bob.manager.stop();
  await bob.manager.setProjectVisibility(project.id, false);
  await bob.manager.setEnabled(project.id, false);
  const stored = JSON.parse(
    await readFile(join(bob.home, "local", "sync", "config.json"), "utf8"),
  );
  expect(
    stored.projects.some(
      (item: { projectId: string }) => item.projectId === project.id,
    ),
  ).toBe(false);
  expect(
    stored.pausedProjects.map((item: { projectId: string }) => item.projectId),
  ).toContain(project.id);
  expect(stored.localProjectIds).toContain(project.id);

  const localPage = await bob.store.readPage(project.id, page.document.id);
  await bob.store.updatePageMetadata(
    project.id,
    page.document.id,
    { title: "Local while stopped" },
    localPage.hash,
    localPage.revision,
  );
  expect((await bob.manager.pausePlan(project.id)).pending).toBe(true);
  await alice.store.createPage(project.id, { title: "Remote while stopped" });
  await alice.manager.run(project.id);
  const reopened = new SyncManager(bob.home, { events: false });
  cleanup.push(() => reopened.stop());
  await expect(reopened.run(project.id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(
    (await bob.store.listPages(project.id)).map((p) => p.title),
  ).not.toContain("Remote while stopped");
  const resumed = await reopened.setEnabled(project.id, true);
  expect(resumed.projects).toHaveLength(1);
  expect(resumed.projects[0].projectId).toBe(project.id);
  expect(resumed.projects[0].paused).toBe(false);
  expect(resumed.hiddenProjectIds).toContain(project.id);
  expect(
    (await bob.store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Local while stopped");
  expect((await bob.store.listPages(project.id)).map((p) => p.title)).toContain(
    "Remote while stopped",
  );
  await alice.manager.run(project.id);
  expect(
    (await alice.store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Local while stopped");
}, 30000);
it("cancels a real in-flight object stream without importing a partial project and can retry", async () => {
  const f = await fixture(true),
    { bob, project } = f;
  const requestId = crypto.randomUUID();
  const download = bob.manager.subscribe(
    bob.connection.id,
    project.id,
    requestId,
  );
  await Promise.race([
    f.objectStarted,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Object transfer did not start")),
        8000,
      ),
    ),
  ]);
  expect((await bob.manager.status()).downloads).toHaveLength(1);
  await bob.manager.cancelDownload(bob.connection.id, project.id, requestId);
  await download;
  expect((await bob.manager.status()).downloads).toHaveLength(0);
  expect(await bob.store.listProjects({ includeArchived: true })).toHaveLength(
    0,
  );
  expect((await bob.manager.configuration()).projects).toHaveLength(0);
  const files = await readdir(join(bob.home, "local", "sync"), {
    recursive: true,
  });
  expect(files.some((file) => file.endsWith(".partial"))).toBe(false);
  f.release();
  await bob.manager.subscribe(
    bob.connection.id,
    project.id,
    crypto.randomUUID(),
  );
  expect((await bob.store.listProjects()).map((p) => p.id)).toEqual([
    project.id,
  ]);
}, 30000);
it("honors cancellation arriving before download enrollment without cancelling a later attempt", async () => {
  const { bob, project } = await fixture();
  const id = crypto.randomUUID();
  await bob.manager.cancelDownload(bob.connection.id, project.id, id);
  await bob.manager.subscribe(bob.connection.id, project.id, id);
  expect(await bob.store.listProjects()).toHaveLength(0);
  await bob.manager.subscribe(
    bob.connection.id,
    project.id,
    crypto.randomUUID(),
  );
  expect((await bob.store.listProjects()).map((p) => p.id)).toEqual([
    project.id,
  ]);
}, 30000);
it("keeps a stopped viewer copy editable locally without uploading its edits when resumed", async () => {
  const { alice, bob, project, page } = await fixture();
  await bob.manager.subscribe(bob.connection.id, project.id);
  await bob.manager.stop();
  await alice.manager.manage(alice.connection.id, project.id, "member", {
    userId: bob.connection.user.id,
    role: "viewer",
  });
  await bob.manager.run(project.id);
  await expect(bob.manager.assertEditable(project.id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await bob.manager.setEnabled(project.id, false);
  await bob.manager.assertEditable(project.id);
  const current = await bob.store.readPage(project.id, page.document.id);
  await bob.store.updatePageMetadata(
    project.id,
    page.document.id,
    { title: "Private local edit" },
    current.hash,
    current.revision,
  );
  await bob.manager.setEnabled(project.id, true);
  expect(
    (await alice.store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Original");
  expect(
    (await bob.store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Private local edit");
  const state = (await bob.manager.status()).projects[0];
  expect(state.status, JSON.stringify(state)).toBe("revoked");
}, 30000);
it("retries the same cloud project creation without creating a second local or remote project", async () => {
  const { alice } = await fixture();
  const { createWorkbench } = await import("../workbench/actions");
  const { AgentService } = await import("../agent/service");
  const { syncManager } = await import("./manager");
  const service = new AgentService({ root: alice.home });
  cleanup.push(() => syncManager(alice.home).stop());
  const unsupported = async () => {
    throw new Error("Native dialogs are not used by project management");
  };
  const invoke = createWorkbench(alice.store, service, {
    info: () => ({ home: alice.home, mode: "browser" }) as never,
    openDialog: unsupported,
    saveDialog: unsupported,
    invoke: unsupported,
  });
  const id = crypto.randomUUID();
  await invoke("sync:createProject", {
    id,
    connectionId: alice.connection.id,
    name: "Retry-safe project",
  });
  await invoke("sync:createProject", {
    id,
    connectionId: alice.connection.id,
    name: "Retry-safe project",
  });
  expect(
    (await alice.store.listProjects()).filter((item) => item.id === id),
  ).toHaveLength(1);
  expect(
    (await alice.manager.remoteProjects(alice.connection.id)).filter(
      (item) => item.id === id,
    ),
  ).toHaveLength(1);
}, 30000);
it("stops an in-flight merge before applying remote files or publishing unsent changes", async () => {
  const f = await fixture(true),
    { alice, bob, project, page } = f;
  cleanup.push(async () => f.release());
  f.release();
  await bob.manager.subscribe(bob.connection.id, project.id);
  await bob.manager.stop();
  const local = await bob.store.readPage(project.id, page.document.id);
  await bob.store.updatePageMetadata(
    project.id,
    page.document.id,
    { title: "Keep this unsent" },
    local.hash,
    local.revision,
  );
  await alice.store.createPage(project.id, { title: "New remote content" });
  await alice.manager.run(project.id);
  const waiting = f.holdObjects();
  const run = bob.manager.run(project.id);
  await Promise.race([
    waiting,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("No remote object transfer")), 8000),
    ),
  ]);
  const otherInstance = new SyncManager(bob.home, { events: false });
  cleanup.push(() => otherInstance.stop());
  let stopped = false;
  const stopping = otherInstance.setEnabled(project.id, false).then(() => {
    stopped = true;
  });
  for (let i = 0; !(await bob.manager.status()).projects[0].paused; i++) {
    if (i > 600) throw new Error("Stop state was not persisted");
    await new Promise((done) => setTimeout(done, 5));
  }
  expect(stopped).toBe(false);
  f.release();
  await stopping;
  await run;
  expect(
    (await alice.store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Original");
  expect(
    (await bob.store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Keep this unsent");
  expect(
    (await bob.store.listPages(project.id)).map((item) => item.title),
  ).not.toContain("New remote content");
  await bob.manager.setEnabled(project.id, true);
  expect(
    (await bob.store.listPages(project.id)).map((item) => item.title),
  ).toContain("New remote content");
}, 30000);
