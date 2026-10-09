import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncManager } from "./manager";
import { GitLibrary } from "../core/git-library";
import { FileStore } from "../core/store";
import { startSyncServer } from "../server/node";
import { hash } from "./protocol";
import { eventProtocol, eventCapability } from "./events";
import { reconcileResource } from "../surface/containers.mjs";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0).reverse()) await done();
});
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => Promise<boolean>, maximum = 15_000) {
  const end = Date.now() + maximum;
  while (!(await check())) {
    if (Date.now() > end)
      throw new Error("Real pushed synchronization did not converge.");
    await sleep(20);
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-realtime-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const external = process.env.SHOWAI_SYNC_TEST_URL;
  const server = external
    ? undefined
    : await startSyncServer({
        home: join(root, "server"),
        port: 0,
        registrationMode: "open",
      });
  if (server) cleanup.push(() => server.close());
  const url = external ?? server!.url;
  const clients: {
    home: string;
    store: FileStore;
    manager: SyncManager;
    connection: Awaited<ReturnType<SyncManager["connect"]>>;
  }[] = [];
  for (const name of ["owner", "editor", "viewer"]) {
    const home = join(root, name);
    await new GitLibrary(home).initialize();
    const store = new FileStore(home),
      manager = new SyncManager(home);
    cleanup.push(() => manager.stop());
    const connection = await manager.connect({
      url,
      account: `qa-realtime-${name}-${crypto.randomUUID()}`,
      password: "realtime-test-password",
      register: true,
      registrationKey: process.env.SHOWAI_SYNC_TEST_KEY,
    });
    await manager.stop();
    clients.push({ home, store, manager, connection });
  }
  const [owner, editor, viewer] = clients;
  const project = await owner.store.createProject({
    name: "Real-time synchronization acceptance",
  });
  const initial = await owner.store.createPage(project.id, {
    title: "Initial",
  });
  const pageId = initial.document.id;
  const loaded = await owner.store.readPage(project.id, pageId);
  await owner.store.savePage(
    project.id,
    pageId,
    reconcileResource({
      ...loaded.document,
      content: {
        ...loaded.document.content,
        content: [
          {
            type: "paragraph",
            attrs: { id: "left" },
            content: [{ type: "text", text: "Left original" }],
          },
          {
            type: "paragraph",
            attrs: { id: "right" },
            content: [{ type: "text", text: "Right original" }],
          },
        ],
      },
    }),
    loaded.hash,
    loaded.revision,
  );
  await owner.manager.attach(owner.connection.id, project.id);
  await owner.manager.stop();
  for (const [client, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const) {
    const invitation = (await owner.manager.manage(
      owner.connection.id,
      project.id,
      "invite",
      { role },
    )) as { url: string };
    await client.manager.join(client.connection.id, invitation.url);
    await client.manager.stop();
  }
  for (const client of clients) client.manager.start();
  await until(async () =>
    (await Promise.all(clients.map((client) => client.manager.status()))).every(
      (status) => status.scheduler.pushReady === 1,
    ),
  );
  return { root, url, clients, owner, editor, viewer, project, pageId };
}

test("existing saved connections negotiate the new push capability on startup", async () => {
  const { editor } = await fixture();
  await editor.manager.stop();
  const configuration = await editor.manager.configuration();
  configuration.connections[0].capabilities = configuration.connections[0].capabilities?.filter((value) => value !== eventCapability);
  await writeFile(join(editor.home, "local/sync/config.json"), JSON.stringify(configuration));
  editor.manager.start();
  await until(async () => (await editor.manager.status()).scheduler.pushReady === 1);
  expect((await editor.manager.configuration()).connections[0].capabilities).toContain(eventCapability);
}, 180_000);

test("published edits reach complete independent libraries over the actual push channel", async () => {
  const { owner, editor, viewer, project, pageId } = await fixture();
  const timings: number[] = [];
  for (let index = 0; index < 20; index++) {
    const record = await owner.store.readPage(project.id, pageId),
      title = `Pushed ${index}`;
    const begun = Date.now();
    await owner.store.savePage(
      project.id,
      pageId,
      { ...record.document, title },
      record.hash,
      record.revision,
    );
    owner.manager.wake([project.id]);
    await until(
      async () =>
        (await editor.store.readPage(project.id, pageId)).document.title ===
          title &&
        (await viewer.store.readPage(project.id, pageId)).document.title ===
          title,
    );
    timings.push(Date.now() - begun);
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const receipt = {
    backend:
      process.env.SHOWAI_SYNC_TEST_URL ?? "linux-compatible-node-sqlite-disk",
    model:
      "three independent real SDK libraries; signed owner/editor/viewer; complete saved page arrival",
    samples: timings.length,
    p50Ms: sorted[9],
    p95Ms: sorted[18],
    timings,
  };
  console.log("Real pushed document latency", JSON.stringify(receipt));
  if (process.env.SHOWAI_REALTIME_RECEIPT) {
    await mkdir(join(process.env.SHOWAI_REALTIME_RECEIPT, ".."), {
      recursive: true,
    });
    await writeFile(
      process.env.SHOWAI_REALTIME_RECEIPT,
      JSON.stringify(receipt, null, 2),
    );
  }
  expect(receipt.p95Ms).toBeLessThanOrEqual(
    Number(process.env.SHOWAI_REALTIME_MAX_MS ?? 1500),
  );
}, 180_000);

test("continuous edits arrive before editing stops and a disconnected client retains both authors' changes", async () => {
  const { owner, editor, project, pageId } = await fixture();
  const observed = new Set<string>();
  let editing = true;
  const watching = (async () => {
    while (editing) {
      observed.add(
        (await editor.store.readPage(project.id, pageId)).document.title,
      );
      await sleep(25);
    }
  })();
  try {
    for (let index = 0; index < 20; index++) {
      const page = await owner.store.readPage(project.id, pageId);
      await owner.store.savePage(
        project.id,
        pageId,
        { ...page.document, title: `Continuous ${index}` },
        page.hash,
        page.revision,
      );
      owner.manager.wake([project.id]);
      await sleep(100);
    }
  } finally {
    editing = false;
    await watching;
  }
  expect(
    [...observed].filter((title) => title.startsWith("Continuous")).length,
  ).toBeGreaterThanOrEqual(3);
  await until(
    async () =>
      (await editor.store.readPage(project.id, pageId)).document.title ===
      "Continuous 19",
  );
  await owner.manager.stop();
  const offline = await owner.store.readPage(project.id, pageId);
  const left = structuredClone(offline.document);
  left.content.content![0].content = [
    { type: "text", text: "Owner kept offline" },
  ];
  const offlineSaved = await owner.store.savePage(
    project.id,
    pageId,
    left,
    offline.hash,
    offline.revision,
  );
  const online = await editor.store.readPage(project.id, pageId);
  const right = structuredClone(online.document);
  right.content.content![1].content = [
    { type: "text", text: "Editor kept online" },
  ];
  await editor.store.savePage(
    project.id,
    pageId,
    right,
    online.hash,
    online.revision,
  );
  editor.manager.wake([project.id]);
  await until(
    async () =>
      (await editor.manager.status()).projects[0].status === "synced" &&
      !(await editor.manager.status()).running,
  );
  owner.manager.start();
  owner.manager.wake([project.id]);
  await until(async () => {
    const page = (await owner.store.readPage(project.id, pageId)).document;
    return (
      JSON.stringify(page.content).includes("Owner kept offline") &&
      JSON.stringify(page.content).includes("Editor kept online")
    );
  });
  await until(async () =>
    JSON.stringify(
      (await editor.store.readPage(project.id, pageId)).document.content,
    ).includes("Owner kept offline"),
  );
  await until(async () =>
    (
      await new GitLibrary(editor.home).history({
        projectId: project.id,
        limit: 100,
      })
    ).some(
      (entry) => entry.syncOrigin?.sourceRevision === offlineSaved.revision,
    ),
  );
}, 180_000);

test("open sockets hide private projects and revoke project access and device sessions", async () => {
  const { url, owner, editor, viewer, project, pageId } = await fixture();
  const privateProject = await owner.store.createProject({
    name: "Private project",
  });
  await owner.manager.attach(owner.connection.id, privateProject.id);
  const viewerConfig = (await viewer.manager.configuration()).connections[0];
  const endpoint = new URL(url + "/api/events");
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(endpoint, [
    eventProtocol,
    `token-${viewerConfig.token}`,
  ]);
  cleanup.push(async () => socket.close());
  const messages: {
    type: string;
    projects?: { id: string }[];
    project?: { id: string };
  }[] = [];
  socket.addEventListener("message", (event) =>
    messages.push(JSON.parse(String(event.data))),
  );
  await new Promise<void>((done, reject) => {
    socket.addEventListener("open", () => done(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Real event handshake failed.")),
      { once: true },
    );
  });
  socket.send(
    JSON.stringify({ type: "subscribe", ids: [privateProject.id, project.id] }),
  );
  await until(async () => messages.some((item) => item.type === "heads"));
  expect(
    messages
      .find((item) => item.type === "heads")!
      .projects!.map((item) => item.id),
  ).toEqual([project.id]);
  await owner.manager.manage(owner.connection.id, project.id, "member", {
    userId: editor.connection.user.id,
    role: null,
  });
  await until(
    async () =>
      (await editor.manager.status()).projects[0].status === "revoked",
  );
  const saved = await owner.store.readPage(project.id, pageId);
  await owner.store.savePage(
    project.id,
    pageId,
    { ...saved.document, title: "Only authorized peers" },
    saved.hash,
    saved.revision,
  );
  owner.manager.wake([project.id]);
  await until(
    async () =>
      (await viewer.store.readPage(project.id, pageId)).document.title ===
      "Only authorized peers",
  );
  expect(
    (await editor.store.readPage(project.id, pageId)).document.title,
  ).not.toBe("Only authorized peers");
  const restoredInvite = await owner.manager.manage(owner.connection.id, project.id, "invite", { role: "editor" }) as { url: string };
  await editor.manager.join(editor.connection.id, restoredInvite.url);
  await until(async () => (await editor.store.readPage(project.id, pageId)).document.title === "Only authorized peers");
  const closed = new Promise<number>((done) =>
    socket.addEventListener("close", (event) => done(event.code), {
      once: true,
    }),
  );
  const response = await fetch(url + "/api/sessions/revoke", {
    method: "POST",
    headers: {
      authorization: `Bearer ${viewerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ digest: await hash(viewerConfig.token) }),
  });
  expect(response.status).toBe(200);
  expect(await closed).toBe(4001);
  expect(messages.every((item) => item.project?.id !== privateProject.id)).toBe(
    true,
  );
}, 180_000);

test.runIf(process.env.SHOWAI_REALTIME_IDLE === "1")(
  "an idle receiver gets the first edit without waiting for its polling interval",
  async () => {
    const { owner, editor, project, pageId } = await fixture();
    await until(
      async () =>
        Date.now() > (await editor.manager.status()).scheduler.activeUntil,
      70_000,
    );
    const page = await owner.store.readPage(project.id, pageId),
      begun = Date.now();
    await owner.store.savePage(
      project.id,
      pageId,
      { ...page.document, title: "First edit after a minute idle" },
      page.hash,
      page.revision,
    );
    owner.manager.wake([project.id]);
    await until(
      async () =>
        (await editor.store.readPage(project.id, pageId)).document.title ===
        "First edit after a minute idle",
    );
    const elapsedMs = Date.now() - begun;
    console.log("Idle first-edit arrival", JSON.stringify({ elapsedMs }));
    if (process.env.SHOWAI_REALTIME_IDLE_RECEIPT)
      await writeFile(
        process.env.SHOWAI_REALTIME_IDLE_RECEIPT,
        JSON.stringify(
          {
            elapsedMs,
            backend: process.env.SHOWAI_SYNC_TEST_URL ?? "node",
            actualIdleMs: 60_000,
          },
          null,
          2,
        ),
      );
    expect(elapsedMs).toBeLessThanOrEqual(
      Number(process.env.SHOWAI_REALTIME_MAX_MS ?? 1500),
    );
  },
  180_000,
);
