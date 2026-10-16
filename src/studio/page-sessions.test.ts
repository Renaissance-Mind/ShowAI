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
  it("switches cached views without rereading pages and bounds resident views", async () => {
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
    expect(sessions.getSnapshot().views).toHaveLength(4);
    expect(
      sessions.getSnapshot().views.some((view) => view.tabId === "a"),
    ).toBe(false);
    await sessions.open(project, first.document.id, "a");
    expect(
      sessions.getSnapshot().views.find((view) => view.tabId === "a")!.surface
        .history!.past,
    ).toHaveLength(1);
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
