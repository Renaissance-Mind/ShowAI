import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { desktop } from "./bridge";
import { PageSessions } from "./page-sessions";
import type { PageSnapshot } from "./page-session";
export type { LoadedPage, SaveStatus } from "./page-session";

const empty: PageSnapshot = {
  draft: null,
  record: null,
  renderVersion: 0,
  status: "saved",
  error: "",
  draftNotice: "",
  reviewingConflict: false,
  saveFailureAttempt: 0,
  projectId: null,
  availableDrafts: [],
  dirty: false,
  busy: false,
};

/** Studio observes metadata; each retained editor observes its own document. */
export function usePage(home?: string) {
  const sessionsRef = useRef<PageSessions | null>(null);
  if (!sessionsRef.current) {
    const clientId =
      sessionStorage.getItem("showai:editor-client") ?? crypto.randomUUID();
    sessionStorage.setItem("showai:editor-client", clientId);
    sessionsRef.current = new PageSessions({
      clientId,
      invoke: desktop.invoke,
    });
  }
  const sessions = sessionsRef.current;
  useSyncExternalStore(
    sessions.subscribe,
    sessions.getSnapshot,
    sessions.getSnapshot,
  );
  const active = sessions.getSnapshot().active;
  const state = active?.getSnapshot() ?? empty;
  useEffect(() => {
    if (home) sessions.setHome(home);
  }, [home, sessions]);
  useEffect(
    () => desktop.onChange((change) => sessions.invalidate(change)),
    [sessions],
  );
  useEffect(
    () => desktop.onBeforeClose(() => sessions.prepareClose()),
    [sessions],
  );
  useEffect(() => {
    window.showai?.setDirty?.(sessions.hasUnretainedChanges());
  });
  useEffect(() => {
    const focused = () => {
      void sessions.refresh();
    };
    const save = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s")
        return;
      event.preventDefault();
      const current = sessions.getSnapshot().active;
      if (current)
        void (current.getSnapshot().reviewingConflict
          ? current.retry()
          : current.flush());
    };
    window.addEventListener("focus", focused);
    window.addEventListener("keydown", save);
    return () => {
      window.removeEventListener("focus", focused);
      window.removeEventListener("keydown", save);
    };
  }, [sessions]);
  const mounts = useRef(0);
  useEffect(() => {
    const generation = ++mounts.current;
    return () => {
      queueMicrotask(() => {
        if (mounts.current === generation) void sessions.shutdown();
      });
    };
  }, [sessions]);
  const edit = useCallback(
    (patch: Partial<ShowDocument>) =>
      sessions.getSnapshot().active?.edit(patch),
    [sessions],
  );
  const editContent = useCallback(
    (content: JSONContent) =>
      sessions.getSnapshot().active?.editContent(content),
    [sessions],
  );
  const open = useCallback(
    (projectId: string, pageId: string, tabId?: string) =>
      sessions.open(projectId, pageId, tabId),
    [sessions],
  );
  const flush = useCallback(
    () => sessions.getSnapshot().active?.flush() ?? Promise.resolve(true),
    [sessions],
  );
  const leave = useCallback(() => sessions.leave(), [sessions]);
  const clear = useCallback(() => sessions.clear(), [sessions]);
  const reload = useCallback(
    () => sessions.getSnapshot().active?.reload() ?? Promise.resolve(),
    [sessions],
  );
  const refresh = useCallback(() => sessions.refresh(), [sessions]);
  const reloadCurrent = useCallback(
    () =>
      sessions.getSnapshot().active?.reloadCurrent() ?? Promise.resolve(false),
    [sessions],
  );
  const retry = useCallback(
    () => sessions.getSnapshot().active?.retry() ?? Promise.resolve(true),
    [sessions],
  );
  const retainDraft = useCallback(
    () => sessions.getSnapshot().active?.retainDraft() ?? Promise.resolve(),
    [sessions],
  );
  const recoverDraft = useCallback(
    (id: string) =>
      sessions.getSnapshot().active?.recoverDraft(id) ?? Promise.resolve(),
    [sessions],
  );
  const keepCopy = useCallback(
    () => sessions.getSnapshot().active?.keepCopy() ?? Promise.resolve(null),
    [sessions],
  );
  const acceptResolution = useCallback(
    () =>
      sessions.getSnapshot().active?.acceptResolution() ?? Promise.resolve(),
    [sessions],
  );
  const prepareResolution = useCallback(
    (document: ShowDocument, revision: string, hash: string) =>
      sessions
        .getSnapshot()
        .active?.prepareResolution(document, revision, hash),
    [sessions],
  );
  const prepareExternalResolution = useCallback(
    (document: ShowDocument, id: string) =>
      sessions.getSnapshot().active?.prepareExternalResolution(document, id),
    [sessions],
  );
  return {
    ...state,
    sessions,
    edit,
    editContent,
    open,
    flush,
    leave,
    clear,
    reload,
    refresh,
    reloadCurrent,
    retry,
    retainDraft,
    recoverDraft,
    keepCopy,
    acceptResolution,
    prepareResolution,
    prepareExternalResolution,
    flushAll: () => sessions.flushAll(),
    prepareClose: () => sessions.prepareClose(),
    backgroundIssues: sessions
      .getSnapshot()
      .issues.filter((issue) => issue.pageId !== state.draft?.id),
  };
}
