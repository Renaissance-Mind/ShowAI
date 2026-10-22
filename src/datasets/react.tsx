import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { desktop, errorMessage } from "../studio/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/datasets";
import { Database } from "../ui/icons";
import {
  BlockActionHost,
  BlockActions,
  BlockItemSources,
  type BlockItemSource,
} from "../components/blocks/action-host";
import type { BlockProps } from "../components/blocks/types";
import { BindingBasisContext } from "./basis";
import {
  compileBinding,
  componentProps,
  readBinding,
  resolveBinding,
  splitBindingChange,
  withComponentProps,
  type BindingRejection,
  type CompiledBinding,
} from "./binding.mjs";
import {
  formatPath,
  isPlainObject,
  valueAt,
  type DataPath,
} from "./operations.mjs";
import { canonicalJson } from "../core/canonical";
import {
  DatasetClient,
  type DatasetSession,
  type DatasetSnapshot,
} from "./client";
import { DatasetDialog, type DatasetDialogRequest } from "./DatasetDialog";
import { BoundWidgetHost } from "./widget-host";
import "./datasets.css";

let shared: DatasetClient | undefined;
/** The window's dataset client, connected to the host and its change events. */
export function workbenchDatasetClient(): DatasetClient | undefined {
  if (typeof window === "undefined" || !window.showai) return undefined;
  if (!shared) {
    let clientId = sessionStorage.getItem("showai:editor-client");
    if (!clientId) {
      clientId = crypto.randomUUID();
      sessionStorage.setItem("showai:editor-client", clientId);
    }
    const client = new DatasetClient(
      { invoke: (action, args) => desktop.invoke(action, args) },
      clientId,
    );
    desktop.onChange((change) => client.invalidate(change));
    desktop.onBeforeClose(() => client.prepareClose());
    desktop.onBeforeReload(() => client.prepareClose());
    window.addEventListener("focus", () => client.refreshAll());
    shared = client;
  }
  return shared;
}

export interface DatasetScopeValue {
  client: DatasetClient;
  projectId: string;
  pageId?: string;
  readOnly: boolean;
  openDialog: (request: DatasetDialogRequest) => void;
}
const ScopeContext = createContext<DatasetScopeValue | null>(null);
export const useDatasetScope = () => useContext(ScopeContext);

/** Event a block menu sends to open the shared data dialog for its component. */
export const SHARED_DATA_EVENT = "showai:shared-data";

/** Page-level provider: bound blocks of this page read their datasets through it. */
export function DatasetScope({
  projectId,
  pageId,
  readOnly,
  children,
}: {
  projectId: string | null | undefined;
  pageId?: string;
  readOnly: boolean;
  children: ReactNode;
}) {
  const client = workbenchDatasetClient();
  const [dialog, setDialog] = useState<DatasetDialogRequest | null>(null);
  const value = useMemo<DatasetScopeValue | null>(
    () =>
      client && projectId
        ? { client, projectId, pageId, readOnly, openDialog: setDialog }
        : null,
    [client, projectId, pageId, readOnly],
  );
  useEffect(() => {
    if (!value || readOnly) return;
    // The block menu of page flow lives in the packaged editor and asks through an
    // event. Only the visible page is connected: hidden pages disconnect effects.
    const open = (event: Event) => {
      const detail = (event as CustomEvent<DatasetDialogRequest | null>).detail;
      event.preventDefault();
      if (detail) setDialog(detail);
    };
    window.addEventListener(SHARED_DATA_EVENT, open);
    return () => window.removeEventListener(SHARED_DATA_EVENT, open);
  }, [value, readOnly]);
  return (
    <ScopeContext.Provider value={value}>
      <BoundWidgetHost.Provider value={host}>{children}</BoundWidgetHost.Provider>
      {dialog &&
        value &&
        createPortal(
          <DatasetDialog
            request={dialog}
            scope={value}
            onClose={() => setDialog(null)}
          />,
          document.body,
        )}
    </ScopeContext.Provider>
  );
}

const idle = () => () => {};
function useDatasetSession(
  client: DatasetClient | undefined,
  projectId: string | undefined,
  datasetId: string | undefined,
): DatasetSession | undefined {
  const session = useMemo(
    () =>
      client && projectId && datasetId
        ? client.session(projectId, datasetId)
        : undefined,
    [client, projectId, datasetId],
  );
  useEffect(
    () => (session && client ? client.retain(session) : undefined),
    [client, session],
  );
  return session;
}
export function useDatasetSnapshot(
  session: DatasetSession | undefined,
): DatasetSnapshot | undefined {
  return useSyncExternalStore(
    session?.subscribe ?? idle,
    () => session?.getSnapshot(),
    () => session?.getSnapshot(),
  );
}

/** A short readable label for a field path: the nearest record's title and the field. */
export function describePath(value: unknown, path: DataPath): string {
  for (let end = path.length; end > 0; end--) {
    const record = valueAt(value, path.slice(0, end));
    if (isPlainObject(record) && end < path.length) {
      const name = record.title ?? record.name ?? record.label ?? record.id;
      if (typeof name === "string" || typeof name === "number")
        return `${name} · ${formatPath(path.slice(end))}`;
    }
  }
  return formatPath(path);
}
function shown(value: unknown, absent: string) {
  if (value === undefined) return absent;
  return typeof value === "string" ? value : JSON.stringify(value);
}

interface Basis {
  props: Record<string, unknown>;
  value: unknown;
  key?: string;
}

/**
 * Renders a block whose props come from a dataset. The component receives
 * ordinary props and onChange; changes are split into dataset writes and
 * the block's own values.
 */
export function BoundWidget({
  kind,
  data,
  onChange,
  readOnly,
  host,
  render,
}: BlockProps & {
  kind: string;
  render: (props: BlockProps & { kind: string }) => ReactNode;
}) {
  const t = useTranslator(messages);
  const scope = useDatasetScope();
  let compiled: CompiledBinding | undefined;
  let invalid = "";
  try {
    compiled = compileBinding(readBinding(data));
  } catch (error) {
    invalid = errorMessage(error);
  }
  const projectId = compiled?.project ?? scope?.projectId;
  const session = useDatasetSession(
    scope?.client,
    projectId,
    compiled?.dataset,
  );
  const snapshot = useDatasetSnapshot(session);
  const [nonce, setNonce] = useState(0);
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const ready = snapshot?.status === "ready";
  const resolved = useMemo(() => {
    if (!compiled || !ready) return undefined;
    try {
      return resolveBinding(kind, data, snapshot!.value, compiled);
    } catch (error) {
      return { error: errorMessage(error) };
    }
    // `compiled` derives from data; nonce re-sends props a component changed locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, data, snapshot?.value, ready, nonce]);
  const resolvedProps =
    resolved && "props" in resolved ? resolved.props : undefined;
  const rendered = useMemo(
    () =>
      resolvedProps
        ? withComponentProps(kind, data, resolvedProps, null)
        : undefined,
    [kind, data, resolvedProps],
  );
  // Recent props and the dataset values they came from: the basis of later changes.
  const bases = useRef<Basis[]>([]);
  useEffect(() => {
    if (!resolvedProps || bases.current.at(-1)?.props === resolvedProps) return;
    bases.current = [
      ...bases.current,
      { props: resolvedProps, value: snapshot!.value },
    ].slice(-16);
  }, [resolvedProps, snapshot]);
  const reported = useRef<Record<string, unknown> | undefined>(undefined);
  const reportBasis = useCallback((props: Record<string, unknown>) => {
    reported.current = props;
  }, []);
  const latest = useRef({ data, onChange, resolvedProps, snapshot });
  latest.current = { data, onChange, resolvedProps, snapshot };
  const rejection = useCallback(
    (item: BindingRejection) =>
      item.reason === "derived"
        ? t("rejectedDerived", { field: item.field ?? "" })
        : item.reason === "removed"
          ? t("rejectedRemoved")
          : item.reason === "read-only"
            ? t("rejectedReadOnly")
            : item.reason === "unmapped"
              ? t("rejectedUnmapped", {
                  field: item.field ?? "",
                  value: JSON.stringify(item.value),
                })
              : t("rejectedGeneric"),
    [t],
  );
  const change = useCallback(
    (nextData: Record<string, unknown>) => {
      const current = latest.current;
      if (!session || !current.resolvedProps || !current.snapshot) return;
      const nextProps = componentProps(kind, nextData);
      // A sandboxed component names the props it changed; others changed the latest render.
      const claimed = reported.current;
      reported.current = undefined;
      let basis: Basis | undefined = bases.current.at(-1);
      if (claimed) {
        const key = canonicalJson(claimed);
        basis =
          bases.current.find(
            (entry) => (entry.key ??= canonicalJson(entry.props)) === key,
          ) ??
          // Unknown basis: the oldest retained one never overwrites a newer change.
          bases.current[0];
      }
      if (!basis)
        basis = { props: current.resolvedProps, value: current.snapshot.value };
      let split;
      try {
        split = splitBindingChange({
          kind,
          data: current.data,
          value: session.getSnapshot().value,
          nextProps,
          basis,
        });
      } catch (error) {
        setNotice(errorMessage(error));
        setNonce((value) => value + 1);
        return;
      }
      if (split.operations.length) {
        session.edit(split.operations);
        bases.current = [
          ...bases.current,
          { props: nextProps, value: session.getSnapshot().value },
        ].slice(-16);
      }
      if (split.data !== current.data) current.onChange?.(split.data);
      if (split.rejected.length) {
        setNotice(rejection(split.rejected[0]));
        setNonce((value) => value + 1);
      } else setNotice("");
    },
    [session, kind, rejection],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  // Undo inside the block reverts this window's last shared data change.
  useEffect(() => {
    const root = wrapper.current;
    if (!root || !session || readOnly) return;
    const key = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.isComposing
      )
        return;
      const name = event.key.toLowerCase();
      if (name !== "z" && name !== "y") return;
      if (!(event.target instanceof Node) || !root.contains(event.target))
        return;
      const redo = event.shiftKey || name === "y";
      if (redo ? session.redo() : session.undo()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [session, readOnly]);
  const sources = useMemo(() => {
    if (!resolved || !("projected" in resolved)) return null;
    const map = new Map<string, BlockItemSource>();
    for (const [id, item] of resolved.projected)
      map.set(id, {
        label: item.label ?? snapshot?.name,
        readOnly: item.readOnly,
        removable: false,
      });
    return map;
  }, [resolved, snapshot?.name]);

  const locked =
    !!readOnly || !onChange || !!snapshot?.readOnly || !!scope?.readOnly;
  const openSettings =
    scope && !scope.readOnly && onChange
      ? () => scope.openDialog({ kind, data, apply: onChange })
      : undefined;
  const label = (
    <span className="dataset-source-name">
      <Database size={13} aria-hidden="true" />
      {t("sourceLabel", { name: snapshot?.name ?? compiled?.dataset ?? "" })}
    </span>
  );
  let body: ReactNode;
  if (invalid)
    body = (
      <p className="dataset-message" role="alert">
        {t("invalidBinding", { error: invalid })}
      </p>
    );
  else if (!scope || !session)
    body = (
      <p className="dataset-message">
        {t("unavailableHere", { id: compiled?.dataset ?? "" })}
      </p>
    );
  else if (!snapshot || snapshot.status === "loading")
    body = (
      <p className="dataset-message" role="status">
        {t("loading")}
      </p>
    );
  else if (snapshot.errorCode === "SOURCE_UNAVAILABLE")
    body = (
      <div className="dataset-message" role="alert">
        <p>
          {snapshot.source?.path
            ? t("sourceUnreadable", {
                name: snapshot.name ?? compiled?.dataset ?? "",
                path: snapshot.source.path,
              })
            : t("sourceUnlinked", {
                name: snapshot.name ?? compiled?.dataset ?? "",
                file: snapshot.source?.name ?? "",
              })}
        </p>
        {openSettings && (
          <button type="button" onClick={openSettings}>
            {t("linkSourceAction")}
          </button>
        )}
      </div>
    );
  else if (snapshot.status === "missing" || snapshot.status === "error")
    body = (
      <p className="dataset-message" role="alert">
        {snapshot.status === "missing"
          ? t("missing", { id: compiled?.dataset ?? "" })
          : snapshot.error}
      </p>
    );
  else if (resolved && "error" in resolved)
    body = (
      <p className="dataset-message" role="alert">
        {t("invalidBinding", { error: resolved.error })}
      </p>
    );
  else if (rendered)
    body = (
      <BlockItemSources.Provider value={sources}>
        <BindingBasisContext.Provider value={reportBasis}>
          {render({
            kind,
            data: rendered,
            onChange: locked ? undefined : change,
            readOnly: locked,
            host,
          })}
        </BindingBasisContext.Provider>
      </BlockItemSources.Provider>
    );
  const conflicts = snapshot?.conflicts ?? [];
  const issues = resolved && "issues" in resolved ? resolved.issues : [];
  return (
    <div
      className="dataset-bound"
      ref={wrapper}
      data-dataset-id={compiled?.dataset}
    >
      <div className="dataset-source" role="group" aria-label={t("shared")}>
        {openSettings ? (
          <button
            type="button"
            className="dataset-source-button"
            onClick={openSettings}
            title={t("openSettings")}
          >
            {label}
          </button>
        ) : (
          label
        )}
        {snapshot?.saving ? (
          <span className="dataset-state">{t("saving")}</span>
        ) : snapshot?.dirty && !snapshot.error ? (
          <span className="dataset-state">{t("unsaved")}</span>
        ) : null}
        {snapshot?.readOnly && (
          <span className="dataset-state">{t("readOnly")}</span>
        )}
        {issues.length > 0 && (
          <span
            className="dataset-state"
            title={issues.map((issue) => issue.message).join("\n")}
          >
            {t("issueCount", { count: issues.length })}
          </span>
        )}
        {conflicts.length > 0 && (
          <button
            type="button"
            className="dataset-conflict-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {t("conflicts", { count: conflicts.length })}
          </button>
        )}
      </div>
      {snapshot?.error && snapshot.status === "ready" && (
        <p className="dataset-message" role="alert">
          {t("saveFailed", { error: snapshot.error })}
        </p>
      )}
      {notice && (
        <p className="dataset-message" role="alert">
          {notice}
        </p>
      )}
      {conflicts.length > 0 &&
        (expanded || conflicts.length <= 3) &&
        session && (
          <div className="dataset-conflicts" role="alert">
            <p>{t("conflictHint")}</p>
            {conflicts.map((conflict) => (
              <div key={conflict.id} className="dataset-conflict">
                <strong>{describePath(snapshot?.value, conflict.path)}</strong>
                <span>
                  {t("mineValue", { value: shown(conflict.mine, t("absent")) })}
                </span>
                <span>
                  {t("theirsValue", {
                    value: shown(conflict.theirs, t("absent")),
                  })}
                </span>
                {!locked && (
                  <span className="dataset-conflict-actions">
                    <button
                      type="button"
                      onClick={() => session.resolve(conflict.id, "mine")}
                    >
                      {t("keepMine")}
                    </button>
                    <button
                      type="button"
                      onClick={() => session.resolve(conflict.id, "theirs")}
                    >
                      {t("keepTheirs")}
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      {snapshot?.recovered.map((draft) => (
        <div key={draft.clientId} className="dataset-conflicts" role="status">
          <p>
            {t("recovered", { time: new Date(draft.savedAt).toLocaleString() })}
          </p>
          {!locked && session && (
            <span className="dataset-conflict-actions">
              <button
                type="button"
                onClick={() => void session.recover(draft.clientId, "restore")}
              >
                {t("restore")}
              </button>
              <button
                type="button"
                onClick={() => void session.recover(draft.clientId, "discard")}
              >
                {t("discard")}
              </button>
            </span>
          )}
        </div>
      ))}
      {body}
    </div>
  );
}

/** Kinds that are page content rather than component data. */
const contentKinds = new Set(["text", "divider"]);

/**
 * The shared data command in a Board object's selection actions. Page-flow
 * blocks reach the same dialog from their block menu.
 */
export function SharedDataAction({
  kind,
  data,
  onChange,
  readOnly,
}: BlockProps & { kind: string }) {
  const host = useContext(BlockActionHost);
  const scope = useDatasetScope();
  const t = useTranslator(messages);
  if (
    !host ||
    !scope ||
    scope.readOnly ||
    readOnly ||
    !onChange ||
    contentKinds.has(kind)
  )
    return null;
  return (
    <BlockActions>
      <button
        type="button"
        className="sb-icon-button dataset-action"
        title={t("menuItem")}
        aria-label={t("menuItem")}
        onClick={() => scope.openDialog({ kind, data, apply: onChange })}
      >
        <Database size={15} />
      </button>
    </BlockActions>
  );
}

/** Whether a page block of this kind can open the shared data dialog. */
export function sharesData(kind: string) {
  return !contentKinds.has(kind);
}

const host = { Bound: BoundWidget, Action: SharedDataAction };
