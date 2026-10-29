import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  RecordPeekRequest,
  RecordPeekState,
} from "../components/page-links";
import type { PageSessions } from "./page-sessions";

export type OpenRecordRequest = RecordPeekRequest & {
  hostProjectId: string;
  hostPageId: string;
};
type OwnedRequest = OpenRecordRequest & {
  origin: string;
  returnFocus: HTMLElement | null;
};

/** Presentation state only. Documents and their recovery stay in PageSessions. */
export function useDatabaseRecordPeek({
  sessions,
  home,
  tabId,
  hostProjectId,
  hostPageId,
  visible,
  blocked,
  report,
  openFullPage,
}: {
  sessions: PageSessions;
  home?: string;
  tabId: string;
  hostProjectId: string | null;
  hostPageId?: string;
  visible: boolean;
  blocked: boolean;
  report: (error: unknown) => void;
  openFullPage: (pageId: string, projectId: string) => Promise<boolean>;
}) {
  const snapshot = useSyncExternalStore(
    sessions.subscribe,
    sessions.getSnapshot,
    sessions.getSnapshot,
  );
  const origin = JSON.stringify([home, tabId, hostProjectId, hostPageId]);
  const latest = useRef({ origin, visible, blocked, report, openFullPage });
  latest.current = { origin, visible, blocked, report, openFullPage };
  const [request, setRequest] = useState<OwnedRequest | null>(null);
  const current = useRef<OwnedRequest | null>(null);
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [propertiesHost, setPropertiesHost] = useState<HTMLElement | null>(
    null,
  );
  const view = snapshot.views.find((view) => view.key === snapshot.previewView);
  const shown = !!(request && request.origin === origin && visible && view);

  const open = useCallback(
    (input: OpenRecordRequest) => {
      const owner = latest.current;
      const active = sessions.getSnapshot().active?.getSnapshot();
      if (
        !owner.visible ||
        owner.blocked ||
        !active?.draft ||
        active.projectId !== input.hostProjectId ||
        active.draft.id !== input.hostPageId
      )
        return;
      const ticket = ++sequence.current;
      const previous = current.current;
      const next: OwnedRequest = {
        ...input,
        records: input.records.slice(0, 10000),
        origin: owner.origin,
        returnFocus:
          previous?.origin === owner.origin
            ? previous.returnFocus
            : document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null,
      };
      current.current = next;
      setBusy(true);
      void sessions
        .openPreview(input.projectId, input.pageId)
        .then((opened) => {
          if (
            ticket !== sequence.current ||
            latest.current.origin !== next.origin
          )
            return;
          if (opened) setRequest(next);
          else current.current = previous;
        })
        .catch((error: unknown) => {
          if (ticket === sequence.current) current.current = previous;
          latest.current.report(error);
        })
        .finally(() => {
          if (ticket === sequence.current) setBusy(false);
        });
    },
    [sessions],
  );

  const close = useCallback(async () => {
    const ticket = ++sequence.current;
    const previous = current.current;
    setBusy(true);
    try {
      if (!(await sessions.closePreview()) || ticket !== sequence.current)
        return false;
      current.current = null;
      setRequest(null);
      requestAnimationFrame(() => {
        if (previous?.returnFocus?.isConnected)
          previous.returnFocus.focus({ preventScroll: true });
      });
      return true;
    } finally {
      if (ticket === sequence.current) setBusy(false);
    }
  }, [sessions]);
  const step = useCallback(
    (offset: number) => {
      const source = current.current;
      if (!source) return;
      const index = source.records.findIndex(
        (record) =>
          record.projectId === source.projectId &&
          record.pageId === source.pageId &&
          record.recordId === source.recordId,
      );
      const target = source.records[index + offset];
      if (index >= 0 && target) open({ ...source, ...target });
    },
    [open],
  );
  const closeSource = useCallback(
    (sourceId: string) => {
      if (current.current?.sourceId !== sourceId) return;
      void close().catch((error: unknown) => latest.current.report(error));
    },
    [close],
  );
  const expand = useCallback(async () => {
    const source = current.current;
    if (!source || latest.current.blocked) return;
    if (await latest.current.openFullPage(source.pageId, source.projectId)) {
      sequence.current++;
      current.current = null;
      setRequest(null);
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!current.current || (current.current.origin === origin && visible))
      return;
    sequence.current++;
    current.current = null;
    setRequest(null);
    setBusy(false);
    void sessions
      .closePreview()
      .catch((error: unknown) => latest.current.report(error));
  }, [origin, visible, sessions]);
  useEffect(
    () => () => {
      sequence.current++;
      current.current = null;
      void sessions
        .closePreview()
        .catch((error: unknown) => latest.current.report(error));
    },
    [sessions],
  );
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        latest.current.blocked
      )
        return;
      if (
        document.querySelector(
          '[role="dialog"], [role="menu"], .studio-context-menu',
        )
      )
        return;
      event.preventDefault();
      void close().catch((error: unknown) => latest.current.report(error));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shown, close]);
  const state = useMemo<RecordPeekState | undefined>(
    () =>
      shown && request
        ? {
            sourceId: request.sourceId,
            projectId: request.projectId,
            pageId: request.pageId,
            ...(request.recordId ? { recordId: request.recordId } : {}),
            propertiesHost,
          }
        : undefined,
    [shown, request, propertiesHost],
  );
  const index =
    request?.records.findIndex(
      (record) =>
        record.projectId === request.projectId &&
        record.pageId === request.pageId &&
        record.recordId === request.recordId,
    ) ?? -1;
  return {
    open,
    close,
    closeSource,
    step,
    expand,
    view: shown ? view : undefined,
    state,
    busy,
    request: shown ? request : null,
    index,
    count: request?.records.length ?? 0,
    setPropertiesHost,
  };
}
