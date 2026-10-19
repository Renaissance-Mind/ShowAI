import { useEffect, useRef, useState } from "react";
import type { FolderMetadata, ProjectSummary } from "../core/model";
import { useTranslator } from "../i18n/react";
import studioMessages from "../i18n/messages/studio";
import commonMessages from "../i18n/messages/common";
import { Folder, Loader2, Trash2, X } from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import type { LibraryTarget } from "./LibraryNavigation";

export function useDirectoryPageSelection(scope: string, pageIds: string[]) {
  const [state, setState] = useState({
    scope,
    active: false,
    ids: [] as string[],
    anchor: "",
  });
  const visibleKey = JSON.stringify(pageIds);
  useEffect(() => {
    setState((current) => {
      if (current.scope !== scope)
        return { scope, active: false, ids: [], anchor: "" };
      const visible = new Set<string>(JSON.parse(visibleKey));
      const ids = current.ids.filter((id) => visible.has(id));
      return ids.length === current.ids.length ? current : { ...current, ids };
    });
  }, [scope, visibleKey]);
  const active = state.scope === scope && state.active;
  const ids = active ? state.ids.filter((id) => pageIds.includes(id)) : [];
  const clear = () => setState({ scope, active: false, ids: [], anchor: "" });
  return {
    active,
    ids,
    clear,
    start: () => setState({ scope, active: true, ids: [], anchor: "" }),
    selectAll: () =>
      setState({ scope, active: true, ids: [...pageIds], anchor: "" }),
    deselectAll: () => setState({ scope, active: true, ids: [], anchor: "" }),
    remove: (id: string) =>
      setState((current) => ({
        ...current,
        ids: current.ids.filter((selected) => selected !== id),
      })),
    toggle: (id: string, range = false) => {
      const anchor = active ? pageIds.indexOf(state.anchor) : -1;
      const end = pageIds.indexOf(id);
      if (end < 0) return;
      const next = new Set(ids);
      const affected =
        range && anchor >= 0
          ? pageIds.slice(Math.min(anchor, end), Math.max(anchor, end) + 1)
          : [id];
      for (const item of affected) {
        if (ids.includes(id)) next.delete(item);
        else next.add(item);
      }
      setState({ scope, active: true, ids: [...next], anchor: id });
    },
  };
}

export function DirectorySelectionBar({
  selection,
  total,
  onMove,
  onDelete,
}: {
  selection: ReturnType<typeof useDirectoryPageSelection>;
  total: number;
  onMove: () => void;
  onDelete: () => void;
}) {
  const t = useTranslator(studioMessages);
  const all = total > 0 && selection.ids.length === total;
  return (
    <div
      className="studio-page-selection"
      role="region"
      aria-label={t("pageSelectionActions")}
    >
      <label className="studio-page-select-all">
        <input
          type="checkbox"
          checked={all}
          ref={(input) => {
            if (input) input.indeterminate = selection.ids.length > 0 && !all;
          }}
          onChange={() =>
            all ? selection.deselectAll() : selection.selectAll()
          }
          aria-label={t("selectAllPages")}
        />
        {t("selectAllPages")}
      </label>
      <span className="studio-page-selection-count" role="status">
        {t("selectedPages", { count: selection.ids.length })}
      </span>
      <button
        className="studio-button"
        disabled={!selection.ids.length}
        onClick={onMove}
      >
        <Folder size={15} />
        {t("move")}
      </button>
      <button
        className="studio-button danger"
        disabled={!selection.ids.length}
        onClick={onDelete}
      >
        <Trash2 size={15} />
        {t("deletePages")}
      </button>
      <button
        className="studio-icon"
        title={t("finishPageSelection")}
        aria-label={t("finishPageSelection")}
        onClick={selection.clear}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export interface PageDestination {
  projectId: string;
  parentId: string | null;
}

export function BatchPagesDialog({
  operation,
  targets,
  projects,
  onClose,
  onApply,
}: {
  operation: "move" | "delete";
  targets: LibraryTarget[];
  projects: ProjectSummary[];
  onClose: () => void;
  onApply: (destination?: PageDestination) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [projectId, setProjectId] = useState(targets[0]?.projectId ?? "");
  const [parentId, setParentId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{
    projectId: string;
    folders: FolderMetadata[];
  }>();
  const [loadingError, setLoadingError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (operation !== "move") return;
    let current = true;
    setLoadingError("");
    setLoaded(undefined);
    void desktop.invoke<FolderMetadata[]>("folders:list", { projectId }).then(
      (folders) => {
        if (current) setLoaded({ projectId, folders });
      },
      (reason) => {
        if (current) setLoadingError(errorMessage(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [operation, projectId, loadAttempt]);
  const folders = loaded?.projectId === projectId ? loaded.folders : [];
  const path = (folder: FolderMetadata) => {
    const names = [folder.name];
    const seen = new Set([folder.id]);
    let parent = folders.find((item) => item.id === folder.parentId);
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(parent.name);
      parent = folders.find((item) => item.id === parent!.parentId);
    }
    return names.join(" / ");
  };
  const sameLocation = targets.every(
    (target) => target.projectId === projectId && target.parentId === parentId,
  );
  return (
    <Dialog
      title={t(operation === "move" ? "movePages" : "deletePages")}
      onClose={onClose}
      dismissible={!busy}
    >
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            running.current ||
            (operation === "move" &&
              (loaded?.projectId !== projectId || sameLocation))
          )
            return;
          running.current = true;
          setBusy(true);
          setError("");
          void onApply(
            operation === "move" ? { projectId, parentId } : undefined,
          )
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => {
              running.current = false;
              setBusy(false);
            });
        }}
      >
        <p className="studio-delete-description">
          {t(
            operation === "move"
              ? "movePagesDescription"
              : "deletePagesConfirm",
            { count: targets.length },
          )}
        </p>
        {operation === "move" && (
          <>
            <label>
              {t("targetProject")}
              <select
                aria-label={t("targetProject")}
                value={projectId}
                disabled={busy}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setParentId(null);
                  setError("");
                }}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("targetFolder")}
              <select
                aria-label={t("targetFolder")}
                value={parentId ?? ""}
                disabled={busy || loaded?.projectId !== projectId}
                onChange={(event) => {
                  setParentId(event.target.value || null);
                  setError("");
                }}
              >
                <option value="">
                  {loaded ? t("projectRoot") : tc("loading")}
                </option>
                {folders
                  .map((folder) => ({ folder, path: path(folder) }))
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map(({ folder, path }) => (
                    <option key={folder.id} value={folder.id}>
                      {path}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        {(error || loadingError) && (
          <p className="studio-form-error" role="alert">
            {error || loadingError}
          </p>
        )}
        {loadingError && (
          <button
            className="studio-button"
            type="button"
            onClick={() => setLoadAttempt((value) => value + 1)}
          >
            {tc("retry")}
          </button>
        )}
        <footer>
          <button
            className="studio-button"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {tc("cancel")}
          </button>
          <button
            className={`studio-button ${operation === "delete" ? "danger" : "primary"}`}
            disabled={
              busy ||
              !targets.length ||
              (operation === "move" &&
                (loaded?.projectId !== projectId || sameLocation))
            }
          >
            {busy && <Loader2 size={14} className="studio-spin" />}
            {operation === "move" ? t("move") : tc("delete")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
