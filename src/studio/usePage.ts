import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { desktop } from "./bridge";
import { PageSessions } from "./page-sessions";
import type { PageSnapshot, SaveStatus } from "./page-session";
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

/** Routine save progress is shown by SaveState and does not re-render Studio. */
const routineStatus = new Set<SaveStatus>([
  "saved",
  "saving",
  "changed",
  "retained",
]);
type StudioView = {
  workspace: ReturnType<PageSessions["getSnapshot"]>;
  state: PageSnapshot;
};
function sameStudioView(previous: StudioView, next: StudioView) {
  const a = previous.workspace;
  const b = next.workspace;
  if (
    a.active !== b.active ||
    a.activeView !== b.activeView ||
    a.views !== b.views ||
    a.issues.length !== b.issues.length ||
    a.issues.some(
      (issue, index) =>
        issue.pageId !== b.issues[index].pageId ||
        issue.projectId !== b.issues[index].projectId ||
        issue.title !== b.issues[index].title ||
        issue.error !== b.issues[index].error,
    )
  )
    return false;
  const x = previous.state;
  const y = next.state;
  return (
    (x.status === y.status ||
      (routineStatus.has(x.status) && routineStatus.has(y.status))) &&
    x.draft?.id === y.draft?.id &&
    x.draft?.title === y.draft?.title &&
    x.draft?.icon === y.draft?.icon &&
    x.draft?.parentId === y.draft?.parentId &&
    x.draft?.favorite === y.draft?.favorite &&
    x.record === y.record &&
    x.error === y.error &&
    x.renderVersion === y.renderVersion &&
    x.draftNotice === y.draftNotice &&
    x.conflictId === y.conflictId &&
    x.mergeBase === y.mergeBase &&
    x.reviewingConflict === y.reviewingConflict &&
    x.saveFailureAttempt === y.saveFailureAttempt &&
    x.projectId === y.projectId &&
    x.availableDrafts === y.availableDrafts
  );
}

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
  const view = useRef<StudioView | null>(null);
  const readView = useCallback(() => {
    const workspace = sessions.getSnapshot();
    const next = {
      workspace,
      state: workspace.active?.getSnapshot() ?? empty,
    };
    if (!view.current || !sameStudioView(view.current, next))
      view.current = next;
    return view.current;
  }, [sessions]);
  useSyncExternalStore(sessions.subscribe, readView, readView);
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
    const report = () =>
      window.showai?.setDirty?.(sessions.hasUnretainedChanges());
    report();
    return sessions.subscribe(report);
  }, [sessions]);
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
  const live = () => sessions.getSnapshot().active?.getSnapshot() ?? empty;
  return {
    ...state,
    // Studio may skip routine save renders, so handlers read the latest edit.
    get draft() {
      return live().draft;
    },
    get status() {
      return live().status;
    },
    get dirty() {
      return live().dirty;
    },
    get busy() {
      return live().busy;
    },
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
