import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  lstat,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { request as httpRequest } from "node:http";
import { startSyncServer, SQLiteMetadata } from "./node";
import { planServerCleanup } from "./cleanup-plan";
import { ServerMaintenance } from "./maintenance";
import { DiskObjects } from "./node-storage";
import {
  exportServerBackup,
  verifyServerBackup,
  restoreServerBackup,
  operationsRequest,
} from "./backup";
import { SyncManager } from "../sync/manager";
import { GitLibrary } from "../core/git-library";
import { FileStore } from "../core/store";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0).reverse()) await done();
});
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
test("bundling the operations library does not start a server or create data", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-backup-import-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const entry = join(root, "operations.mjs"),
    unintended = join(root, "unintended-server");
  await build({
    stdin: {
      contents:
        'import {operationsRequest} from "./src/server/backup";console.log(typeof operationsRequest);',
      resolveDir: process.cwd(),
    },
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      SHOWAI_SERVER_HOME: unintended,
      SHOWAI_SERVER_PORT: "0",
    },
  });
  let output = "";
  child.stdout.on("data", (bytes) => (output += bytes));
  child.stderr.on("data", (bytes) => (output += bytes));
  const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
  const code = await new Promise<number | null>((done) =>
    child.once("exit", done),
  );
  clearTimeout(timer);
  expect(code).toBe(0);
  expect(output.trim()).toBe("function");
  expect(
    await lstat(unintended).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }),
  ).toBeUndefined();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-backup-contract-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const credential = process.env.SHOWAI_SYNC_OPERATIONS_KEY ?? "a".repeat(64);
  const remote = process.env.SHOWAI_SYNC_TEST_URL;
  const original = remote
    ? undefined
    : await startSyncServer({
        home: join(root, "original"),
        port: 0,
        operationsKey: credential,
        registrationKey: "backup-test-key",
      });
  if (original) cleanup.push(() => original.close());
  const url = remote ?? original!.url;
  if (remote)
    cleanup.push(async () => {
      // The replacement is closed by the later cleanup action before reopening
      // the reusable isolated source for another contract. No dual writable replicas.
      const state = await (
        await operationsRequest(url, credential, "/api/ops/state")
      ).json();
      if (state.state === "frozen")
        await operationsRequest(
          url,
          credential,
          `/api/ops/resume?epoch=${state.epoch}`,
          "POST",
        );
    });
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    token?: string,
  ) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(data === undefined ? {} : { "content-type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, value: await response.json() };
  };
  const clients = [];
  for (const kind of ["owner", "editor", "viewer"]) {
    const home = join(root, kind),
      library = new GitLibrary(home);
    await library.initialize();
    const store = new FileStore(home),
      manager = new SyncManager(home);
    cleanup.push(() => manager.stop());
    const connection = await manager.connect({
      url,
      register: true,
      account: `backup-${kind}-${crypto.randomUUID()}`,
      password: "backup-password-2026",
      registrationKey: process.env.SHOWAI_SYNC_TEST_KEY ?? "backup-test-key",
    });
    await manager.stop();
    clients.push({ home, library, store, manager, connection });
  }
  return { root, url, credential, clients, request, original };
}

test.skipIf(!!process.env.SHOWAI_SYNC_TEST_URL)(
  "exclusive maintenance rejects public metadata writes and concurrent exports",
  async () => {
    const {
      root,
      url,
      credential,
      clients: [alice],
      request,
    } = await fixture();
    const owner = (await alice.manager.configuration()).connections[0];
    const frozen = await (
      await operationsRequest(url, credential, "/api/ops/freeze", "POST")
    ).json();
    const db = new SQLiteMetadata(join(root, "original", "metadata.sqlite"));
    const maintenance = new ServerMaintenance(
      db,
      new DiskObjects(join(root, "original", "objects")),
      credential,
    );
    let release!: () => void, entered!: () => void;
    const admitted = new Promise<void>((done) => (entered = done)),
      hold = new Promise<void>((done) => (release = done));
    const work = maintenance.exclusive(frozen.epoch, async () => {
      entered();
      await hold;
      return { done: true };
    });
    try {
      await admitted;
      expect(
        (
          await request(
            "/api/projects",
            "POST",
            { id: crypto.randomUUID(), name: "Must not enter maintenance" },
            owner.token,
          )
        ).status,
      ).toBe(503);
      const state = await (
        await operationsRequest(url, credential, "/api/ops/state")
      ).json();
      expect(state.maintenance_owner).toBeTruthy();
      expect(state.activeWrites).toBe(0);
      expect(
        (
          await request(
            `/api/ops/export/metadata?table=users&epoch=${state.epoch}`,
            "GET",
            undefined,
            credential,
          )
        ).value.error.code,
      ).toBe("MAINTENANCE_BUSY");
      expect(
        (
          await request(
            `/api/ops/resume?epoch=${state.epoch}`,
            "POST",
            undefined,
            credential,
          )
        ).status,
      ).toBe(409);
    } finally {
      release();
      await work;
      db.close();
    }
  },
);

test.skipIf(!!process.env.SHOWAI_SYNC_TEST_URL)(
  "cleanup dry-run preserves old reachable history and active parts and only reports old orphans",
  async () => {
    const {
      root,
      url,
      credential,
      clients: [alice],
      request,
    } = await fixture();
    const project = await alice.store.createProject({
      name: "Reachability retention",
    });
    await alice.store.createPage(project.id, { title: "Retained old history" });
    await alice.manager.attach(alice.connection.id, project.id);
    await alice.manager.stop();
    const owner = (await alice.manager.configuration()).connections[0];
    const old = Buffer.from("old unreferenced immutable data"),
      fresh = Buffer.from("recent unreferenced immutable data");
    for (const bytes of [old, fresh]) {
      const response = await fetch(
        url + `/api/projects/${project.id}/objects/${digest(bytes)}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${owner.token}` },
          body: bytes,
        },
      );
      expect(response.status).toBe(200);
      await response.body?.cancel();
    }
    const head = (
      await request(
        `/api/projects/${project.id}`,
        "GET",
        undefined,
        owner.token,
      )
    ).value.head;
    const snapshot = (
      await request(
        `/api/projects/${project.id}/revisions/${head}`,
        "GET",
        undefined,
        owner.token,
      )
    ).value.snapshot;
    const historical = snapshot.files[`projects/${project.id}/project.json`];
    const earlier = new Date(Date.now() - 40 * 86400_000);
    for (const name of [digest(old), historical])
      await utimes(
        join(
          root,
          "original",
          "objects",
          `projects/${project.id}/objects/${name}`,
        ),
        earlier,
        earlier,
      );
    const bytes = Buffer.alloc(6 * 1024 * 1024, 60);
    const task = (
      await request(
        `/api/projects/${project.id}/objects/uploads`,
        "POST",
        { digest: digest(bytes), bytes: bytes.length },
        owner.token,
      )
    ).value;
    const part = bytes.subarray(0, task.partBytes),
      partName = digest(part);
    const response = await fetch(
      url +
        `/api/projects/${project.id}/objects/uploads/${task.id}/parts/0?digest=${partName}`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${owner.token}` },
        body: part,
      },
    );
    expect(response.status).toBe(200);
    await response.body?.cancel();
    await utimes(
      join(
        root,
        "original",
        "objects",
        `projects/${project.id}/uploads/${task.id}/parts/${partName}`,
      ),
      earlier,
      earlier,
    );
    const backup = join(root, "retention-backup");
    await exportServerBackup({ url, credential, destination: backup });
    const report = join(root, "cleanup.ndjson"),
      plan = await planServerCleanup({ backup, destination: report });
    expect(plan.candidates).toBe(1);
    expect(plan.deleted).toBe(0);
    expect(plan.candidateBytes).toBe(old.length);
    const lines = (await readFile(report, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[1].candidate).toBe(
      `projects/${project.id}/objects/${digest(old)}`,
    );
    expect(
      (
        await fetch(
          url + `/api/projects/${project.id}/objects/${digest(old)}`,
          { headers: { authorization: `Bearer ${owner.token}` } },
        )
      ).status,
    ).toBe(200);
    await expect(
      planServerCleanup({
        backup,
        destination: join(root, "too-short.ndjson"),
        retentionDays: 1,
      }),
    ).rejects.toThrow("Retention");
    const inventory = (await readFile(join(backup, "inventory.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const selected = [digest(old), historical, digest(fresh)].map((name) =>
      inventory.find(
        (item) => item.key === `projects/${project.id}/objects/${name}`,
      ),
    );
    const epoch = lines[0].epoch;
    const dry = await (
      await operationsRequest(
        url,
        credential,
        `/api/ops/cleanup?epoch=${epoch}`,
        "POST",
        { candidates: selected, retentionDays: 30 },
      )
    ).json();
    expect(dry.deleted).toBe(0);
    expect(dry.decisions[0].action).toBe("candidate");
    const applied = await (
      await operationsRequest(
        url,
        credential,
        `/api/ops/cleanup?epoch=${epoch}`,
        "POST",
        { candidates: selected, retentionDays: 30, apply: true },
      )
    ).json();
    expect(applied.result.deleted).toBe(1);
    expect(applied.result.headsChanged).toBe(0);
    expect(applied.result.decisions[1].reason).toBe("historical-file");
    expect(applied.result.decisions[2].reason).toBe("changed-or-recent");
    const removed = await fetch(
      url + `/api/projects/${project.id}/objects/${digest(old)}`,
      { headers: { authorization: `Bearer ${owner.token}` } },
    );
    expect(removed.status).toBe(404);
    await removed.body?.cancel();
    const retained = await fetch(
      url + `/api/projects/${project.id}/objects/${historical}`,
      { headers: { authorization: `Bearer ${owner.token}` } },
    );
    expect(retained.status).toBe(200);
    await retained.body?.cancel();
    const stale = await request(
      `/api/ops/cleanup?epoch=${epoch}`,
      "POST",
      { candidates: selected, apply: true },
      credential,
    );
    expect(stale.status).toBe(409);
  },
  60_000,
);

test("consistent backup restores full identity sessions permissions history and retained parts, then continues sync", async () => {
  const {
    root,
    url,
    credential,
    clients: [alice, bob, viewer],
    request,
  } = await fixture();
  const project = await alice.store.createProject({
    name: "Migration history",
  });
  const page = await alice.store.createPage(project.id, {
    title: "Original history",
  });
  await alice.manager.attach(alice.connection.id, project.id);
  await alice.manager.stop();
  for (const [client, role] of [
    [bob, "editor"],
    [viewer, "viewer"],
  ] as const) {
    const invitation = (await alice.manager.manage(
      alice.connection.id,
      project.id,
      "invite",
      { role },
    )) as { url: string };
    await client.manager.join(client.connection.id, invitation.url);
    await client.manager.stop();
  }
  for (const title of [
    "Second historical version",
    "Latest before migration",
  ]) {
    const record = await alice.store.readPage(project.id, page.document.id);
    await alice.store.savePage(
      project.id,
      page.document.id,
      { ...record.document, title },
      record.hash,
      record.revision,
    );
    await alice.manager.run();
  }
  const owner = (await alice.manager.configuration()).connections[0];
  const editor = (await bob.manager.configuration()).connections[0];
  const readOnly = (await viewer.manager.configuration()).connections[0];
  if (process.env.SHOWAI_BACKUP_CLIENT_RECEIPT)
    await writeFile(
      process.env.SHOWAI_BACKUP_CLIENT_RECEIPT,
      JSON.stringify({
        url,
        serverId: owner.serverId,
        projectId: project.id,
        pageId: page.document.id,
        owner,
        editor,
        viewer: readOnly,
      }),
      { mode: 0o600 },
    );
  const revoked = await request("/api/auth/login", "POST", {
    name: owner.user.name,
    password: "backup-password-2026",
    device: "Revoked migration device",
  });
  const sessions = await request(
    "/api/sessions",
    "GET",
    undefined,
    revoked.value.token,
  );
  const current = sessions.value.find(
    (item: { current: number }) => item.current,
  );
  expect(
    (
      await request(
        "/api/sessions/revoke",
        "POST",
        { digest: current.digest },
        owner.token,
      )
    ).status,
  ).toBe(200);
  const bytes = Buffer.alloc(6 * 1024 * 1024, 71),
    name = digest(bytes);
  const task = await request(
    `/api/projects/${project.id}/objects/uploads`,
    "POST",
    { digest: name, bytes: bytes.length },
    owner.token,
  );
  expect(task.status).toBe(200);
  const first = bytes.subarray(0, task.value.partBytes);
  const firstPut = await fetch(
    url +
      `/api/projects/${project.id}/objects/uploads/${task.value.id}/parts/0?digest=${digest(first)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${owner.token}` },
      body: first,
    },
  );
  expect(firstPut.status).toBe(200);
  await firstPut.body?.cancel();
  const before = await request(
    `/api/projects/${project.id}/revisions?summary=1`,
    "GET",
    undefined,
    owner.token,
  );
  expect(
    (await request("/api/ops/state", "GET", undefined, owner.token)).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/api/ops/export/metadata?table=users",
        "GET",
        undefined,
        credential,
      )
    ).status,
  ).toBe(409);
  const backup = join(root, "backup");
  const verified = await exportServerBackup({
    url,
    credential,
    destination: backup,
  });
  expect(verified.projects).toBeGreaterThanOrEqual(1);
  expect(verified.sessions).toBeGreaterThanOrEqual(4);
  expect(verified.revisions).toBeGreaterThanOrEqual(3);
  expect(
    (
      await request(
        `/api/projects/${project.id}`,
        "PATCH",
        { name: "Forbidden during backup" },
        owner.token,
      )
    ).status,
  ).toBe(503);
  const resumed = await exportServerBackup({
    url,
    credential,
    destination: backup,
    resume: true,
  });
  expect(resumed).toEqual(verified);
  const restored = await restoreServerBackup({
    backup,
    home: join(root, "restored"),
  });
  const replacement = await startSyncServer({
    home: restored.home,
    port: 0,
    operationsKey: credential,
    registrationKey: "backup-test-key",
  });
  cleanup.push(() => replacement.close());
  const restoredRequest = async (
    path: string,
    method = "GET",
    data?: unknown,
    token = owner.token,
  ) => {
    const response = await fetch(replacement.url + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(data === undefined ? {} : { "content-type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, value: await response.json() };
  };
  for (const account of [owner, editor, readOnly]) {
    const me = await restoredRequest(
      "/api/me",
      "GET",
      undefined,
      account.token,
    );
    expect(me.status).toBe(200);
    expect(me.value.user).toEqual(account.user);
    expect(me.value.serverId).toBe(verified.serverId);
  }
  expect(
    (await restoredRequest("/api/me", "GET", undefined, revoked.value.token))
      .status,
  ).toBe(401);
  expect(
    (
      await restoredRequest(
        `/api/projects/${project.id}`,
        "GET",
        undefined,
        editor.token,
      )
    ).value.role,
  ).toBe("editor");
  expect(
    (
      await restoredRequest(
        `/api/projects/${project.id}`,
        "GET",
        undefined,
        readOnly.token,
      )
    ).value.role,
  ).toBe("viewer");
  expect(
    (await restoredRequest(`/api/projects/${project.id}/revisions?summary=1`))
      .value,
  ).toEqual(before.value);
  expect(
    (
      await restoredRequest(`/api/projects/${project.id}`, "PATCH", {
        name: "Still frozen",
      })
    ).status,
  ).toBe(503);
  await operationsRequest(
    replacement.url,
    credential,
    `/api/ops/resume?epoch=${restored.epoch}`,
    "POST",
  );
  expect(
    (
      await restoredRequest(
        `/api/projects/${project.id}`,
        "PATCH",
        { name: "Viewer cannot write" },
        readOnly.token,
      )
    ).status,
  ).toBe(403);
  const retained = await restoredRequest(
    `/api/projects/${project.id}/objects/uploads/${task.value.id}`,
  );
  expect(retained.value.parts).toHaveLength(1);
  const remainder = bytes.subarray(first.length);
  const put = await fetch(
    replacement.url +
      `/api/projects/${project.id}/objects/uploads/${task.value.id}/parts/1?digest=${digest(remainder)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${owner.token}` },
      body: remainder,
    },
  );
  expect(put.status).toBe(200);
  await put.body?.cancel();
  expect(
    (
      await restoredRequest(
        `/api/projects/${project.id}/objects/uploads/${task.value.id}/complete`,
        "POST",
      )
    ).status,
  ).toBe(200);
  const finished = await fetch(
    replacement.url + `/api/projects/${project.id}/objects/${name}`,
    { headers: { authorization: `Bearer ${owner.token}` } },
  );
  expect(digest(new Uint8Array(await finished.arrayBuffer()))).toBe(name);
  await alice.manager.connect({ url: replacement.url, token: owner.token });
  await alice.manager.stop();
  await bob.manager.connect({ url: replacement.url, token: editor.token });
  await bob.manager.stop();
  expect((await alice.manager.configuration()).connections[0].id).toBe(
    owner.id,
  );
  const local = await alice.store.readPage(project.id, page.document.id);
  await alice.store.savePage(
    project.id,
    page.document.id,
    { ...local.document, title: "Continued after migration" },
    local.hash,
    local.revision,
  );
  await alice.manager.run();
  await bob.manager.run();
  expect(
    (await bob.store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Continued after migration");
  expect(
    (await operationsRequest(url, credential, "/api/ops/state")).status,
  ).toBe(200);
  const source = await (
    await operationsRequest(url, credential, "/api/ops/state")
  ).json();
  expect(source.state).toBe("frozen");
  await expect(
    restoreServerBackup({ backup, home: restored.home }),
  ).rejects.toThrow("new destination");
  const inventory = (await readFile(join(backup, "inventory.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const object = join(backup, "objects", inventory[0].key),
    original = await readFile(object);
  await writeFile(object, "corrupted");
  await expect(verifyServerBackup(backup)).rejects.toThrow("digest mismatch");
  await writeFile(object, original);
  if (process.env.SHOWAI_BACKUP_RECEIPT)
    await writeFile(
      process.env.SHOWAI_BACKUP_RECEIPT,
      JSON.stringify(
        {
          backend: process.env.SHOWAI_SYNC_TEST_URL
            ? "wrangler-d1-r2-to-node"
            : "sqlite-disk-to-node",
          ...verified,
          preservedSessions: true,
          preservedPermissions: true,
          retainedUploadCompleted: true,
          continuedSynchronization: true,
          sourceStillFrozen: true,
          corruptionRejected: true,
        },
        null,
        2,
      ),
    );
}, 180_000);

test("freeze drains a real in-flight upload and database triggers stop direct writes", async () => {
  const {
    url,
    credential,
    clients: [alice],
    request,
    original,
    root,
  } = await fixture();
  const project = await request(
    "/api/projects",
    "POST",
    { id: crypto.randomUUID(), name: "In-flight freeze" },
    (await alice.manager.configuration()).connections[0].token,
  );
  const owner = (await alice.manager.configuration()).connections[0];
  const bytes = Buffer.alloc(128, 42);
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      value.enqueue(bytes.subarray(0, 64));
    },
  });
  const inflight = fetch(
    url + `/api/projects/${project.value.id}/objects/${digest(bytes)}`,
    {
      method: "PUT",
      body,
      duplex: "half",
      headers: {
        authorization: `Bearer ${owner.token}`,
        "content-length": String(bytes.length),
      },
    } as RequestInit,
  );
  const deadline = Date.now() + 10_000;
  while (
    (await (await operationsRequest(url, credential, "/api/ops/state")).json())
      .activeWrites !== 1
  ) {
    if (Date.now() > deadline) throw new Error("Upload was not admitted.");
    await new Promise((done) => setTimeout(done, 25));
  }
  const frozen = await (
    await operationsRequest(url, credential, "/api/ops/freeze", "POST")
  ).json();
  expect(frozen.activeWrites).toBe(1);
  expect(
    (
      await request(
        `/api/ops/export/metadata?table=users&epoch=${frozen.epoch}`,
        "GET",
        undefined,
        credential,
      )
    ).value.error.code,
  ).toBe("WRITES_DRAINING");
  controller!.enqueue(bytes.subarray(64));
  controller!.close();
  const upload = await inflight;
  expect(upload.status).toBe(503);
  await upload.body?.cancel();
  expect(
    (await (await operationsRequest(url, credential, "/api/ops/state")).json())
      .activeWrites,
  ).toBe(0);
  if (original) {
    const db = new SQLiteMetadata(join(root, "original", "metadata.sqlite"));
    try {
      await expect(
        db.run("UPDATE projects SET name='direct bypass' WHERE id=?", [
          project.value.id,
        ]),
      ).rejects.toThrow("SHOWAI_READ_ONLY");
    } finally {
      db.close();
    }
  }
  const pending = (
    await request(
      `/api/ops/export/metadata?table=storage_reservations&epoch=${frozen.epoch}`,
      "GET",
      undefined,
      credential,
    )
  ).value.rows.find(
    (row: { project_id: string }) => row.project_id === project.value.id,
  );
  expect(pending).toBeDefined();
  const planned = await operationsRequest(
    url,
    credential,
    `/api/ops/reconcile?epoch=${frozen.epoch}`,
    "POST",
    { ids: [pending.id] },
  );
  expect((await planned.json()).decisions[0].action).toBe("finalize-object");
  const applied = await (
    await operationsRequest(
      url,
      credential,
      `/api/ops/reconcile?epoch=${frozen.epoch}`,
      "POST",
      { ids: [pending.id], apply: true },
    )
  ).json();
  expect(applied.result.headsChanged).toBe(0);
  expect(applied.result.decisions[0].action).toBe("finalize-object");
  expect(
    (
      await request(
        `/api/ops/resume?epoch=${frozen.epoch}`,
        "POST",
        undefined,
        credential,
      )
    ).status,
  ).toBe(409);
  const recovered = await fetch(
    url + `/api/projects/${project.value.id}/objects/${digest(bytes)}`,
    { headers: { authorization: `Bearer ${owner.token}` } },
  );
  expect(recovered.status).toBe(200);
  expect(digest(new Uint8Array(await recovered.arrayBuffer()))).toBe(
    digest(bytes),
  );
  expect(
    (
      await request(
        `/api/projects/${project.value.id}`,
        "GET",
        undefined,
        owner.token,
      )
    ).value.head,
  ).toBeNull();
  await operationsRequest(
    url,
    credential,
    `/api/ops/resume?epoch=${applied.epoch}`,
    "POST",
  );
}, 30_000);

test("an actual disconnected upload releases its durable admission record", async () => {
  const {
    url,
    credential,
    clients: [alice],
    request,
  } = await fixture();
  const owner = (await alice.manager.configuration()).connections[0];
  const project = (
    await request(
      "/api/projects",
      "POST",
      { id: crypto.randomUUID(), name: "Disconnected upload" },
      owner.token,
    )
  ).value;
  const bytes = Buffer.alloc(128, 73);
  const incoming = httpRequest(
    url + `/api/projects/${project.id}/objects/${digest(bytes)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${owner.token}`,
        "content-length": String(bytes.length),
      },
    },
  );
  incoming.on("error", () => {});
  incoming.write(bytes.subarray(0, 64));
  const deadline = Date.now() + 5000;
  while (
    (await (await operationsRequest(url, credential, "/api/ops/state")).json())
      .activeWrites !== 1
  ) {
    if (Date.now() > deadline)
      throw new Error("Disconnected upload was not admitted.");
    await new Promise((done) => setTimeout(done, 25));
  }
  incoming.destroy();
  while (
    (await (await operationsRequest(url, credential, "/api/ops/state")).json())
      .activeWrites !== 0
  ) {
    if (Date.now() > deadline)
      throw new Error("Disconnected upload retained its admission record.");
    await new Promise((done) => setTimeout(done, 25));
  }
  const object = await fetch(
    url + `/api/projects/${project.id}/objects/${digest(bytes)}`,
    { headers: { authorization: `Bearer ${owner.token}` } },
  );
  expect(object.status).toBe(404);
  await object.body?.cancel();
}, 10_000);
