import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncManager } from "./manager";
import { AgentService, errorResult } from "../agent/service";
import { startSyncServer } from "../server/node";
import { ContentLibrary as GitLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { LibraryOperations } from "../core/library-operations";
import { withChangeContext } from "../core/history-context";
import { applyOperations } from "../core/diff";
import { plainText } from "../lib/document";
import { importComponent, resolveDocumentComponents } from "../core/catalog";
import { LibraryImport } from "../core/library-import";
import { syncProtocol } from "./protocol";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { rawSourcePlugin } from "../../scripts/raw-source-plugin.mjs";
import { stopTestProcess } from "../../scripts/stop-test-process.mjs";
const actions: (() => Promise<unknown>)[] = [];
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
afterEach(async () => {
  for (const action of actions.splice(0).reverse()) await action();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "showai-project-sync-"));
  actions.push(() =>
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 10 : 0,
      retryDelay: 50,
    }),
  );
  const server = process.env.SHOWAI_SYNC_TEST_URL
    ? { url: process.env.SHOWAI_SYNC_TEST_URL }
    : await startSyncServer({
        home: join(directory, "server"),
        port: 0,
        registrationMode: "open",
      });
  if ("close" in server) actions.push(() => server.close());
  const clients = [];
  for (const name of ["Alice", "Bob"]) {
    const home = join(directory, name),
      library = new GitLibrary(home);
    await library.initialize();
    const store = new FileStore(home),
      manager = new SyncManager(home);
    actions.push(async () => manager.stop());
    const connection = await manager.connect({
      url: server.url,
      account: `${name}-${crypto.randomUUID()}`,
      password: "test-password",
      register: true,
      registrationKey: process.env.SHOWAI_SYNC_TEST_KEY,
    });
    await manager.stop();
    clients.push({ home, library, store, manager, connection });
  }
  const [alice, bob] = clients;
  const project = await alice.store.createProject({ name: "Shared project" });
  const page = await withChangeContext(
    {
      actor: { kind: "agent", harness: "codex", sessionId: "original-session" },
      channel: "cli",
      message: "Create original page",
    },
    () => alice.store.createPage(project.id, { title: "Original page" }),
  );
  await alice.manager.attach(alice.connection.id, project.id);
  await alice.manager.stop();
  const invitation = (await alice.manager.manage(
    alice.connection.id,
    project.id,
    "invite",
    { role: "editor" },
  )) as { url: string };
  await bob.manager.join(bob.connection.id, invitation.url);
  await bob.manager.stop();
  return { directory, server, alice, bob, project, page };
}
describe("project synchronization between independent real content libraries", () => {
  it("acknowledges its own published ancestor after a lost local checkpoint without copying later edits", async () => {
    const { alice, bob, project, page } = await fixture();
    const configPath = join(alice.home, "local/sync/config.json");
    const checkpoint = await readFile(configPath);
    const original = await alice.store.readPage(project.id, page.document.id);
    const published = await alice.store.savePage(
      project.id,
      page.document.id,
      { ...original.document, title: "First local edit" },
      original.hash,
      original.revision,
    );
    await alice.manager.run();
    await alice.store.savePage(
      project.id,
      page.document.id,
      { ...published.document, title: "Later local edit" },
      published.hash,
      published.revision,
    );
    // The real server accepted publication, but the client retained its earlier
    // checkpoint, as when a process dies before persisting the acknowledgement.
    await writeFile(configPath, checkpoint);
    await new SyncManager(alice.home).run();
    await bob.manager.run();
    expect(await alice.store.listPages(project.id)).toHaveLength(1);
    expect(await bob.store.listPages(project.id)).toHaveLength(1);
    expect(await alice.manager.retainedConflicts(project.id)).toHaveLength(0);
    expect(
      (await bob.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("Later local edit");
    expect((await alice.manager.status()).projects[0].status).toBe("synced");
  });

  it("coordinates separate managers sharing one real library during continuous edits", async () => {
    const { alice, bob, project, page } = await fixture();
    const second = new SyncManager(alice.home);
    actions.push(() => second.stop());
    for (let index = 0; index < 6; index++) {
      const current = await alice.store.readPage(project.id, page.document.id);
      await alice.store.savePage(
        project.id,
        page.document.id,
        { ...current.document, title: `Shared-home edit ${index}` },
        current.hash,
        current.revision,
      );
      await Promise.all([alice.manager.run(), second.run()]);
    }
    await bob.manager.run();
    expect(await alice.store.listPages(project.id)).toHaveLength(1);
    expect(await alice.manager.retainedConflicts(project.id)).toHaveLength(0);
    expect((await alice.manager.status()).projects[0].status).toBe("synced");
    expect(
      (await bob.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("Shared-home edit 5");
  });

  it("does not publish an unresolved same-device file save conflict", async () => {
    const { alice, bob, project, page } = await fixture();
    const before = (await alice.manager.status()).projects[0].remoteHead;
    const file = join(
      alice.home,
      "workspace",
      "projects",
      project.id,
      "pages",
      `${page.document.id}.json`,
    );
    const artifact = JSON.parse(await readFile(file, "utf8"));
    artifact.document.title = "External same-device edit";
    await writeFile(file, JSON.stringify(artifact));
    await alice.store.readPage(project.id, page.document.id);
    await alice.manager.run();
    const blocked = (await alice.manager.status()).projects[0];
    expect(blocked.status).toBe("save-failed");
    expect(blocked.remoteHead).toBe(before);
    const service = new AgentService({ root: alice.home });
    const conflicts = await service.workspaceConflicts(project.id);
    await service.resolveWorkspaceConflict({
      id: conflicts[0].id,
      resolution: "import",
    });
    await alice.manager.run();
    await bob.manager.run();
    expect(
      (await bob.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("External same-device edit");
    expect((await alice.manager.status()).projects[0].status).toBe("synced");
  });
  it("reports same-device stale Agent saves as failure with actionable recovery and no duplicate page", async () => {
    const { alice, project, page } = await fixture();
    const service = new AgentService({ root: alice.home });
    const before = await alice.store.readPage(project.id, page.document.id);
    await service.savePage(
      project.id,
      page.document.id,
      { ...before.document, title: "New local edit" },
      before.hash,
      undefined,
      undefined,
      before.revision,
    );
    let failure: unknown;
    try {
      await service.applyPage(project.id, page.document.id, {
        baseHash: before.hash,
        baseRevision: before.revision,
        operations: [
          { type: "page.set", fields: { title: "Stale Agent edit" } },
        ],
      });
    } catch (error) {
      failure = error;
    }
    expect(errorResult(failure)).toMatchObject({
      code: "CONFLICT",
      saveFailed: true,
      recovery: {
        action: "read-compare-save",
        projectId: project.id,
        pageId: page.document.id,
      },
    });
    expect(
      (await alice.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("New local edit");
    expect(await alice.store.listPages(project.id)).toHaveLength(1);
    expect(await alice.manager.retainedConflicts(project.id)).toHaveLength(0);
  });
  it("keeps a dirty Agent draft as a labeled copy when a foreign device has already synchronized a conflicting version", async () => {
    const { alice, bob, project, page } = await fixture();
    const baseline = await alice.store.readPage(project.id, page.document.id);
    const remote = await bob.store.readPage(project.id, page.document.id);
    await bob.store.savePage(
      project.id,
      page.document.id,
      { ...remote.document, title: "Foreign device title" },
      remote.hash,
      remote.revision,
    );
    await bob.manager.run();
    await alice.manager.run();
    const saved = await new AgentService({ root: alice.home }).savePage(
      project.id,
      page.document.id,
      { ...baseline.document, title: "Unsaved local draft title" },
      baseline.hash,
      undefined,
      undefined,
      baseline.revision,
    );
    expect(saved.document.id).not.toBe(page.document.id);
    expect(saved.document.title).toContain(
      "Unsaved local draft title（来源：Alice-",
    );
    expect(await alice.store.listPages(project.id)).toHaveLength(2);
    await alice.manager.run();
    await bob.manager.run();
    expect(await bob.store.listPages(project.id)).toHaveLength(2);
    expect((await bob.manager.status()).projects[0].status).toBe("synced");
  });
  it("uses a saved server address for invitations created through another device's address", async () => {
    const { alice, bob, project } = await fixture();
    const invitation = (await alice.manager.manage(
      alice.connection.id,
      project.id,
      "invite",
      { role: "editor" },
    )) as { url: string };
    const link = new URL(invitation.url);
    // This origin is unavailable to the recipient, as with an SSH tunnel on another machine.
    link.port = "1";
    expect((await bob.manager.previewInvite(link.toString())).url).toBe(
      bob.connection.url,
    );
    const originalHash = link.hash;
    const parameters = new URLSearchParams(link.hash.slice(1));
    parameters.set("server", "another-server");
    link.hash = parameters.toString();
    await expect(
      bob.manager.join(bob.connection.id, link.toString()),
    ).rejects.toThrow("请选择邀请所属服务器上的账号。");
    link.hash = originalHash;
    await bob.manager.join(bob.connection.id, link.toString());
    await bob.manager.stop();
    expect((await bob.manager.status()).projects[0].status).toBe("synced");
    // Older invitations lack server identity; an explicitly selected connection still works.
    const legacy = (await alice.manager.manage(
      alice.connection.id,
      project.id,
      "invite",
      { role: "editor" },
    )) as { invite: string };
    link.hash = `invite=${legacy.invite}`;
    await bob.manager.join(bob.connection.id, link.toString());
    await bob.manager.stop();
  });
  it("downloads full history, original actors/times, and the exact archived reader", async () => {
    const { alice, bob, project, page } = await fixture();
    expect(
      (await bob.store.readPage(project.id, page.document.id)).document,
    ).toEqual(page.document);
    const source = (
      await alice.library.history({ projectId: project.id })
    ).find((entry) => entry.actor.kind === "agent")!;
    const imported = (
      await bob.library.history({ projectId: project.id })
    ).find((entry) => entry.actor.kind === "agent")!;
    expect(imported.at).toBe(source.at);
    expect(imported.actor).toEqual(source.actor);
    expect(imported.syncOrigin?.sourceRevision).toBe(source.revision);
    const before = await new LibraryOperations(alice.home).historicalHtml(
      project.id,
      page.document.id,
      source.revision,
    );
    const after = await new LibraryOperations(bob.home).historicalHtml(
      project.id,
      page.document.id,
      imported.revision,
    );
    expect(after.reader.integrity).toBe(before.reader.integrity);
    expect(after.html).toBe(before.html);
    expect((await bob.manager.status()).projects[0].status).toBe("synced");
  });
  it("merges independent offline page edits and keeps both devices' edits in history", async () => {
    const { alice, bob, project, page } = await fixture();
    const one = await alice.store.readPage(project.id, page.document.id),
      two = await bob.store.readPage(project.id, page.document.id);
    const paragraph = one.document.content.content![0].attrs!.id;
    await alice.store.savePage(
      project.id,
      page.document.id,
      applyOperations(one.document, [
        { type: "page.set", fields: { title: "Alice title" } },
      ]),
      one.hash,
      one.revision,
    );
    await bob.store.savePage(
      project.id,
      page.document.id,
      applyOperations(two.document, [
        { type: "block.text.set", blockId: paragraph, text: "Bob content" },
      ]),
      two.hash,
      two.revision,
    );
    await alice.manager.run();
    await bob.manager.run();
    await alice.manager.run();
    const a = await alice.store.readPage(project.id, page.document.id),
      b = await bob.store.readPage(project.id, page.document.id);
    expect(a.document.title).toBe("Alice title");
    expect(plainText(a.document.content.content![0])).toBe("Bob content");
    expect(a.document).toEqual(b.document);
    expect((await bob.manager.status()).projects[0].status).toBe("synced");
    expect(
      (await alice.library.history({ projectId: project.id })).length,
    ).toBeGreaterThan(3);
  });
  it("automatically keeps overlapping edits as two ordinary pages with shared origin records", async () => {
    const { alice, bob, project, page } = await fixture();
    for (const [client, title] of [
      [alice, "Alice title"],
      [bob, "Bob title"],
    ] as const) {
      const record = await client.store.readPage(project.id, page.document.id);
      await client.store.savePage(
        project.id,
        page.document.id,
        { ...record.document, title },
        record.hash,
        record.revision,
      );
    }
    await alice.manager.run();
    await bob.manager.run();
    expect((await bob.manager.status()).projects[0].status).toBe("synced");
    await alice.manager.run();
    const a = await alice.store.listPages(project.id),
      b = await bob.store.listPages(project.id);
    expect(a).toHaveLength(2);
    expect(a.map((item) => item.title).sort()).toEqual(
      b.map((item) => item.title).sort(),
    );
    expect(
      a.some((item) => item.title.startsWith("Alice title（来源：Alice-")),
    ).toBe(true);
    expect(
      a.some((item) => item.title.startsWith("Bob title（来源：Bob-")),
    ).toBe(true);
    const retained = await bob.manager.retainedConflicts(project.id);
    expect(retained).toHaveLength(1);
    expect(retained[0].variants).toHaveLength(2);
    expect(retained[0].variants.every((item) => !!item.source.revision)).toBe(
      true,
    );
    await bob.manager.run();
    await alice.manager.run();
    expect(await alice.store.listPages(project.id)).toHaveLength(2);
    expect(await alice.manager.retainedConflicts(project.id)).toHaveLength(1);
    expect(await bob.manager.conflict(project.id)).toBeNull();
  });
  it("preserves unrelated projects, separates server credentials, and resumes offline uploads", async () => {
    const { alice, bob, project } = await fixture();
    const privateProject = await alice.store.createProject({
      name: "Private project",
    });
    await alice.store.createPage(privateProject.id, {
      title: "Private evidence",
    });
    const before = await readFile(
      alice.store.pagePath(
        privateProject.id,
        (await alice.store.listPages(privateProject.id))[0].id,
      ),
    );
    await bob.store.createPage(project.id, { title: "Bob new page" });
    await bob.manager.run();
    await alice.manager.run();
    expect(
      await readFile(
        alice.store.pagePath(
          privateProject.id,
          (await alice.store.listPages(privateProject.id))[0].id,
        ),
      ),
    ).toEqual(before);
    expect(
      (await bob.store.listProjects()).some(
        (item) => item.id === privateProject.id,
      ),
    ).toBe(false);
    const status = await alice.manager.status();
    expect(status.connections[0]).not.toHaveProperty("token");
    const config = await alice.manager.configuration();
    const connection = config.connections[0];
    const originalUrl = connection.url;
    connection.url = "http://127.0.0.1:1";
    // Exercise a persisted disconnected server, without substituting the transport.
    const { atomicLibraryFile } = await import("../core/library-files");
    await atomicLibraryFile(
      alice.home,
      join(alice.home, "local/sync/config.json"),
      Buffer.from(JSON.stringify(config)),
    );
    await alice.store.createPage(project.id, { title: "Offline page" });
    await alice.manager.run();
    expect((await alice.manager.status()).projects[0].status).toBe("offline");
    connection.url = originalUrl;
    await atomicLibraryFile(
      alice.home,
      join(alice.home, "local/sync/config.json"),
      Buffer.from(JSON.stringify(config)),
    );
    const restarted = new SyncManager(alice.home);
    await restarted.run();
    await bob.manager.run();
    expect(
      (await bob.store.listPages(project.id)).some(
        (item) => item.title === "Offline page",
      ),
    ).toBe(true);
  });
  it("syncs component sources, deduplicated images and a restored old page", async () => {
    const { alice, bob, project, page } = await fixture();
    const component = await importComponent(
      alice.home,
      join(import.meta.dirname, "../../resources/catalog/value-slider"),
      project.id,
    );
    const record = await alice.store.readPage(project.id, page.document.id),
      document = structuredClone(record.document);
    document.content.content!.push({
      type: "widget",
      attrs: {
        id: "synced-slider",
        kind: "custom",
        data: {
          componentId: component.id,
          version: component.version,
          integrity: component.integrity,
          props: component.defaultData,
        },
      },
    });
    document.content.content!.push({
      type: "image",
      attrs: {
        id: "synced-image",
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VMsAAAAASUVORK5CYII=",
        alt: "Tiny image",
      },
    });
    document.title = "With component";
    await alice.store.savePage(
      project.id,
      page.document.id,
      document,
      record.hash,
      record.revision,
    );
    await alice.manager.run();
    await bob.manager.run();
    const received = await bob.store.readPage(project.id, page.document.id);
    expect(
      (
        await resolveDocumentComponents(bob.home, received.document, project.id)
      )[0].integrity,
    ).toBe(component.integrity);
    expect(
      received.document.content.content!.find(
        (node) => node.attrs?.id === "synced-image",
      )!.attrs!.src,
    ).toBe(document.content.content!.at(-1)!.attrs!.src);
    expect(
      (await bob.library.tree()).filter((entry) =>
        entry.path.startsWith("assets/"),
      ).length,
    ).toBeGreaterThan(0);
    const original = (
      await bob.library.history({ projectId: project.id })
    ).find((entry) => entry.message === "Create original page")!;
    await new LibraryOperations(bob.home).restorePage({
      projectId: project.id,
      pageId: page.document.id,
      revision: original.revision,
      baseRevision: received.revision!,
    });
    await bob.manager.run();
    await alice.manager.run();
    expect(
      (await alice.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("Original page");
  });
  it("retains unknown legacy checkpoints and their original readers across devices", async () => {
    const { directory, alice, bob } = await fixture();
    const old = new FileStore(join(directory, "legacy-source")),
      project = await old.createProject({ name: "Legacy history" });
    const first = await old.createPage(project.id, { title: "Old title" });
    await old.savePage(
      project.id,
      first.document.id,
      { ...first.document, title: "Current legacy title" },
      first.hash,
    );
    const importedHome = join(directory, "legacy-migrated"),
      importer = new LibraryImport(importedHome),
      report = await importer.prepare(old.root);
    await importer.activate(report.id);
    const sender = new SyncManager(importedHome);
    actions.push(() => sender.stop());
    const connection = await sender.connect({
      url: alice.connection.url,
      account: `Legacy-${crypto.randomUUID()}`,
      password: "test-password",
      register: true,
      registrationKey: process.env.SHOWAI_SYNC_TEST_KEY,
    });
    await sender.stop();
    await sender.attach(connection.id, project.id);
    await sender.stop();
    const invite = (await sender.manage(connection.id, project.id, "invite", {
      role: "viewer",
    })) as { url: string };
    await bob.manager.join(bob.connection.id, invite.url);
    await bob.manager.stop();
    const before = await new LibraryOperations(importedHome).importedSnapshots(
        project.id,
        first.document.id,
      ),
      after = await new LibraryOperations(bob.home).importedSnapshots(
        project.id,
        first.document.id,
      );
    expect(after.length).toBe(before.length);
    expect(after.length).toBeGreaterThan(0);
    expect(
      after.every(
        (snapshot) =>
          snapshot.actor === "unknown" &&
          snapshot.editTime === null &&
          snapshot.order === null,
      ),
    ).toBe(true);
    const ref = { importId: before[0].importId, snapshotId: before[0].id };
    const a = await new LibraryOperations(importedHome).importedHtml(
        project.id,
        first.document.id,
        ref,
      ),
      b = await new LibraryOperations(bob.home).importedHtml(
        project.id,
        first.document.id,
        ref,
      );
    expect(b.html).toBe(a.html);
    expect(b.reader.integrity).toBe(a.reader.integrity);
  });
  it("enrolls new projects while the default server is offline and enforces viewer writes", async () => {
    const { alice, bob, project, page } = await fixture();
    await alice.manager.setDefault(alice.connection.id);
    const config = await alice.manager.configuration();
    config.connections[0].url = "http://127.0.0.1:1";
    const { atomicLibraryFile } = await import("../core/library-files");
    await atomicLibraryFile(
      alice.home,
      join(alice.home, "local/sync/config.json"),
      Buffer.from(JSON.stringify(config)),
    );
    const offline = await alice.store.createProject({
      name: "Created offline",
    });
    await alice.manager.run();
    expect(
      (await alice.manager.status()).projects.find(
        (item) => item.projectId === offline.id,
      )?.status,
    ).toBe("offline");
    const latest = await alice.manager.configuration();
    latest.connections[0].url = alice.connection.url;
    await atomicLibraryFile(
      alice.home,
      join(alice.home, "local/sync/config.json"),
      Buffer.from(JSON.stringify(latest)),
    );
    await alice.manager.run();
    expect(
      (await alice.manager.remoteProjects(alice.connection.id)).some(
        (item) => item.id === offline.id && item.head,
      ),
    ).toBe(true);
    await alice.manager.manage(alice.connection.id, project.id, "member", {
      userId: bob.connection.user.id,
      role: "viewer",
    });
    await bob.manager.run();
    const record = await bob.store.readPage(project.id, page.document.id);
    await expect(
      bob.store.savePage(
        project.id,
        page.document.id,
        { ...record.document, title: "Unauthorized" },
        record.hash,
        record.revision,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await bob.store.readPage(project.id, page.document.id)).document.title,
    ).toBe(record.document.title);
  });
  it("keeps same-ID projects on different servers independent and migrates imported history", async () => {
    const { directory, alice, bob, project, page } = await fixture();
    const server = await startSyncServer({
      home: join(directory, "second-server"),
      port: 0,
      registrationMode: "open",
    });
    actions.push(() => server.close());
    const other = await alice.manager.connect({
      url: server.url,
      account: "Other",
      password: "test-password",
      register: true,
    });
    await alice.manager.stop();
    await alice.manager.detach(project.id);
    await alice.manager.attach(other.id, project.id);
    await alice.manager.stop();
    const connection = await bob.manager.connect({
      url: server.url,
      account: "Bob-two",
      password: "test-password",
      register: true,
    });
    await bob.manager.stop();
    const invite = (await alice.manager.manage(other.id, project.id, "invite", {
      role: "editor",
    })) as { url: string };
    await bob.manager.join(connection.id, invite.url);
    await bob.manager.stop();
    const copies = (await bob.manager.status()).projects.filter(
      (item) => item.remoteProjectId === project.id,
    );
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((item) => item.projectId)).size).toBe(2);
    const copy = copies.find((item) => item.connectionId === connection.id)!;
    const record = await bob.store.readPage(copy.projectId, page.document.id);
    await bob.store.savePage(
      copy.projectId,
      page.document.id,
      { ...record.document, title: "Second server title" },
      record.hash,
      record.revision,
    );
    await bob.manager.run(copy.projectId);
    await alice.manager.run(project.id);
    expect(
      (await alice.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("Second server title");
    expect(
      (await bob.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("Original page");
    const info = await (await fetch(server.url + "/api/info")).json();
    expect(info.protocol).toBe(syncProtocol);
  });
  it.each([
    "during history replay",
    "before merge publication",
    "before merge publication with later edits",
    "during history replay with later conflicting edits",
  ])(
    "recovers a genuinely killed client %s without losing offline edits",
    async (phase) => {
      const { alice, bob, project, page } = await fixture();
      const own = await bob.store.readPage(project.id, page.document.id),
        paragraph = own.document.content.content![0].attrs!.id;
      await bob.store.savePage(
        project.id,
        page.document.id,
        applyOperations(own.document, [
          {
            type: "block.text.set",
            blockId: paragraph,
            text: "Offline content survives process death",
          },
        ]),
        own.hash,
        own.revision,
      );
      const theirs = await alice.store.readPage(project.id, page.document.id);
      await alice.store.savePage(
        project.id,
        page.document.id,
        { ...theirs.document, title: "Remote title survives process death" },
        theirs.hash,
        theirs.revision,
      );
      for (let index = 0; index < 12; index++)
        await alice.store.createPage(project.id, {
          title: `Replay history ${index}`,
        });
      await alice.manager.run();
      const expectedRemote = (await alice.manager.status()).projects[0]
        .remoteHead;
      const directory = join(
        import.meta.dirname,
        "../../node_modules/.cache",
        `showai-sync-kill-${crypto.randomUUID()}`,
      );
      await mkdir(directory, { recursive: true });
      actions.push(() => rm(directory, { recursive: true, force: true }));
      const entry = join(directory, "cli.mjs");
      await build({
        entryPoints: {
          cli: join(import.meta.dirname, "../agent/cli.ts"),
          "index-worker": join(import.meta.dirname, "../core/index-worker.ts"),
        },
        outdir: directory,
        outExtension: { ".js": ".mjs" },
        bundle: true,
        platform: "node",
        target: "node22",
        format: "esm",
        external: ["esbuild"],
        plugins: [rawSourcePlugin],
        banner: {
          js: 'import { createRequire as __showaiRequire } from "node:module"; const require = __showaiRequire(import.meta.url);',
        },
      });
      const markers = join(
          bob.home,
          "workspace",
          "projects",
          project.id,
          ".sync",
          "versions",
        ),
        before = (await readdir(markers)).filter((name) =>
          name.endsWith(".json"),
        ).length;
      let killed = false,
        output = "";
      let stopping: Promise<void> | undefined;
      const configDirectory = join(bob.home, "local", "sync");
      const observer = watch(
        phase.startsWith("during history replay") ? markers : configDirectory,
        () => {
          const ready = phase.startsWith("during history replay")
            ? readdir(markers).then(
                (names) =>
                  names.filter((name) => name.endsWith(".json")).length >
                  before,
              )
            : readFile(join(configDirectory, "config.json"), "utf8").then(
                (value) =>
                  JSON.parse(value).projects.some(
                    (entry: {
                      projectId: string;
                      remoteHead: string | null;
                      status: string;
                    }) =>
                      entry.projectId === project.id &&
                      entry.remoteHead === expectedRemote &&
                      entry.status === "pending",
                  ),
              );
          void ready.then((found) => {
            if (!killed && found) {
              killed = true;
              // Kill immediately at the observed checkpoint. Starting taskkill
              // here can let the client publish and remove its pending marker.
              child.kill("SIGKILL");
            }
          });
        },
      );
      const child = spawn(
        process.execPath,
        [entry, "sync", "run", "--project", project.id, "--json"],
        {
          env: {
            ...process.env,
            SHOWAI_HOME: bob.home,
            SHOWAI_VIEWER: join(
              import.meta.dirname,
              "../../dist-portable/portable.html",
            ),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (bytes) => (output += bytes.toString()));
      child.stderr.on("data", (bytes) => (output += bytes.toString()));
      const deadline = setTimeout(
        () => {
          stopping = stopTestProcess(child);
        },
        process.platform === "win32" ? 45_000 : 25_000,
      );
      await new Promise<void>((done, reject) => {
        child.once("error", reject);
        child.once("exit", () => done());
      });
      clearTimeout(deadline);
      observer.close();
      await stopping;
      expect(killed, output).toBe(true);
      expect(
        JSON.parse(
          await readFile(
            join(bob.home, "local/sync/pending-imports", `${project.id}.json`),
            "utf8",
          ),
        ).needsPublish,
      ).toBe(true);
      const lateConflict = phase.endsWith("with later conflicting edits");
      if (lateConflict) {
        const current = await bob.store.readPage(project.id, page.document.id);
        await bob.store.savePage(
          project.id,
          page.document.id,
          applyOperations(current.document, [
            {
              type: "block.text.set",
              blockId: paragraph,
              text: "Late local body after process death",
            },
          ]),
          current.hash,
          current.revision,
        );
      }
      if (phase.endsWith("with later edits")) {
        const current = await bob.store.readPage(project.id, page.document.id);
        await bob.store.savePage(
          project.id,
          page.document.id,
          { ...current.document, title: "Local title after process death" },
          current.hash,
          current.revision,
        );
      }
      const restarted = new SyncManager(bob.home);
      await restarted.run();
      const result = await bob.store.readPage(project.id, page.document.id);
      if (lateConflict) {
        const record = (await restarted.retainedConflicts(project.id)).find(
          (item) => item.originalPageId === page.document.id,
        )!;
        expect(record).toBeDefined();
        const documents = await Promise.all(
          record.variants.map((item) =>
            bob.store.readPage(project.id, item.pageId),
          ),
        );
        const texts = documents.map((item) =>
          plainText(item.document.content.content![0]),
        );
        expect(texts).toContain("Late local body after process death");
        expect(texts).toContain("Offline content survives process death");
      } else {
        expect(result.document.title).toBe(
          phase.endsWith("with later edits")
            ? "Local title after process death"
            : "Remote title survives process death",
        );
        expect(plainText(result.document.content.content![0])).toBe(
          "Offline content survives process death",
        );
      }
      expect((await restarted.status()).projects[0].status).toBe("synced");
      await alice.manager.run();
      expect(
        (await alice.store.readPage(project.id, page.document.id)).document,
      ).toEqual(result.document);
      await expect(
        readFile(
          join(bob.home, "local/sync/pending-imports", `${project.id}.json`),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
    process.platform === "win32" ? 120_000 : 60_000,
  );
});
