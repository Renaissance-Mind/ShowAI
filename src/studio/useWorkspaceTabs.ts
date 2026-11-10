import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  addWorkspaceTab,
  closeWorkspaceTab,
  createWorkspace,
  currentEntry,
  moveWorkspaceTab,
  parseWorkspaceTabs,
  pruneWorkspace,
  sameEntry,
  sameLocation,
  setWorkspaceAssistantOpen,
  visitWorkspace,
  type WorkspaceEntry,
  type WorkspaceLocation,
  type WorkspaceTabsState,
} from "./workspace-tabs";

export function useWorkspaceTabs({
  home,
  ready,
  entry,
  restore,
  getScroll,
  onError,
  beforeClose,
}: {
  home?: string;
  ready: boolean;
  entry: WorkspaceEntry;
  /**
   * Prepares the entry's content without showing it and returns a function
   * that shows it, or null when the entry cannot be opened. The function runs
   * in the same render as the tab change and returns false if it was superseded.
   */
  restore: (
    entry: WorkspaceEntry,
    tabId: string,
  ) => Promise<(() => boolean) | null>;
  getScroll: () => number;
  onError: (error: unknown) => void;
  beforeClose?: (tabId: string) => Promise<boolean>;
}) {
  const [state, setState] = useState(() => createWorkspace(entry));
  const current = useRef(state);
  const [switching, setSwitching] = useState(false);
  const pending = useRef(false);
  const closing = useRef(false);
  const library = useRef<string | undefined>(undefined);
  const restored = useRef(false);
  // How this window began: with a new workspace, or by restoring its saved tabs.
  const launch = useRef<"new" | "restored" | null>(null);
  const latest = useRef({ entry, restore, getScroll, onError, beforeClose });
  latest.current = { entry, restore, getScroll, onError, beforeClose };
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // A tab command made while another switch runs waits for it; the latest wins.
  const waiting = useRef<{ start: () => void; drop: () => void } | null>(null);
  const idle = useRef<(() => void)[]>([]);

  const publish = (next: WorkspaceTabsState) => {
    current.current = next;
    setState(next);
    if (!library.current) return;
    // Storage failures must not turn a successful navigation into an apparent failure.
    try {
      const bytes = JSON.stringify({ version: 1, ...next });
      sessionStorage.setItem(`showai:tabs:${library.current}`, bytes);
      // The most recent window's tabs come back when the App starts again.
      localStorage.setItem(`showai:tabs:last:${library.current}`, bytes);
    } catch (error) {
      latest.current.onError(error);
    }
  };

  const rememberScroll = () => {
    if (pending.current) return;
    current.current = visitWorkspace(current.current, {
      ...latest.current.entry,
      scrollTop: latest.current.getScroll(),
    });
  };

  const busyNow = () => pending.current || closing.current || !readyRef.current;
  /** Runs when no switch is in flight; a later request replaces one still waiting. */
  const whenFree = (request: () => Promise<boolean>): Promise<boolean> => {
    if (!busyNow()) return request();
    return new Promise<boolean>((resolve, reject) => {
      waiting.current?.drop();
      waiting.current = {
        start: () => void whenFree(request).then(resolve, reject),
        drop: () => resolve(false),
      };
    });
  };
  const switchingNow = () => pending.current || closing.current;
  const drain = () => {
    if (switchingNow()) return;
    const next = waiting.current;
    if (next) {
      if (!readyRef.current) return;
      waiting.current = null;
      next.start();
      return;
    }
    for (const resolve of idle.current.splice(0)) resolve();
  };
  useEffect(() => {
    if (ready) drain();
  });

  const activate = async (next: WorkspaceTabsState) => {
    if (busyNow()) return false;
    pending.current = true;
    // A quick switch renders once; only a slow one shows its busy state.
    const busy = setTimeout(() => setSwitching(true), 150);
    let shown = false;
    try {
      const target = next.tabs.find((tab) => tab.id === next.activeId)!;
      const show = await latest.current.restore(
        currentEntry(target),
        target.id,
      );
      if (!show) return false;
      clearTimeout(busy);
      pending.current = false;
      // The page, the workbench location and the tab strip change in one commit.
      flushSync(() => {
        shown = show();
        if (shown) publish(next);
        setSwitching(false);
      });
      return shown;
    } finally {
      clearTimeout(busy);
      pending.current = false;
      if (!shown) setSwitching(false);
      queueMicrotask(drain);
    }
  };

  useLayoutEffect(() => {
    if (!ready || !home || pending.current || closing.current) return;
    if (library.current !== home) {
      const firstLibrary = !library.current;
      library.current = home;
      let saved: WorkspaceTabsState | undefined;
      let previousLaunch = false;
      const params = new URLSearchParams(location.search);
      try {
        saved = parseWorkspaceTabs(
          sessionStorage.getItem(`showai:tabs:${home}`),
        );
        if (!saved && firstLibrary && params.get("restore") === "tabs") {
          saved = parseWorkspaceTabs(
            localStorage.getItem(`showai:tabs:last:${home}`),
          );
          previousLaunch = !!saved;
        }
      } catch (error) {
        latest.current.onError(error);
      }
      // An explicit page/invitation launch takes priority over a previous session.
      const explicit =
        firstLibrary && (params.has("project") || params.has("invite"));
      if (saved && !explicit && !restored.current) {
        restored.current = true;
        if (firstLibrary) launch.current = "restored";
        // Tabs from an earlier launch may name pages deleted since; start fresh then.
        const fresh = () => publish(createWorkspace(latest.current.entry));
        void activate(saved).then(
          (opened) => {
            if (!opened && previousLaunch) fresh();
          },
          (error) => {
            if (!previousLaunch) return latest.current.onError(error);
            console.warn("Previous tabs could not be restored", error);
            fresh();
          },
        );
      } else {
        restored.current = true;
        if (firstLibrary) launch.current = "new";
        publish(createWorkspace(latest.current.entry));
      }
      return;
    }
    const active = current.current.tabs.find(
      (tab) => tab.id === current.current.activeId,
    )!;
    const previous = currentEntry(active);
    const visited = {
      ...entry,
      scrollTop: sameLocation(previous.location, entry.location)
        ? previous.scrollTop
        : 0,
    };
    if (sameEntry(previous, visited)) return;
    publish(visitWorkspace(current.current, visited));
  }, [home, ready, entry, switching]);

  const select = (id: string) =>
    whenFree(async () => {
      if (
        id === current.current.activeId ||
        !current.current.tabs.some((tab) => tab.id === id)
      )
        return false;
      rememberScroll();
      return activate({ ...current.current, activeId: id });
    });
  const add = () =>
    whenFree(async () => {
      rememberScroll();
      return activate(addWorkspaceTab(current.current));
    });
  const open = (entry: WorkspaceEntry, foreground = true) =>
    whenFree(async () => {
      rememberScroll();
      const next = addWorkspaceTab(current.current, entry, foreground);
      if (foreground) return activate(next);
      publish(next);
      return true;
    });
  const close = (id?: string) =>
    whenFree(async () => {
      await closeNow(id ?? current.current.activeId);
      return true;
    });
  const closeNow = async (id: string) => {
    closing.current = true;
    setSwitching(true);
    try {
      rememberScroll();
      if (latest.current.beforeClose && !(await latest.current.beforeClose(id)))
        return;
      const next = closeWorkspaceTab(current.current, id);
      closing.current = false;
      if (next.activeId === current.current.activeId) publish(next);
      else await activate(next);
    } finally {
      closing.current = false;
      if (!pending.current) setSwitching(false);
      queueMicrotask(drain);
    }
  };
  const step = (offset: number) =>
    whenFree(async () => {
      rememberScroll();
      const tab = current.current.tabs.find(
        (tab) => tab.id === current.current.activeId,
      )!;
      const cursor = tab.cursor + offset;
      if (cursor < 0 || cursor >= tab.entries.length) return false;
      return activate({
        ...current.current,
        tabs: current.current.tabs.map((item) =>
          item.id === tab.id ? { ...tab, cursor } : item,
        ),
      });
    });
  const active = state.tabs.find((tab) => tab.id === state.activeId)!;
  return {
    ...state,
    switching,
    /** Event handlers read this; `switching` is only shown once a switch is slow. */
    isSwitching: () => pending.current || closing.current,
    /** Resolves once no tab switch is running or waiting. */
    settled: () =>
      switchingNow() || waiting.current
        ? new Promise<void>((resolve) => idle.current.push(resolve))
        : Promise.resolve(),
    /** Removes history entries for deleted content from every tab. */
    prune: (gone: (location: WorkspaceLocation) => boolean) => {
      const next = pruneWorkspace(current.current, gone);
      if (next !== current.current) publish(next);
    },
    select,
    add,
    open,
    move: (id: string, targetId: string, placement: "before" | "after") => {
      if (pending.current || closing.current || !ready) return;
      publish(moveWorkspaceTab(current.current, id, targetId, placement));
    },
    close,
    step,
    rememberScroll,
    assistantOpen: active.assistantOpen ?? false,
    setAssistantOpen: (open: boolean, tabId = current.current.activeId) =>
      publish(setWorkspaceAssistantOpen(current.current, tabId, open)),
    launchState: () => launch.current,
    canBack: active.cursor > 0,
    canForward: active.cursor < active.entries.length - 1,
  };
}
