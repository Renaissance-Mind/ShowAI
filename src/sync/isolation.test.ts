import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitLibrary } from "../core/git-library";
import { FileStore } from "../core/store";
import { LibraryOperations } from "../core/library-operations";
import {
  captureProject,
  decodeSnapshot,
  importProjectHistory,
  remapProjectFiles,
} from "./transfer";
import { hash, snapshotRevision, validateSnapshot } from "./protocol";
import { startSyncServer } from "../server/node";
import {
  importComponent,
  getComponentByRef,
  promotePackage,
} from "../core/catalog";
import { encodeFile } from "../core/history-codec";
import { legacySyncProtocol, type ProjectSnapshot } from "./protocol";
import type {
  ProjectConnection,
  ServerConnection,
  SnapshotRecord,
} from "./protocol";
import { SyncManager } from "./manager";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "showai-isolation-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const library = new GitLibrary(home);
  await library.initialize();
  const store = new FileStore(home);
  const one = await store.createProject({ name: "Untrusted shared project" });
  const two = await store.createProject({ name: "Private unrelated project" });
  const page = await store.createPage(two.id, { title: "Private content" });
  const [entry] = await library.history({ projectId: one.id, limit: 1 });
  const captured = await captureProject(home, one.id, entry, []);
  const files = await decodeSnapshot(
    captured,
    async (id) => captured.objects.get(id)!,
    one.id,
  );
  return { home, library, store, one, two, page, captured, files };
}

test("a late hostile import rejects the complete sequence before modifying history, other projects or credentials", async () => {
  const f = await fixture();
  await mkdir(join(f.home, "local", "sync"), { recursive: true });
  const credentials = join(f.home, "local", "sync", "config.json");
  await writeFile(credentials, '{"credential":"private-device-value"}');
  const head = await f.library.head();
  const privateFiles = await new LibraryOperations(
    f.home,
    f.two.id,
  ).projectFiles(f.two.id, head!);
  for (const hostile of [
    "packages/components/private/1.0.0/source.tsx",
    `projects/${f.two.id}/project.json`,
    `projects/${f.one.id}/.sync/versions/injected.json`,
    "local/sync/config.json",
  ]) {
    const polluted = new Map(f.files);
    polluted.set(hostile, Buffer.from("hostile overwrite"));
    await expect(
      importProjectHistory(
        f.home,
        f.one.id,
        "server-one",
        [
          { record: f.captured, files: f.files },
          { record: f.captured, files: polluted },
        ],
        f.files,
        head,
      ),
    ).rejects.toThrow();
    expect(await f.library.head()).toBe(head);
    expect(await readFile(credentials, "utf8")).toBe(
      '{"credential":"private-device-value"}',
    );
    expect(
      await new LibraryOperations(f.home, f.two.id).projectFiles(
        f.two.id,
        head!,
      ),
    ).toEqual(privateFiles);
    expect(
      (await readdir(join(f.home, "local", "sync"))).filter((name) =>
        name.startsWith("validated-import-"),
      ),
    ).toEqual([]);
  }
});

test("shared reader overwrite and unreferenced reader injection fail fingerprint and closure verification", async () => {
  const f = await fixture();
  const victim = await new LibraryOperations(f.home, f.two.id).projectFiles(
    f.two.id,
    (await f.library.head())!,
  );
  const viewer = [...victim.keys()].find((path) =>
    path.endsWith("/viewer.html"),
  )!;
  const bytes = Buffer.from("<script>hostile code</script>");
  const digest = await hash(bytes);
  const snapshot = {
    ...f.captured.snapshot,
    files: { ...f.captured.snapshot.files, [viewer]: digest },
  };
  const record = { snapshot, revision: await snapshotRevision(snapshot) };
  await expect(
    decodeSnapshot(
      record,
      async (id) => (id === digest ? bytes : f.captured.objects.get(id)!),
      f.one.id,
    ),
  ).rejects.toThrow("unreferenced");
  const owned = await f.store.createPage(f.one.id, { title: "Owned reader" });
  const [entry] = await f.library.history({ projectId: f.one.id, limit: 1 });
  const captured = await captureProject(f.home, f.one.id, entry, []);
  const ownViewer = Object.keys(captured.snapshot.files).find((path) =>
    path.endsWith("/viewer.html"),
  )!;
  const poisoned = {
    ...captured.snapshot,
    files: { ...captured.snapshot.files, [ownViewer]: digest },
  };
  await expect(
    decodeSnapshot(
      { snapshot: poisoned, revision: await snapshotRevision(poisoned) },
      async (id) => (id === digest ? bytes : captured.objects.get(id)!),
      f.one.id,
    ),
  ).rejects.toThrow("fingerprint");
  expect(
    (await f.store.readPage(f.one.id, owned.document.id)).document.title,
  ).toBe("Owned reader");
  await expect(
    decodeSnapshot(captured, async (id) => captured.objects.get(id)!, f.two.id),
  ).rejects.toThrow("snapshot");
});

test("new server publications cannot install global dependencies", async () => {
  const f = await fixture();
  const server = await startSyncServer({
    home: join(f.home, "server"),
    port: 0,
    registrationMode: "open",
  });
  cleanup.push(() => server.close());
  const account = await (
    await fetch(server.url + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "owner", password: "test-password" }),
    })
  ).json();
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${account.token}`,
  };
  await fetch(server.url + "/api/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ id: f.one.id, name: f.one.name }),
  });
  const snapshot = {
    ...f.captured.snapshot,
    files: {
      ...f.captured.snapshot.files,
      "packages/components/victim/1.0.0/source.tsx": "a".repeat(64),
    },
  };
  const response = await fetch(
    server.url + `/api/projects/${f.one.id}/revisions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ snapshot, expected: null }),
    },
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("INVALID_DEPENDENCY");
});

test("snapshot paths reject filesystem aliases and reserved targets", async () => {
  const f = await fixture();
  for (const path of [
    `projects/${f.one.id}/.GiT/refs/main`,
    `projects/${f.one.id}/pages/file.`,
    `projects/${f.one.id}/pages/NUL.json`,
  ])
    expect(() =>
      validateSnapshot(
        {
          ...f.captured.snapshot,
          files: { ...f.captured.snapshot.files, [path]: "a".repeat(64) },
        },
        f.one.id,
      ),
    ).toThrow();
  expect(() =>
    validateSnapshot(
      {
        ...f.captured.snapshot,
        files: {
          ...f.captured.snapshot.files,
          [`projects/${f.one.id}/pages/A.json`]: "a".repeat(64),
          [`projects/${f.one.id}/pages/a.json`]: "b".repeat(64),
        },
      },
      f.one.id,
    ),
  ).toThrow("collide");
});

test("a verified legacy global package imports into the owning project without rewriting the installed package", async () => {
  const f = await fixture();
  const component = await importComponent(
    f.home,
    join(import.meta.dirname, "../../resources/catalog/value-slider"),
    f.one.id,
  );
  await promotePackage(
    f.home,
    {
      kind: "component",
      id: component.id,
      version: component.version,
      integrity: component.integrity,
    },
    { projectId: f.one.id, target: "global" },
  );
  const root = `packages/components/${component.id}/${component.version}/`;
  const head = await f.library.head();
  const names = (await f.library.tree(head!))
    .map((entry) => entry.path)
    .filter((path) => path.startsWith(root));
  const globalFiles = await f.library.readFiles(names, head!);
  const logical = new Map([...f.files, ...globalFiles]);
  const objects = new Map<string, Buffer>(),
    files: Record<string, string> = {};
  for (const [path, bytes] of logical)
    for (const [name, content] of encodeFile(path, bytes)) {
      if (!content) continue;
      const id = await hash(content);
      objects.set(id, content);
      files[name] = id;
    }
  const snapshot: ProjectSnapshot = {
    ...f.captured.snapshot,
    format: legacySyncProtocol,
    files,
  };
  const record = { snapshot, revision: await snapshotRevision(snapshot) };
  const decoded = await decodeSnapshot(
    record,
    async (id) => objects.get(id)!,
    f.one.id,
  );
  expect([...decoded.keys()].some((path) => path.startsWith("packages/"))).toBe(
    false,
  );
  expect(
    decoded.has(
      `projects/${f.one.id}/packages/historical/components/${component.integrity}/compiled.json`,
    ),
  ).toBe(true);
  await importProjectHistory(
    f.home,
    f.one.id,
    "legacy-server",
    [{ record, files: decoded }],
    decoded,
    head,
  );
  expect(await f.library.readFiles(names)).toEqual(globalFiles);
  expect(
    (
      await getComponentByRef(
        f.home,
        {
          kind: "component",
          id: component.id,
          version: component.version,
          integrity: component.integrity,
        },
        f.one.id,
      )
    ).integrity,
  ).toBe(component.integrity);
});

test("a network snapshot cannot reuse another project's legacy private object cache", async () => {
  const f = await fixture();
  const server = await startSyncServer({
    home: join(f.home, "server"),
    port: 0,
    registrationMode: "open",
  });
  cleanup.push(() => server.close());
  const manager = new SyncManager(f.home);
  cleanup.push(() => manager.stop());
  const connected = await manager.connect({
    url: server.url,
    account: "cache-owner",
    password: "test-password",
    register: true,
  });
  await manager.stop();
  const connection = (await manager.configuration()).connections.find(
    (item) => item.id === connected.id,
  )!;
  const headers = { authorization: `Bearer ${connection.token}` };
  await fetch(server.url + "/api/projects", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ id: f.one.id, name: f.one.name }),
  });
  for (const [digest, bytes] of f.captured.objects)
    expect(
      (
        await fetch(
          server.url + `/api/projects/${f.one.id}/objects/${digest}`,
          { method: "PUT", headers, body: Uint8Array.from(bytes) },
        )
      ).ok,
    ).toBe(true);
  const privateBytes = Buffer.from("Another private project's cached content"),
    id = await hash(privateBytes);
  await mkdir(join(f.home, "local/sync/objects"), { recursive: true });
  await writeFile(join(f.home, "local/sync/objects", id), privateBytes);
  const snapshot = {
    ...f.captured.snapshot,
    files: {
      ...f.captured.snapshot.files,
      [`projects/${f.one.id}/stolen.txt`]: id,
    },
  };
  const record = { snapshot, revision: await snapshotRevision(snapshot) };
  const project: ProjectConnection = {
    projectId: f.one.id,
    remoteProjectId: f.one.id,
    connectionId: connection.id,
    role: "admin",
    remoteHead: null,
    localRevision: null,
    status: "pending",
  };
  const reader = manager as unknown as {
    files(
      connection: ServerConnection,
      project: ProjectConnection,
      record: SnapshotRecord,
    ): Promise<Map<string, Buffer>>;
  };
  await expect(reader.files(connection, project, record)).rejects.toMatchObject(
    { status: 404 },
  );
  expect(await readFile(join(f.home, "local/sync/objects", id))).toEqual(
    privateBytes,
  );
});

test("an imported project cannot alias another project's existing directory by case", async () => {
  const f = await fixture();
  const head = await f.library.head(),
    alias = f.two.id.toUpperCase();
  expect(alias).not.toBe(f.two.id);
  const projected = remapProjectFiles(f.files, f.one.id, alias);
  const privateBytes = await f.library.readFile(
    `projects/${f.two.id}/project.json`,
    head!,
  );
  await expect(
    importProjectHistory(
      f.home,
      alias,
      "other-server",
      [{ record: f.captured, files: projected }],
      projected,
      head,
      f.one.id,
    ),
  ).rejects.toThrow("alias");
  expect(await f.library.head()).toBe(head);
  expect(await f.library.readFile(`projects/${f.two.id}/project.json`)).toEqual(
    privateBytes,
  );
});

test("a package's foreign project locator cannot pull private source files into synchronization", async () => {
  const f = await fixture();
  const component = await importComponent(
    f.home,
    join(import.meta.dirname, "../../resources/catalog/value-slider"),
    f.two.id,
  );
  const current = await f.library.head();
  const path = `projects/${f.two.id}/packages/components/${component.id}/${component.version}/compiled.json`;
  const record = JSON.parse(
    (await f.library.readFile(path, current!)).toString(),
  );
  const poisoned = {
    ...record,
    dependencies: [
      {
        kind: "component",
        id: component.id,
        version: component.version,
        integrity: component.integrity,
        projectId: f.two.id,
      },
    ],
  };
  await f.library.writeFiles(
    new Map([
      [
        `projects/${f.one.id}/packages/components/hostile/1.0.0/compiled.json`,
        Buffer.from(JSON.stringify(poisoned)),
      ],
    ]),
    {
      actor: { kind: "external" },
      channel: "external",
      operationId: "foreign-dependency-probe",
    },
  );
  const head = await f.library.head();
  await expect(
    new LibraryOperations(f.home, f.one.id).projectFiles(f.one.id, head!),
  ).rejects.toThrow("missing");
  expect(await f.library.readFile(path)).toEqual(
    await f.library.readFile(path, current!),
  );
});
