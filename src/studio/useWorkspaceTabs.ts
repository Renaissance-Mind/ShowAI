import { useLayoutEffect, useRef, useState } from "react";
import {
  addWorkspaceTab,
  closeWorkspaceTab,
  createWorkspace,
  currentEntry,
  parseWorkspaceTabs,
  sameLocation,
  visitWorkspace,
  type WorkspaceEntry,
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
  restore: (entry: WorkspaceEntry, tabId: string) => Promise<boolean>;
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
  const latest = useRef({ entry, restore, getScroll, onError, beforeClose });
  latest.current = { entry, restore, getScroll, onError, beforeClose };

  const publish = (next: WorkspaceTabsState) => {
    current.current = next;
    setState(next);
    if (!library.current) return;
    // Storage failures must not turn a successful navigation into an apparent failure.
    try {
      sessionStorage.setItem(
        `showai:tabs:${library.current}`,
        JSON.stringify({ version: 1, ...next }),
      );
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

  const activate = async (next: WorkspaceTabsState) => {
    if (pending.current || closing.current || !ready) return false;
    pending.current = true;
    setSwitching(true);
    try {
      const target = next.tabs.find((tab) => tab.id === next.activeId)!;
      if (!(await latest.current.restore(currentEntry(target), target.id)))
        return false;
      publish(next);
      return true;
    } finally {
      pending.current = false;
      setSwitching(false);
    }
  };

  useLayoutEffect(() => {
    if (!ready || !home || pending.current || closing.current) return;
    if (library.current !== home) {
      const firstLibrary = !library.current;
      library.current = home;
      let saved: WorkspaceTabsState | undefined;
      try {
        saved = parseWorkspaceTabs(
          sessionStorage.getItem(`showai:tabs:${home}`),
        );
      } catch (error) {
        latest.current.onError(error);
      }
      const params = new URLSearchParams(location.search);
      // An explicit page/invitation launch takes priority over a previous session.
      const explicit =
        firstLibrary && (params.has("project") || params.has("invite"));
      if (saved && !explicit && !restored.current) {
        restored.current = true;
        void activate(saved).catch(latest.current.onError);
      } else {
        restored.current = true;
        publish(createWorkspace(latest.current.entry));
      }
      return;
    }
    const active = current.current.tabs.find(
      (tab) => tab.id === current.current.activeId,
    )!;
    const previous = currentEntry(active);
    const next = visitWorkspace(current.current, {
      ...entry,
      scrollTop: sameLocation(previous.location, entry.location)
        ? previous.scrollTop
        : 0,
    });
    publish(next);
  }, [home, ready, entry, switching]);

  const select = async (id: string) => {
    if (
      id === current.current.activeId ||
      !current.current.tabs.some((tab) => tab.id === id)
    )
      return;
    rememberScroll();
    await activate({ ...current.current, activeId: id });
  };
  const add = async () => {
    rememberScroll();
    await activate(addWorkspaceTab(current.current));
  };
  const open = async (entry: WorkspaceEntry, foreground = true) => {
    if (pending.current || !ready) return false;
    rememberScroll();
    const next = addWorkspaceTab(current.current, entry, foreground);
    if (foreground) return activate(next);
    publish(next);
    return true;
  };
  const close = async (id = current.current.activeId) => {
    if (pending.current || closing.current) return;
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
    }
  };
  const step = async (offset: number) => {
    rememberScroll();
    const tab = current.current.tabs.find(
      (tab) => tab.id === current.current.activeId,
    )!;
    const cursor = tab.cursor + offset;
    if (cursor < 0 || cursor >= tab.entries.length) return;
    await activate({
      ...current.current,
      tabs: current.current.tabs.map((item) =>
        item.id === tab.id ? { ...tab, cursor } : item,
      ),
    });
  };
  const active = state.tabs.find((tab) => tab.id === state.activeId)!;
  return {
    ...state,
    switching,
    select,
    add,
    open,
    close,
    step,
    rememberScroll,
    canBack: active.cursor > 0,
    canForward: active.cursor < active.entries.length - 1,
  };
}
