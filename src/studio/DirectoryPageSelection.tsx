import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FolderMetadata, ProjectSummary } from "../core/model";
import { useTranslator } from "../i18n/react";
import studioMessages from "../i18n/messages/studio";
import commonMessages from "../i18n/messages/common";
import { Folder, Loader2, Trash2, X } from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import type { LibraryTarget } from "./LibraryNavigation";
import { marqueeIds, type MarqueeBounds } from "./directory-marquee";

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
    replace: (ids: string[]) =>
      setState((current) =>
        current.scope === scope &&
        current.active &&
        current.ids.length === ids.length &&
        current.ids.every((id, index) => id === ids[index])
          ? current
          : { scope, active: true, ids, anchor: "" },
      ),
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

/** Start on empty directory space so opening and dragging entries keep their existing meaning. */
export function useDirectoryMarquee(
  selection: ReturnType<typeof useDirectoryPageSelection>,
  scope: string,
  enabled: boolean,
) {
  // Pointer motion only paints this overlay; it must not render the workbench.
  const overlayRef = useRef<HTMLDivElement>(null);
  const t = useTranslator(studioMessages);
  const label = useRef(t);
  label.current = t;
  const repaint = useRef<() => void>(() => {});
  // A navigation or toolbar render may commit while dragging; reapply the live
  // highlight without publishing transient pointer positions to Studio.
  useLayoutEffect(() => {
    repaint.current();
  });
  const latest = useRef(selection);
  latest.current = selection;
  const gesture = useRef<{
    element: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    base: string[];
    active: boolean;
    previous: string[];
    wasActive: boolean;
    entries?: (MarqueeBounds & { id: string; row: HTMLElement })[];
    ids?: string[];
  } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    let frame = 0;
    let resize: ResizeObserver | undefined;
    let changes: MutationObserver | undefined;
    const paint = () => {
      const current = gesture.current;
      if (!current?.active || !current.ids) return;
      const ids = new Set(current.ids);
      const entries =
        current.entries ??
        Array.from(
          current.element.querySelectorAll<HTMLElement>("[data-selectable]"),
          (row) => ({ id: row.dataset.libraryId!, row }),
        );
      for (const entry of entries) {
        const selected = ids.has(entry.id);
        if (entry.row.classList.contains("selected") !== selected)
          entry.row.classList.toggle("selected", selected);
        const check = entry.row.querySelector(".studio-page-checkbox");
        if (check?.getAttribute("aria-checked") !== String(selected))
          check?.setAttribute("aria-checked", String(selected));
      }
      const bar = current.element
        .closest(".studio-main")
        ?.querySelector(".studio-page-selection");
      const count = bar?.querySelector(".studio-page-selection-count");
      const text = label.current("selectedPages", { count: ids.size });
      if (count && count.textContent !== text) count.textContent = text;
      const all = bar?.querySelector<HTMLInputElement>(
        ".studio-page-select-all input",
      );
      if (all) {
        all.checked = ids.size === entries.length;
        all.indeterminate = ids.size > 0 && !all.checked;
      }
      bar
        ?.querySelectorAll<HTMLButtonElement>(".studio-button")
        .forEach((button) => {
          button.disabled = !ids.size;
        });
    };
    repaint.current = paint;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => update());
    };
    const invalidate = () => {
      if (!gesture.current?.active) return;
      gesture.current.entries = undefined;
      schedule();
    };
    const finish = (cancel = false, commit = true) => {
      const current = gesture.current;
      if (!current) return;
      if (current.active) {
        suppressClick.current = true;
        if (cancel || !commit) {
          current.ids = cancel
            ? current.wasActive
              ? current.previous
              : []
            : latest.current.ids;
          paint();
        }
        if (cancel) {
          if (current.wasActive) latest.current.replace(current.previous);
          else latest.current.clear();
        } else if (commit) latest.current.replace(current.ids ?? current.base);
      }
      gesture.current = null;
      if (current.element.hasPointerCapture(current.pointerId))
        current.element.releasePointerCapture(current.pointerId);
      cancelAnimationFrame(frame);
      frame = 0;
      resize?.disconnect();
      changes?.disconnect();
      current.element.removeEventListener("scroll", schedule);
      if (overlayRef.current) overlayRef.current.hidden = true;
    };
    const update = (final = false) => {
      frame = 0;
      const current = gesture.current;
      if (!current?.active) return;
      const { element, clientX, clientY } = current;
      const bounds = element.getBoundingClientRect();
      const scrollTop = element.scrollTop;
      const scrollLeft = element.scrollLeft;
      // Read geometry together, once per gesture or actual directory reflow.
      // Scrolling translates content coordinates without remeasuring every card.
      current.entries ??= Array.from(
        element.querySelectorAll<HTMLElement>("[data-selectable]"),
        (row) => {
          const rect = row.getBoundingClientRect();
          return {
            id: row.dataset.libraryId!,
            row,
            left: rect.left - bounds.left + scrollLeft,
            right: rect.right - bounds.left + scrollLeft,
            top: rect.top - bounds.top + scrollTop,
            bottom: rect.bottom - bounds.top + scrollTop,
          };
        },
      );
      const edge = 40;
      const speed = (position: number, start: number, end: number) =>
        position < start + edge
          ? -Math.min(18, (start + edge - position) / 3)
          : position > end - edge
            ? Math.min(18, (position - end + edge) / 3)
            : 0;
      const x = Math.max(bounds.left, Math.min(bounds.right, clientX));
      const y = Math.max(bounds.top, Math.min(bounds.bottom, clientY));
      const originX = bounds.left + current.x - scrollLeft;
      const originY = bounds.top + current.y - scrollTop;
      const left = Math.min(originX, x);
      const top = Math.min(originY, y);
      const right = Math.max(originX, x);
      const bottom = Math.max(originY, y);
      const rectangle = {
        left: Math.max(bounds.left, left),
        top: Math.max(bounds.top, top),
        width: Math.max(
          0,
          Math.min(bounds.right, right) - Math.max(bounds.left, left),
        ),
        height: Math.max(
          0,
          Math.min(bounds.bottom, bottom) - Math.max(bounds.top, top),
        ),
      };
      const ids = marqueeIds(
        current.entries,
        {
          left: left - bounds.left + scrollLeft,
          right: right - bounds.left + scrollLeft,
          top: top - bounds.top + scrollTop,
          bottom: bottom - bounds.top + scrollTop,
        },
        current.base,
      );
      current.ids = ids;
      paint();
      if (overlayRef.current) {
        const overlay = overlayRef.current;
        overlay.hidden = false;
        overlay.style.left = `${rectangle.left}px`;
        overlay.style.top = `${rectangle.top}px`;
        overlay.style.width = `${rectangle.width}px`;
        overlay.style.height = `${rectangle.height}px`;
      }
      // Keep ticking only while the pointer actually moves the scroll position.
      const delta = speed(clientY, bounds.top, bounds.bottom);
      if (delta && !final) {
        element.scrollTop = scrollTop + delta;
        if (element.scrollTop !== scrollTop) schedule();
      }
    };
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.clientX = event.clientX;
      current.clientY = event.clientY;
      if (!current.active) {
        const bounds = current.element.getBoundingClientRect();
        if (
          Math.hypot(
            event.clientX -
              bounds.left +
              current.element.scrollLeft -
              current.x,
            event.clientY - bounds.top + current.element.scrollTop - current.y,
          ) < 6
        )
          return;
        current.active = true;
        latest.current.replace(current.base);
        current.element.setPointerCapture(current.pointerId);
        resize = new ResizeObserver(invalidate);
        resize.observe(current.element);
        const list = current.element.querySelector(".studio-page-list");
        if (list) {
          resize.observe(list);
          changes = new MutationObserver(invalidate);
          changes.observe(list, { childList: true });
        }
        current.element.addEventListener("scroll", schedule, { passive: true });
      }
      schedule();
      event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== gesture.current?.pointerId) return;
      if (gesture.current.active) {
        gesture.current.clientX = event.clientX;
        gesture.current.clientY = event.clientY;
        cancelAnimationFrame(frame);
        frame = 0;
        update(true);
      } else if (!gesture.current.base.length) latest.current.clear();
      finish();
    };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        (gesture.current || latest.current.active)
      ) {
        event.preventDefault();
        finish(false, false);
        latest.current.clear();
      }
    };
    if (enabled) {
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", cancel);
      window.addEventListener("keydown", key);
      window.addEventListener("resize", invalidate);
    }
    return () => {
      finish(false, false);
      repaint.current = () => {};
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", invalidate);
    };
  }, [scope, enabled]);
  return {
    overlayRef,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      suppressClick.current = false;
      if (
        !enabled ||
        event.button !== 0 ||
        event.pointerType === "touch" ||
        (event.target as HTMLElement).closest(
          "button,input,a,textarea,select,[contenteditable=true],.studio-page-list-row",
        )
      )
        return;
      const element = event.currentTarget;
      const bounds = element.getBoundingClientRect();
      gesture.current = {
        element,
        pointerId: event.pointerId,
        x: event.clientX - bounds.left + element.scrollLeft,
        y: event.clientY - bounds.top + element.scrollTop,
        clientX: event.clientX,
        clientY: event.clientY,
        base:
          event.shiftKey || event.metaKey || event.ctrlKey
            ? latest.current.ids
            : [],
        previous: latest.current.ids,
        wasActive: latest.current.active,
        active: false,
      };
      element.focus({ preventScroll: true });
      event.preventDefault();
    },
    onClickCapture: (event: React.MouseEvent) => {
      if (suppressClick.current) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }
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
  const tc = useTranslator(commonMessages);
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
        {tc("delete")}
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
  // Folders move only within their project, and never into themselves.
  const movingFolders = new Set(
    targets
      .filter((target) => target.kind === "folder")
      .map((target) => target.id),
  );
  const insideMovingFolder = (folder: FolderMetadata) => {
    const seen = new Set<string>();
    let current: FolderMetadata | undefined = folder;
    while (current && !seen.has(current.id)) {
      if (movingFolders.has(current.id)) return true;
      seen.add(current.id);
      current = folders.find((item) => item.id === current!.parentId);
    }
    return false;
  };
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
        {movingFolders.size > 0 && (
          <p className="studio-delete-description">
            {t(operation === "move" ? "moveFoldersNote" : "deleteFoldersNote", {
              count: movingFolders.size,
            })}
          </p>
        )}
        {operation === "move" && (
          <>
            <label>
              {t("targetProject")}
              <select
                aria-label={t("targetProject")}
                value={projectId}
                disabled={busy || movingFolders.size > 0}
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
                  .filter((folder) => !insideMovingFolder(folder))
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
