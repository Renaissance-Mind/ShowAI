import { describe, expect, it } from "vitest";
import {
  addWorkspaceTab,
  closeWorkspaceTab,
  createWorkspace,
  currentEntry,
  parseWorkspaceTabs,
  recentEntry,
  visitWorkspace,
  type WorkspaceEntry,
} from "./workspace-tabs";
import { tabShortcut } from "../workbench/tab-shortcuts";
import { clickDisposition, libraryEntry } from "./open-target";
import { windowQuery } from "../workbench/window-target";

const page = (id: string, projectId = "project-a"): WorkspaceEntry => ({
  location: { view: "page", projectId, pageId: id, folderId: null },
  title: id,
  scrollTop: 320,
});

describe("workspace tabs", () => {
  it("opens a target in the background while preserving the current tab and its forward history", () => {
    const visited = visitWorkspace(
      visitWorkspace(createWorkspace(), page("page-a")),
      page("page-b"),
    );
    const original = { ...visited, tabs: [{ ...visited.tabs[0], cursor: 1 }] };
    const target = page("page-c", "project-b");
    const opened = addWorkspaceTab(original, target, false);
    expect(opened.activeId).toBe(original.activeId);
    expect(opened.tabs[0]).toEqual(original.tabs[0]);
    expect(opened.tabs[1].entries).toEqual([target]);
    expect(original.tabs).toHaveLength(1);
    const foreground = addWorkspaceTab(original, target, true);
    expect(foreground.activeId).toBe(foreground.tabs[1].id);
    expect(foreground.tabs[0]).toEqual(original.tabs[0]);
  });

  it("can open the same page in distinct tabs", () => {
    const original = createWorkspace(page("page-a"));
    const opened = addWorkspaceTab(original, page("page-a"), false);
    expect(opened.tabs).toHaveLength(2);
    expect(opened.tabs[1].id).not.toBe(opened.tabs[0].id);
    expect(currentEntry(opened.tabs[1]).location).toEqual(
      currentEntry(opened.tabs[0]).location,
    );
  });
  it("opens a fresh Recent tab without changing the existing page and its history", () => {
    const original = visitWorkspace(createWorkspace(), page("page-a"));
    const opened = addWorkspaceTab(original);
    expect(opened.tabs[0]).toEqual(original.tabs[0]);
    expect(opened.activeId).toBe(opened.tabs[1].id);
    expect(currentEntry(opened.tabs[1])).toEqual(recentEntry());
    const navigated = visitWorkspace(opened, page("page-b", "project-b"));
    expect(currentEntry(navigated.tabs[0]).location.pageId).toBe("page-a");
    expect(currentEntry(navigated.tabs[1]).location.projectId).toBe(
      "project-b",
    );
  });

  it("keeps history per tab and discards forward entries only after a new visit", () => {
    let state = visitWorkspace(createWorkspace(), page("page-a"));
    state = visitWorkspace(state, page("page-b"));
    state = addWorkspaceTab(state);
    const other = state.tabs[1];
    state = {
      ...state,
      activeId: state.tabs[0].id,
      tabs: [{ ...state.tabs[0], cursor: 1 }, other],
    };
    state = visitWorkspace(state, page("page-c"));
    expect(state.tabs[0].entries.map((entry) => entry.title)).toEqual([
      "最近",
      "page-a",
      "page-c",
    ]);
    expect(state.tabs[1]).toEqual(other);
  });

  it("updates a renamed or moved page in place, including its reading position", () => {
    let state = visitWorkspace(createWorkspace(), page("page-a"));
    const updated = { ...page("page-a"), title: "Renamed", scrollTop: 640 };
    updated.location.folderId = "folder-new";
    state = visitWorkspace(state, updated);
    expect(state.tabs[0].entries).toHaveLength(2);
    expect(currentEntry(state.tabs[0])).toEqual(updated);
  });

  it("closes background tabs without changing selection, and chooses an adjacent tab when active", () => {
    const state = addWorkspaceTab(
      addWorkspaceTab(createWorkspace(page("page-a"))),
    );
    const backgroundClosed = closeWorkspaceTab(state, state.tabs[0].id);
    expect(backgroundClosed.activeId).toBe(state.activeId);
    const activeClosed = closeWorkspaceTab(state, state.activeId);
    expect(activeClosed.activeId).toBe(state.tabs[1].id);
    const middleClosed = closeWorkspaceTab(
      { ...state, activeId: state.tabs[1].id },
      state.tabs[1].id,
    );
    expect(middleClosed.activeId).toBe(state.tabs[2].id);
  });

  it("keeps the window usable on Recent after the last tab closes", () => {
    const state = createWorkspace(page("page-a"));
    const closed = closeWorkspaceTab(state, state.activeId);
    expect(closed.tabs).toHaveLength(1);
    expect(currentEntry(closed.tabs[0])).toEqual(recentEntry());
    expect(closed.activeId).not.toBe(state.activeId);
  });

  it("restores all tab histories and selected tab from valid session data", () => {
    const state = addWorkspaceTab(
      visitWorkspace(createWorkspace(), page("page-a")),
    );
    expect(
      parseWorkspaceTabs(JSON.stringify({ version: 1, ...state })),
    ).toEqual(state);
  });

  it("rejects corrupted sessions, invalid page owners and missing selected tabs", () => {
    expect(parseWorkspaceTabs("broken")).toBeUndefined();
    for (const mutate of [
      (state: ReturnType<typeof createWorkspace>) => {
        state.activeId = "missing";
      },
      (state: ReturnType<typeof createWorkspace>) => {
        state.tabs[0].cursor = 8;
      },
      (state: ReturnType<typeof createWorkspace>) => {
        state.tabs.push(state.tabs[0]);
      },
      (state: ReturnType<typeof createWorkspace>) => {
        state.tabs[0].entries[0].location.projectId = null;
      },
    ]) {
      const state = createWorkspace(page("page-a"));
      mutate(state);
      expect(
        parseWorkspaceTabs(JSON.stringify({ version: 1, ...state })),
      ).toBeUndefined();
    }
  });
});

describe("opening library targets", () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  it("uses Mac link modifiers, leaving Control-click available for the context menu", () => {
    expect(clickDisposition(click, true)).toBe("current");
    expect(clickDisposition({ ...click, metaKey: true }, true)).toBe("tab");
    expect(
      clickDisposition({ ...click, metaKey: true, shiftKey: true }, true),
    ).toBe("foreground-tab");
    expect(clickDisposition({ ...click, shiftKey: true }, true)).toBe("window");
    expect(clickDisposition({ ...click, ctrlKey: true }, true)).toBe("current");
    expect(clickDisposition({ ...click, button: 1 }, true)).toBe("tab");
    expect(
      clickDisposition({ ...click, altKey: true, metaKey: true }, true),
    ).toBe("current");
  });
  it("uses Control-click on Windows and Linux", () => {
    expect(clickDisposition({ ...click, ctrlKey: true }, false)).toBe("tab");
    expect(
      clickDisposition({ ...click, ctrlKey: true, shiftKey: true }, false),
    ).toBe("foreground-tab");
    expect(clickDisposition({ ...click, shiftKey: true }, false)).toBe(
      "window",
    );
    expect(clickDisposition({ ...click, metaKey: true }, false)).toBe(
      "current",
    );
  });
  it("retains the selected project, folder or page in a new tab and window query", () => {
    const target = {
      projectId: "project-a",
      id: "folder-a",
      title: "Folder A",
      pinned: false,
      parentId: null,
    };
    expect(libraryEntry({ ...target, kind: "folder" }).location).toEqual({
      view: "project",
      projectId: "project-a",
      folderId: "folder-a",
      pageId: null,
    });
    expect(libraryEntry({ ...target, kind: "project" }).location).toEqual({
      view: "project",
      projectId: "project-a",
      folderId: null,
      pageId: null,
    });
    expect(
      libraryEntry({ ...target, kind: "page", parentId: "parent-a" }).location,
    ).toEqual({
      view: "page",
      projectId: "project-a",
      folderId: "parent-a",
      pageId: "folder-a",
    });
    expect(windowQuery({ projectId: "project-a" })).toEqual({
      project: "project-a",
    });
    expect(
      windowQuery({ projectId: "project-a", folderId: "folder-a" }),
    ).toEqual({ project: "project-a", folder: "folder-a" });
    expect(windowQuery({ projectId: "project-a", pageId: "page-a" })).toEqual({
      project: "project-a",
      page: "page-a",
      focus: "1",
    });
    expect(windowQuery({ invite: "invitation" })).toEqual({
      invite: "invitation",
    });
    expect(windowQuery()).toEqual({});
  });
});

describe("desktop and browser tab shortcuts", () => {
  const input = {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  it("supports create, close and cycling, including input focus", () => {
    expect(tabShortcut({ ...input, key: "t", metaKey: true })).toBe("new");
    expect(tabShortcut({ ...input, key: "w", ctrlKey: true })).toBe("close");
    expect(tabShortcut({ ...input, key: "Tab", ctrlKey: true })).toBe("next");
    expect(
      tabShortcut({ ...input, key: "Tab", ctrlKey: true, shiftKey: true }),
    ).toBe("previous");
  });
  it("does not consume ordinary typing, window shortcuts or alternate-key input", () => {
    expect(tabShortcut({ ...input, key: "t" })).toBeUndefined();
    expect(
      tabShortcut({ ...input, key: "w", metaKey: true, shiftKey: true }),
    ).toBeUndefined();
    expect(
      tabShortcut({ ...input, key: "t", metaKey: true, altKey: true }),
    ).toBeUndefined();
  });
});
