import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startBrowserServer } from "../browser/server";
import { withLibraryLock } from "../core/library-lock";
import { serializeArtifact } from "../portable/validation.mjs";
import { PageSessions } from "./page-sessions";
import type { LoadedPage } from "./page-session";
import type { ContainerDocument } from "../types";
import type { JSONContent } from "@tiptap/core";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
describe("workspace sessions against the real loopback workbench", () => {
  let directory: string;
  let home: string;
  let server: Awaited<ReturnType<typeof startBrowserServer>>;
  let sessions: PageSessions;
  let project: string;
  let first: LoadedPage;
  let second: LoadedPage;
  const calls: string[] = [];
  let invoke: <T>(action: string, args?: Record<string, unknown>) => Promise<T>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "showai-page-sessions-"));
    home = join(directory, "library");
    server = await startBrowserServer({
      home,
      webRoot: resolve("dist-runtime/web"),
      cliEntry: resolve("dist-runtime/scripts/cli.mjs"),
      settingsPath: join(directory, "profile", "settings.json"),
    });
    const html = await (await fetch(server.url)).text();
    const token = JSON.parse(
      html.match(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/)![1],
    ).token;
    invoke = async <T>(
      action: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      calls.push(action);
      const response = await fetch(server.url + "api/invoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, args }),
      });
      const result = await response.json();
      if (!result.ok) throw result.error;
      return result.data;
    };
    project = (
      await invoke<{ id: string }>("projects:create", { name: "Workspace" })
    ).id;
    first = await invoke<LoadedPage>("pages:create", {
      projectId: project,
      title: "First",
    });
    second = await invoke<LoadedPage>("pages:create", {
      projectId: project,
      title: "Second",
    });
    sessions = new PageSessions({
      clientId: "workspace-test-client",
      invoke,
      saveDelayMs: 50,
      draftDelayMs: 20,
    });
    sessions.setHome(home);
    calls.length = 0;
  });
  it("opens a just-created page without rereading or looking up recovery drafts", async () => {
    const before = calls.length;
    expect(
      await sessions.open(project, first.document.id, "created", first),
    ).toBe(true);
    expect(calls.slice(before)).not.toContain("pages:get");
    expect(calls.slice(before)).not.toContain("drafts:list");
    expect(sessions.getSnapshot().active?.getSnapshot().draft?.id).toBe(
      first.document.id,
    );
  });
  afterEach(async () => {
    await sessions.shutdown();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function warm() {
    await sessions.open(project, first.document.id, "a");
    const a = sessions.getSnapshot().active!;
    await sessions.open(project, second.document.id, "b");
    await sessions.open(project, first.document.id, "a");
    return a;
  }
  it("retires a moved page's retained editors and reloads its destination on reopen", async () => {
    const originalSession = await warm();
    await sessions.open(project, second.document.id, "b");
    const otherSession = sessions.getSnapshot().active;
    expect(await sessions.flushAll()).toBe(true);
    const destination = await invoke<{ id: string }>("folders:create", {
      projectId: project,
      name: "Destination",
    });
    const record = await invoke<LoadedPage>("pages:get", {
      projectId: project,
      pageId: first.document.id,
    });
    await invoke("sidebar:moveEntry", {
      kind: "page",
      projectId: project,
      destinationProjectId: project,
      id: first.document.id,
      parentId: destination.id,
      baseHash: record.hash,
      baseRevision: record.revision,
    });
    sessions.forgetPage(project, first.document.id);
    expect(
      sessions
        .getSnapshot()
        .views.some((view) => view.session === originalSession),
    ).toBe(false);
    expect(sessions.getSnapshot().active).toBe(otherSession);
    expect(await sessions.open(project, first.document.id, "a")).toBe(true);
    expect(sessions.getSnapshot().active).not.toBe(originalSession);
    expect(sessions.getSnapshot().active?.getSnapshot().draft?.parentId).toBe(
      destination.id,
    );
  });
  it("keeps unsaved editors when asked to forget a page", async () => {
    await sessions.open(project, first.document.id, "a");
    const active = sessions.getSnapshot().active!;
    active.edit({ title: "Unsaved title" });
    expect(() => sessions.forgetPage(project, first.document.id)).toThrow(
      "Save the page",
    );
    expect(sessions.getSnapshot().active).toBe(active);
    expect(await sessions.flushAll()).toBe(true);
    sessions.forgetPage(project, first.document.id);
    expect(sessions.getSnapshot().active).toBeNull();
    expect(sessions.getSnapshot().views).toHaveLength(0);
  });
  it("does not restore an unchanged retained draft over a newer formal page", async () => {
    const retained = await invoke<{ id: string }>("drafts:save", {
      input: {
        kind: "page",
        clientId: "workspace-test-client",
        projectId: project,
        resourceId: first.document.id,
        baseRevision: first.revision,
        baseContent: first.document,
        content: first.document,
        sequence: 1,
      },
    });
    const remote = await invoke<LoadedPage>("pages:save", {
      projectId: project,
      pageId: first.document.id,
      document: { ...first.document, title: "New formal content" },
      baseHash: first.hash,
      baseRevision: first.revision,
    });
    await sessions.open(project, first.document.id, "a");
    const view = sessions.getSnapshot().active!;
    expect(view.getSnapshot().status).toBe("saved");
    expect(view.getSnapshot().draft).toEqual(remote.document);
    const remaining = await invoke<{ id: string }[]>("drafts:list", {
      projectId: project,
      resourceId: first.document.id,
    });
    expect(remaining.some((item) => item.id === retained.id)).toBe(false);
  });
  it.each([false, true])(
    "rebases a retained typing draft on Agent additions when reopening (already synced: %s)",
    async (alreadySynced) => {
      const local = structuredClone(first.document);
      const typed: JSONContent = {
        type: "paragraph",
        attrs: { id: crypto.randomUUID() },
        content: [
          { type: "text", text: "Human draft after switching runtime" },
        ],
      };
      local.content.content!.push(typed);
      await invoke("drafts:save", {
        input: {
          kind: "page",
          clientId: "workspace-test-client",
          projectId: project,
          resourceId: first.document.id,
          baseRevision: first.revision,
          baseContent: first.document,
          content: local,
          sequence: 2,
        },
      });
      const remote = structuredClone(first.document);
      remote.content.content!.push({
        type: "paragraph",
        attrs: { id: crypto.randomUUID() },
        content: [
          { type: "text", text: "Agent addition while page was closed" },
        ],
      });
      if (alreadySynced) remote.content.content!.push(typed);
      await invoke("pages:save", {
        projectId: project,
        pageId: first.document.id,
        document: remote,
        baseHash: first.hash,
        baseRevision: first.revision,
      });
      await sessions.open(project, first.document.id, "reopened");
      const view = sessions.getSnapshot().active!;
      expect(view.getSnapshot().status).not.toBe("conflict");
      expect(await view.flush()).toBe(true);
      const saved = await invoke<LoadedPage>("pages:get", {
        projectId: project,
        pageId: first.document.id,
      });
      const texts = saved.document.content.content!.flatMap(
        (n) => n.content?.map((child) => child.text) ?? [],
      );
      expect(
        texts.filter((text) => text === "Human draft after switching runtime"),
      ).toHaveLength(1);
      expect(texts).toContain("Agent addition while page was closed");
      expect(view.getSnapshot().status).toBe("saved");
      expect(
        await invoke("drafts:list", {
          kind: "page",
          projectId: project,
          resourceId: first.document.id,
        }),
      ).toEqual([]);
    },
  );
  it("saves nested unusable links as text while keeping the exact original recovery draft", async () => {
    const view = await warm();
    const content = structuredClone(view.getSnapshot().draft!.content);
    const find = (node: JSONContent): JSONContent | undefined =>
      node.type === "paragraph" ? node : node.content?.map(find).find(Boolean);
    find(content)!.content = [
      {
        type: "text",
        text: "Preserve every word",
        marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
      },
    ];
    view.editContent(content);
    expect(await view.flush()).toBe(true);
    const saved = await invoke<LoadedPage>("pages:get", {
      projectId: project,
      pageId: first.document.id,
    });
    expect(JSON.stringify(saved.document)).toContain("Preserve every word");
    expect(JSON.stringify(saved.document)).not.toContain("javascript:");
    const drafts = view.getSnapshot().availableDrafts;
    const recovery = drafts.find((item) =>
      item.clientId.includes(":link-recovery:"),
    )!;
    expect(recovery).toBeDefined();
    const original = await invoke<{ content: unknown }>("drafts:read", {
      id: recovery.id,
    });
    expect(JSON.stringify(original.content)).toContain("javascript:alert(1)");
  });
  it("merges independent live Agent changes with human typing without stopping the editor", async () => {
    const view = await warm();
    const content = structuredClone(view.getSnapshot().draft!.content);
    const find = (node: JSONContent): JSONContent | undefined =>
      node.type === "paragraph" ? node : node.content?.map(find).find(Boolean);
    find(content)!.content = [{ type: "text", text: "Human typing continues" }];
    view.editContent(content);
    await invoke("pages:save", {
      projectId: project,
      pageId: first.document.id,
      document: { ...first.document, title: "Agent updated the title" },
      baseHash: first.hash,
      baseRevision: first.revision,
    });
    await view.refresh();
    expect(await view.flush()).toBe(true);
    const saved = await invoke<LoadedPage>("pages:get", {
      projectId: project,
      pageId: first.document.id,
    });
    expect(saved.document.title).toBe("Agent updated the title");
    expect(JSON.stringify(saved.document.content)).toContain(
      "Human typing continues",
    );
    expect(view.getSnapshot().status).toBe("saved");
  });
  it("keeps every open tab resident, including duplicate pages beyond the history budget", async () => {
    await warm();
    calls.length = 0;
    await sessions.open(project, second.document.id, "b");
    await sessions.open(project, first.document.id, "a");
    expect(calls).toEqual([]);
    expect(sessions.getSnapshot().views).toHaveLength(2);
    expect(sessions.getSnapshot().views.map((view) => view.tabId)).toEqual([
      "a",
      "b",
    ]);
    const a = sessions.getSnapshot().views.find((view) => view.tabId === "a")!;
    a.surface.history = {
      past: [first.document as ContainerDocument],
      future: [],
      group: "typing",
      at: 1,
    };
    await sessions.open(project, first.document.id, "c");
    expect(
      sessions.getSnapshot().views.find((view) => view.tabId === "a")!.surface
        .history!.past,
    ).toHaveLength(1);
    expect(
      sessions.getSnapshot().views.find((view) => view.tabId === "c")!.surface
        .history,
    ).toBeUndefined();
    expect(await sessions.closeTab("c")).toBe(true);
    expect(
      sessions.getSnapshot().views.some((view) => view.tabId === "c"),
    ).toBe(false);
    await sessions.open(project, second.document.id, "d");
    await sessions.open(project, second.document.id, "e");
    await sessions.open(project, second.document.id, "f");
    await sessions.open(project, second.document.id, "g");
    expect(sessions.getSnapshot().views).toHaveLength(6);
    expect(
      sessions.getSnapshot().views.some((view) => view.tabId === "a"),
    ).toBe(true);
    await sessions.open(project, first.document.id, "a");
    expect(
      sessions.getSnapshot().views.find((view) => view.tabId === "a")!.surface
        .history!.past,
    ).toHaveLength(1);
  });
  it("evicts navigation history before a tab's current page, even over the byte budget", async () => {
    await sessions.shutdown();
    sessions = new PageSessions({
      clientId: "bounded-history",
      invoke,
      maximumViews: 1,
      maximumViewBytes: 1,
    });
    sessions.setHome(home);
    await sessions.open(project, first.document.id, "a");
    const firstView = sessions.getSnapshot().views[0];
    await sessions.open(project, second.document.id, "b");
    expect(sessions.getSnapshot().views).toHaveLength(2);
    expect(sessions.getSnapshot().views[0]).toBe(firstView);
    await sessions.open(project, second.document.id, "a");
    expect(sessions.getSnapshot().views.map((view) => view.tabId)).toEqual([
      "b",
      "a",
    ]);
    expect(await sessions.closeTab("b")).toBe(true);
    expect(sessions.getSnapshot().views.map((view) => view.tabId)).toEqual([
      "a",
    ]);
  });
  it("retains locally and switches while the actual database writer is busy", async () => {
    const a = await warm();
    const entered = deferred(),
      release = deferred();
    const held = withLibraryLock(home, async () => {
      entered.release();
      await release.promise;
    });
    await entered.promise;
    try {
      a.edit({ title: "Saved in background" });
      await sessions.open(project, second.document.id, "b");
      expect(a.isDurable()).toBe(true);
      expect(a.getSnapshot().status).toBe("saving");
      expect(sessions.getSnapshot().active!.getSnapshot().draft!.title).toBe(
        "Second",
      );
      expect(await sessions.prepareClose()).toBe(true);
    } finally {
      release.release();
      await held;
    }
    expect(await sessions.flushAll()).toBe(true);
    expect(
      (
        await invoke<LoadedPage>("pages:get", {
          projectId: project,
          pageId: first.document.id,
        })
      ).document.title,
    ).toBe("Saved in background");
    expect(sessions.getSnapshot().active!.getSnapshot().draft!.title).toBe(
      "Second",
    );
  });
  it("preserves a failed inactive save and restores its real draft on reopening", async () => {
    const a = await warm();
    const entered = deferred(),
      release = deferred();
    const held = withLibraryLock(home, async () => {
      entered.release();
      await release.promise;
    });
    await entered.promise;
    try {
      a.edit({ title: "My retained edit" });
      await sessions.open(project, second.document.id, "b");
      await writeFile(
        first.path,
        serializeArtifact({ ...first.document, title: "External file edit" }),
      );
    } finally {
      release.release();
      await held;
    }
    expect(await sessions.flushAll()).toBe(false);
    expect(
      sessions
        .getSnapshot()
        .issues.some((issue) => issue.pageId === first.document.id),
    ).toBe(true);
    expect(sessions.getSnapshot().active!.getSnapshot().draft!.title).toBe(
      "Second",
    );
    expect(await sessions.prepareClose()).toBe(true);
    await sessions.shutdown();
    sessions = new PageSessions({ clientId: "workspace-test-client", invoke });
    sessions.setHome(home);
    await sessions.open(project, first.document.id, "restored");
    expect(sessions.getSnapshot().active!.getSnapshot().draft!.title).toBe(
      "My retained edit",
    );
    expect(sessions.getSnapshot().active!.getSnapshot().status).toBe(
      "conflict",
    );
  });
  it("does not notify the workspace metadata for every body keystroke", async () => {
    const a = await warm();
    let updates = 0;
    const stop = sessions.subscribe(() => {
      updates++;
    });
    for (let index = 0; index < 10; index++) {
      const content = structuredClone(a.getSnapshot().draft!.content);
      const find = (node: JSONContent): JSONContent | undefined =>
        node.type === "paragraph"
          ? node
          : node.content?.map(find).find(Boolean);
      const text = find(content)!;
      text.content = [{ type: "text", text: `typed ${index}` }];
      a.editContent(content);
      await Promise.resolve();
    }
    stop();
    expect(updates).toBe(1);
    expect(JSON.stringify(a.getSnapshot().draft!.content)).toContain("typed 9");
    expect(await sessions.flushAll()).toBe(true);
  });
  it("does not discard a draft on an unprepared content-library switch", async () => {
    const a = await warm();
    a.edit({ title: "Retain before leaving" });
    expect(() => sessions.setHome(join(directory, "other-library"))).toThrow(
      "可靠保留",
    );
    expect(sessions.getSnapshot().active).toBe(a);
    expect(a.getSnapshot().draft!.title).toBe("Retain before leaving");
    expect(await sessions.flushAll()).toBe(true);
  });
});
