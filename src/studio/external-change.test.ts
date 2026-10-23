import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../core/open-library";
import { AgentService } from "../agent/service";
import { createWorkbench } from "../workbench/actions";
import { syncManager } from "../sync/manager";
import { createPageSession, type LoadedPage, type PageSession } from "./page-session";
import { authorName } from "./external-change";
import type { ShowDocument } from "../types";

// The real workbench actions and library on disk; arguments and results pass
// through JSON like the desktop and browser bridges.
let root: string;
let invoke: <T>(action: string, args?: Record<string, unknown>) => Promise<T>;
let calls: string[];
let project: string;
let page: LoadedPage;
let session: PageSession;
const agent = { actor: { kind: "agent", harness: "codex", sessionId: "thread-1" } };

type Node = { type?: string; attrs?: Record<string, unknown> | null; content?: Node[]; text?: string };
const paragraphs = (document: ShowDocument) => {
  const found: Record<string, string> = {};
  const visit = (node: Node) => {
    if (node.type === "paragraph")
      found[String(node.attrs?.id)] = (node.content ?? []).map((text) => text.text ?? "").join("");
    else (node.content ?? []).forEach(visit);
  };
  visit(document.content as Node);
  return found;
};
const replaceNodes = (node: Node, change: (node: Node) => Node | undefined): Node =>
  change(node) ?? { ...node, ...(node.content ? { content: node.content.map((child) => replaceNodes(child, change)) } : {}) };
function withText(document: ShowDocument, id: string, text: string): ShowDocument {
  return {
    ...document,
    content: replaceNodes(document.content as Node, (node) =>
      node.attrs?.id === id ? { ...node, content: [{ type: "text", text }] } : undefined,
    ) as ShowDocument["content"],
  };
}
const disk = () =>
  invoke<LoadedPage>("pages:get", { projectId: project, pageId: page.document.id });
async function externalWrite(id: string, text: string) {
  const current = await disk();
  return invoke<LoadedPage>("pages:save", {
    projectId: project,
    pageId: page.document.id,
    document: withText(current.document, id, text),
    baseHash: current.hash,
    baseRevision: current.revision,
    historyContext: agent,
  });
}
async function until<T>(read: () => T | undefined, label: string): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-external-change-"));
  await openLibrary(root);
  const service = new AgentService({ root });
  const workbench = createWorkbench(service.store, service, {
    info: () => ({
      home: root,
      version: "test",
      platform: process.platform,
      packaged: false,
      mode: "browser",
      cli: { command: "", args: [], env: {} },
    }),
    openDialog: () => Promise.reject(new Error("No dialogs in this test.")),
    saveDialog: () => Promise.reject(new Error("No dialogs in this test.")),
    invoke: () => Promise.reject(new Error("No host actions in this test.")),
  });
  calls = [];
  invoke = async <T>(action: string, args: Record<string, unknown> = {}) => {
    calls.push(action);
    const result = await workbench(action, JSON.parse(JSON.stringify(args)));
    return (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as T;
  };
  project = (await invoke<{ id: string }>("projects:create", { name: "Agent writes" })).id;
  const created = await invoke<LoadedPage>("pages:create", { projectId: project, title: "Review" });
  page = await invoke<LoadedPage>("pages:save", {
    projectId: project,
    pageId: created.document.id,
    document: {
      ...created.document,
      surfaceViews: Object.fromEntries(
        Object.entries(created.document.surfaceViews ?? {}).map(([id, view]) => [
          id,
          { ...view, readingOrder: ["p1", "p2", "p3"] },
        ]),
      ),
      content: replaceNodes(created.document.content as Node, (node) =>
        node.type === "surface"
          ? {
              ...node,
              content: ["one", "two", "three"].map((text, index) => ({
                type: "paragraph",
                attrs: { id: `p${index + 1}` },
                content: [{ type: "text", text }],
              })),
            }
          : undefined,
      ),
    },
    baseHash: created.hash,
    baseRevision: created.revision,
  });
  session = createPageSession({
    clientId: "external-change-test",
    invoke,
    saveDelayMs: 30,
    draftDelayMs: 10,
  });
  expect(await session.open(project, page.document.id)).toBe(true);
});
afterEach(async () => {
  await session?.dispose();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

it("names the Agent, counts its changed blocks and undoes it through a normal save that keeps local edits", async () => {
  await externalWrite("p2", "two by Codex");
  await session.refresh();
  const change = await until(() => session.getSnapshot().externalChange, "notice");
  expect(change).toMatchObject({ count: 1, blockIds: ["p2"], fresh: true });
  expect(authorName(change.author)).toBe("Codex");
  expect(paragraphs(session.getSnapshot().draft!).p2).toBe("two by Codex");

  // The person keeps typing elsewhere; undo must not take that back.
  session.edit({ content: withText(session.getSnapshot().draft!, "p1", "one, edited").content });
  calls.length = 0;
  expect(await session.undoExternalChange()).toBe("merged");
  expect(calls).toContain("pages:save");
  expect(session.getSnapshot().externalChange).toBeUndefined();
  expect(paragraphs((await disk()).document)).toEqual({
    p1: "one, edited",
    p2: "two",
    p3: "three",
  });
  expect(
    await invoke("pages:externalChanges", { projectId: project, pageId: page.document.id }),
  ).toEqual([]);
});

it("never overwrites a newer write that arrived after the noticed one", async () => {
  await externalWrite("p2", "two by Codex");
  await session.refresh();
  await until(() => session.getSnapshot().externalChange, "notice");
  // Lands on disk while the notice is open, before the window refreshes.
  await externalWrite("p3", "three, newer");
  expect(await session.undoExternalChange()).toBe("merged");
  expect(session.getSnapshot().status).not.toBe("conflict");
  expect(paragraphs((await disk()).document)).toEqual({
    p1: "one",
    p2: "two",
    p3: "three, newer",
  });
});

it("restores the notice and its snapshot after the page is reopened, and 知道了 clears both", async () => {
  await externalWrite("p3", "three by Codex");
  await session.refresh();
  await until(() => session.getSnapshot().externalChange, "notice");
  await session.dispose();
  session = createPageSession({ clientId: "reopened", invoke, saveDelayMs: 30, draftDelayMs: 10 });
  await session.open(project, page.document.id);
  const restored = await until(() => session.getSnapshot().externalChange, "restored notice");
  expect(restored.fresh).toBe(false);
  await session.dismissExternalChange();
  expect(
    await invoke("pages:externalChanges", { projectId: project, pageId: page.document.id }),
  ).toEqual([]);
});

it("keeps unsaved typing when an external write lands: merged elsewhere, kept on the same block", async () => {
  // Typing stays unsaved until the explicit flush below.
  await session.dispose();
  session = createPageSession({ clientId: "typing", invoke, saveDelayMs: 60_000, draftDelayMs: 60_000 });
  await session.open(project, page.document.id);
  session.edit({ content: withText(session.getSnapshot().draft!, "p1", "one + typing").content });
  await externalWrite("p2", "two by Codex");
  await session.refresh();
  await until(() => session.getSnapshot().externalChange, "merged notice");
  expect(paragraphs(session.getSnapshot().draft!)).toMatchObject({
    p1: "one + typing",
    p2: "two by Codex",
  });
  expect(await session.flush()).toBe(true);
  expect(paragraphs((await disk()).document).p1).toBe("one + typing");

  session.edit({ content: withText(session.getSnapshot().draft!, "p1", "one + typing UNSAVED").content });
  await externalWrite("p1", "one rewritten by Codex");
  await session.refresh();
  // Either merged with the unsaved keystrokes or held as a conflict draft
  // naming the writer; unsaved input is never replaced silently.
  const state = session.getSnapshot();
  expect(paragraphs(state.draft!).p1).toContain("UNSAVED");
  if (state.status === "conflict") expect(state.error).toContain("Codex");
  else expect(paragraphs(state.draft!).p1).toContain("Codex");
});
