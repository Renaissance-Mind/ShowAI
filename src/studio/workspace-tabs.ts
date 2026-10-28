import { translator } from "../i18n";
import sidebarMessages from "../i18n/messages/sidebar";

const t = translator(sidebarMessages);

/** `docs` is a built-in documentation page: no project, `pageId` names the page. */
export type WorkspaceView =
  | "projects"
  | "project"
  | "page"
  | "templates"
  | "components"
  | "settings"
  | "docs";

export interface WorkspaceLocation {
  view: WorkspaceView;
  projectId: string | null;
  folderId: string | null;
  pageId: string | null;
}

export interface WorkspaceEntry {
  location: WorkspaceLocation;
  title: string;
  icon?: string;
  scrollTop: number;
}

export interface WorkspaceTab {
  id: string;
  entries: WorkspaceEntry[];
  cursor: number;
  assistantOpen?: boolean;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeId: string;
}

export const recentEntry = (): WorkspaceEntry => ({
  location: { view: "projects", projectId: null, folderId: null, pageId: null },
  title: t("nav.recent"),
  scrollTop: 0,
});

export function createWorkspace(entry = recentEntry()): WorkspaceTabsState {
  const id = crypto.randomUUID();
  return { tabs: [{ id, entries: [entry], cursor: 0 }], activeId: id };
}

export function currentEntry(tab: WorkspaceTab) {
  return tab.entries[tab.cursor];
}

export function setWorkspaceAssistantOpen(
  state: WorkspaceTabsState,
  tabId: string,
  open: boolean,
): WorkspaceTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, assistantOpen: open } : tab,
    ),
  };
}

export function sameLocation(a: WorkspaceLocation, b: WorkspaceLocation) {
  return (
    a.view === b.view &&
    a.projectId === b.projectId &&
    (a.view !== "project" || a.folderId === b.folderId) &&
    a.pageId === b.pageId
  );
}

export function sameEntry(a: WorkspaceEntry, b: WorkspaceEntry) {
  return (
    sameLocation(a.location, b.location) &&
    a.location.folderId === b.location.folderId &&
    a.title === b.title &&
    a.icon === b.icon &&
    a.scrollTop === b.scrollTop
  );
}

/** Navigation belongs to the selected tab; branching discards only its forward history. */
export function visitWorkspace(
  state: WorkspaceTabsState,
  entry: WorkspaceEntry,
) {
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.id !== state.activeId) return tab;
      if (sameLocation(currentEntry(tab).location, entry.location)) {
        const entries = [...tab.entries];
        entries[tab.cursor] = entry;
        return { ...tab, entries };
      }
      const entries = [...tab.entries.slice(0, tab.cursor + 1), entry].slice(
        -50,
      );
      return { ...tab, entries, cursor: entries.length - 1 };
    }),
  };
}

export function addWorkspaceTab(
  state: WorkspaceTabsState,
  entry = recentEntry(),
  foreground = true,
) {
  const next = createWorkspace(entry);
  return {
    tabs: [...state.tabs, ...next.tabs],
    activeId: foreground ? next.activeId : state.activeId,
  };
}

export function closeWorkspaceTab(state: WorkspaceTabsState, id: string) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (!tabs.length) return createWorkspace();
  return {
    tabs,
    activeId:
      state.activeId === id
        ? tabs[Math.min(index, tabs.length - 1)].id
        : state.activeId,
  };
}

/** Move an existing tab without changing its identity, history or selection. */
export function moveWorkspaceTab(
  state: WorkspaceTabsState,
  id: string,
  targetId: string,
  placement: "before" | "after",
): WorkspaceTabsState {
  if (id === targetId) return state;
  const source = state.tabs.find((tab) => tab.id === id);
  if (!source || !state.tabs.some((tab) => tab.id === targetId)) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const index = tabs.findIndex((tab) => tab.id === targetId);
  tabs.splice(index + (placement === "after" ? 1 : 0), 0, source);
  if (tabs.every((tab, index) => tab === state.tabs[index])) return state;
  return { ...state, tabs };
}

/** Session data is window-local and scoped to the content library. */
export function parseWorkspaceTabs(
  bytes: string | null,
): WorkspaceTabsState | undefined {
  if (!bytes) return;
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
  if (!value || typeof value !== "object") return;
  const state = value as WorkspaceTabsState & { version?: number };
  const views: string[] = [
    "projects",
    "project",
    "page",
    "templates",
    "components",
    "settings",
    "docs",
  ];
  const optionalId = (id: unknown) =>
    id === null || (typeof id === "string" && /^[\w-]{1,128}$/.test(id));
  if (
    state.version !== 1 ||
    !Array.isArray(state.tabs) ||
    !state.tabs.length ||
    state.tabs.length > 200
  )
    return;
  const ids = new Set<string>();
  for (const tab of state.tabs) {
    if (
      !tab ||
      typeof tab.id !== "string" ||
      !optionalId(tab.id) ||
      ids.has(tab.id) ||
      !Array.isArray(tab.entries) ||
      !tab.entries.length ||
      tab.entries.length > 50 ||
      !Number.isInteger(tab.cursor) ||
      (tab.assistantOpen !== undefined &&
        typeof tab.assistantOpen !== "boolean") ||
      tab.cursor < 0 ||
      tab.cursor >= tab.entries.length
    )
      return;
    ids.add(tab.id);
    for (const entry of tab.entries) {
      const loc = entry?.location;
      if (
        !loc ||
        !views.includes(loc.view) ||
        !optionalId(loc.projectId) ||
        !optionalId(loc.folderId) ||
        !optionalId(loc.pageId) ||
        (loc.view === "page" && (!loc.projectId || !loc.pageId)) ||
        (loc.view === "docs" && !loc.pageId) ||
        (loc.view === "project" && !loc.projectId) ||
        typeof entry.title !== "string" ||
        (entry.icon !== undefined && typeof entry.icon !== "string") ||
        !Number.isFinite(entry.scrollTop) ||
        entry.scrollTop < 0
      )
        return;
    }
  }
  if (!ids.has(state.activeId)) return;
  return { tabs: state.tabs, activeId: state.activeId };
}

/** Templates, components and settings are side trips from the library. */
const detourViews = new Set<WorkspaceView>(["templates", "components", "settings"]);

/**
 * The history offset that "Back" in templates, components or settings takes:
 * the nearest earlier entry outside those views, or null when the tab began there.
 */
export function detourReturnOffset(tab: WorkspaceTab): number | null {
  for (let index = tab.cursor - 1; index >= 0; index--)
    if (!detourViews.has(tab.entries[index].location.view))
      return index - tab.cursor;
  return null;
}
