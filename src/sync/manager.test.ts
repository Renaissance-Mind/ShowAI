import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncManager } from "./manager";
import { startSyncServer } from "../server/node";
import { GitLibrary } from "../core/git-library";
import { FileStore } from "../core/store";
import { LibraryOperations } from "../core/library-operations";
import { withChangeContext } from "../core/history-context";
import { applyOperations } from "../core/diff";
import { importComponent, resolveDocumentComponents } from "../core/catalog";
import { LibraryImport } from "../core/library-import";
import { syncProtocol } from "./protocol";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { rawSourcePlugin } from "../../scripts/raw-source-plugin.mjs";
const actions: (() => Promise<unknown>)[] = [];
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
afterEach(async () => {
  for (const action of actions.splice(0).reverse()) await action();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "showai-project-sync-"));
  actions.push(() => rm(directory, { recursive: true, force: true }));
  const server = process.env.SHOWAI_SYNC_TEST_URL
    ? { url: process.env.SHOWAI_SYNC_TEST_URL }
    : await startSyncServer({ home: join(directory, "server"), port: 0 });
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
      password: "test",
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
    expect(a.document.content.content![0].content![0].text).toBe("Bob content");
    expect(a.document).toEqual(b.document);
    expect((await bob.manager.status()).projects[0].status).toBe("synced");
    expect(
      (await alice.library.history({ projectId: project.id })).length,
    ).toBeGreaterThan(3);
  });
  it("retains overlapping edits until explicitly resolved and propagates the resolution", async () => {
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
    expect((await bob.manager.status()).projects[0].status).toBe("conflict");
    expect(
      (await bob.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("Bob title");
    const conflict = (await bob.manager.conflict(project.id))!;
    expect(conflict.files.length).toBeGreaterThan(0);
    await bob.manager.resolveConflict(
      project.id,
      Object.fromEntries(conflict.files.map((file) => [file.path, "local"])),
    );
    await alice.manager.run();
    expect(
      (await alice.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("Bob title");
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
      password: "test",
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
    });
    actions.push(() => server.close());
    const other = await alice.manager.connect({
      url: server.url,
      account: "Other",
      password: "test",
      register: true,
    });
    await alice.manager.stop();
    await alice.manager.detach(project.id);
    await alice.manager.attach(other.id, project.id);
    await alice.manager.stop();
    const connection = await bob.manager.connect({
      url: server.url,
      account: "Bob-two",
      password: "test",
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
  it.each(["during history replay", "before merge publication"])(
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
        entryPoints: [join(import.meta.dirname, "../agent/cli.ts")],
        outfile: entry,
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
      const configDirectory = join(bob.home, "local", "sync");
      const observer = watch(
        phase === "during history replay" ? markers : configDirectory,
        () => {
          const ready =
            phase === "during history replay"
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
      const deadline = setTimeout(() => child.kill("SIGKILL"), 25_000);
      await new Promise<void>((done, reject) => {
        child.once("error", reject);
        child.once("exit", () => done());
      });
      clearTimeout(deadline);
      observer.close();
      expect(killed, output).toBe(true);
      expect(
        JSON.parse(
          await readFile(
            join(bob.home, "local/sync/pending-imports", `${project.id}.json`),
            "utf8",
          ),
        ).needsPublish,
      ).toBe(true);
      const restarted = new SyncManager(bob.home);
      await restarted.run();
      const result = await bob.store.readPage(project.id, page.document.id);
      expect(result.document.title).toBe("Remote title survives process death");
      expect(result.document.content.content![0].content![0].text).toBe(
        "Offline content survives process death",
      );
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
    60_000,
  );
});
