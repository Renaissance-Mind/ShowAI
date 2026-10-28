import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PageSummary, ProjectSummary } from "../core/model";
import {
  validateProjectDatabaseData,
  type ProjectDatabaseView,
} from "../core/project-database";
import type { ColumnType, DatabaseColumn } from "../components/blocks/types";
import { safeUrl } from "../components/blocks/helpers";
import PageIcon from "../components/PageIcon";
import { workbenchDatasetClient, useDatasetSnapshot } from "../datasets/react";
import {
  applyOperations,
  type DatasetOperation,
} from "../datasets/operations.mjs";
import { useLocale, useTranslator } from "../i18n/react";
import messages from "../i18n/messages/projectDatabase";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Columns3,
  Database,
  ExternalLink,
  Filter,
  GripVertical,
  LayoutDashboard,
  LayoutList,
  Pencil,
  Plus,
  Redo2,
  Search,
  Table2,
  Trash2,
  Undo2,
  X,
} from "../ui/icons";
import { errorMessage } from "./bridge";
import Dialog from "./Dialog";
import AddDatabaseProperty from "./AddDatabaseProperty";
import DatabaseIntroduction from "./DatabaseIntroduction";
import { usePropertyReorder } from "./usePropertyReorder";
import { useDatabaseViewMotion } from "./useDatabaseViewMotion";
import { useDatabaseColumnResize } from "./useDatabaseColumnResize";
import {
  TITLE_PROPERTY,
  databaseCellOperations,
  databaseColumnWidth,
  databaseColumnWidthOperations,
  databaseAddViewOperations,
  databaseBoardGroups,
  databaseDeleteViewOperations,
  databaseMoveColumnOperations,
  databaseRemoveColumnOperations,
  databaseTypeOperations,
  databaseViewRows,
  databaseViews,
  databaseViewSelectionKey,
  databaseViewSettingOperations,
  type DatabaseValue,
  type DatabaseViewFilter,
  type DatabaseViewSort,
} from "./project-database-view";
import "./database-project.css";

export interface DatabaseProjectProps {
  libraryHome?: string;
  project: ProjectSummary;
  pages: PageSummary[];
  readOnly: boolean;
  interactionBusy?: boolean;
  query?: string;
  onOpen: (pageId: string) => void;
  onCreate: () => Promise<void>;
  onRemove: (pageId: string) => Promise<void>;
  onRename?: (pageId: string, title: string) => Promise<void>;
  activePageId?: string;
  onVisiblePagesChange?: (ids: string[]) => void;
}

const TYPES: ColumnType[] = [
  "text",
  "number",
  "select",
  "date",
  "checkbox",
  "url",
];
const TYPE_SYMBOL: Record<ColumnType, string> = {
  text: "Aa",
  number: "#",
  select: "◉",
  date: "◫",
  checkbox: "☑",
  url: "↗",
};
const display = (value: unknown) => (value === undefined ? "" : String(value));
const introductionText = (node: unknown): string => {
  if (!node || typeof node !== "object") return "";
  const value = node as { text?: unknown; content?: unknown[] };
  return typeof value.text === "string"
    ? value.text
    : Array.isArray(value.content)
      ? value.content.map(introductionText).filter(Boolean).join(" ")
      : "";
};
const viewIcon = (type: ProjectDatabaseView["type"]) =>
  type === "board" ? (
    <LayoutDashboard size={15} />
  ) : type === "list" ? (
    <LayoutList size={15} />
  ) : (
    <Table2 size={15} />
  );

/** Keep focused text local; a refresh cannot replace someone's in-progress input. */
function DraftInput({
  value,
  label,
  disabled,
  type = "text",
  placeholder = "—",
  maxLength,
  onCommit,
  onBegin,
}: {
  value: DatabaseValue | undefined;
  label: string;
  disabled: boolean;
  type?: "text" | "number" | "url";
  placeholder?: string;
  maxLength?: number;
  onCommit: (value: string, before: DatabaseValue | undefined) => void;
  onBegin?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const basis = useRef(value);
  const cancelled = useRef(false);
  return (
    <input
      aria-label={label}
      type={type}
      className="project-db-input"
      value={draft ?? display(value)}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
      step={type === "number" ? "any" : undefined}
      onFocus={() => {
        basis.current = value;
        cancelled.current = false;
        setDraft(display(value));
        onBegin?.();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        const next = event.target.value;
        if (!disabled && !cancelled.current && next !== display(basis.current))
          onCommit(next, basis.current);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function PropertyOptions({
  column,
  disabled,
  onCommit,
}: {
  column: DatabaseColumn;
  disabled: boolean;
  onCommit: (options: string[], before: string[] | undefined) => void;
}) {
  const t = useTranslator(messages);
  const basis = useRef(column.options);
  return (
    <DraftInput
      value={column.options?.join("，") ?? ""}
      label={`${column.name} · ${t("propertyOptions")}`}
      disabled={disabled}
      placeholder={t("optionsPlaceholder")}
      onBegin={() => {
        basis.current = column.options;
      }}
      onCommit={(value) =>
        onCommit(
          Array.from(
            new Set(
              value
                .split(/[,，\n]/)
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ),
          basis.current,
        )
      }
    />
  );
}

export function DatabasePropertyCell({
  value,
  column,
  label,
  locked,
  update,
}: {
  value: DatabaseValue | undefined;
  column: DatabaseColumn;
  label: string;
  locked: boolean;
  update: (value: DatabaseValue, before: DatabaseValue | undefined) => void;
}) {
  const t = useTranslator(messages);
  if (column.type === "checkbox")
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        disabled={locked}
        onChange={(event) => update(event.target.checked, value)}
      />
    );
  if (column.type === "select")
    return (
      <select
        className={`project-db-select project-db-tag-${Math.max(0, column.options?.indexOf(display(value)) ?? 0) % 5}`}
        aria-label={label}
        value={display(value)}
        disabled={locked}
        onChange={(event) => update(event.target.value, value)}
      >
        <option value="">{t("emptyValue")}</option>
        {column.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {value && !column.options?.includes(display(value)) && (
          <option value={display(value)}>{display(value)}</option>
        )}
      </select>
    );
  if (column.type === "date")
    return (
      <input
        type="date"
        className="project-db-input"
        aria-label={label}
        value={display(value)}
        disabled={locked}
        onChange={(event) => update(event.target.value, value)}
        onBlur={(event) => {
          if (!locked && event.currentTarget.value !== display(value))
            update(event.currentTarget.value, value);
        }}
      />
    );
  const href = column.type === "url" ? safeUrl(value) : undefined;
  return (
    <div className="project-db-cell-input">
      <DraftInput
        value={value}
        label={label}
        disabled={locked}
        type={
          column.type === "number" || column.type === "url"
            ? column.type
            : "text"
        }
        placeholder={column.type === "url" ? "https://…" : "—"}
        onCommit={(next, before) =>
          update(
            column.type === "number" && next !== "" ? Number(next) : next,
            before,
          )
        }
      />
      {href && (
        <a
          className="project-db-icon-button"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={t("openLink")}
          aria-label={t("openLink")}
        >
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}

function DocumentName({
  page,
  active,
  locked,
  interactionBusy = false,
  onOpen,
  onRename,
  onError,
}: {
  page: PageSummary;
  active: boolean;
  locked: boolean;
  interactionBusy?: boolean;
  onOpen: (id: string) => void;
  onRename?: (id: string, title: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslator(messages);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (name !== null)
    return (
      <form
        className="project-db-rename"
        onSubmit={(event) => {
          event.preventDefault();
          if (locked || interactionBusy || saving || !onRename) return;
          if (!name.trim()) {
            onError(t("renameEmpty"));
            return;
          }
          setSaving(true);
          void onRename(page.id, name.trim())
            .then(() => setName(null))
            .catch((error) => onError(errorMessage(error)))
            .finally(() => setSaving(false));
        }}
      >
        <input
          autoFocus
          aria-label={t("renameLabel")}
          value={name}
          disabled={saving || locked || interactionBusy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              setName(null);
            }
          }}
        />
        <button
          type="submit"
          className="project-db-icon-button"
          aria-label={t("save")}
          disabled={saving || locked || interactionBusy}
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          className="project-db-icon-button"
          aria-label={t("cancel")}
          disabled={saving || interactionBusy}
          onClick={() => setName(null)}
        >
          <X size={14} />
        </button>
      </form>
    );
  return (
    <div className="project-db-document">
      <button
        type="button"
        className="project-db-open"
        disabled={interactionBusy}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          if (!interactionBusy) onOpen(page.id);
        }}
      >
        <PageIcon value={page.icon} size={16} />
        <span>{page.title || t("untitled")}</span>
      </button>
      {!locked && onRename && (
        <button
          type="button"
          className="project-db-icon-button project-db-rename-button"
          title={t("rename", { name: page.title })}
          aria-label={t("rename", { name: page.title })}
          disabled={interactionBusy}
          onClick={() => setName(page.title)}
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}

function PropertySummary({
  columns,
  properties,
}: {
  columns: DatabaseColumn[];
  properties: Record<string, unknown>;
}) {
  const t = useTranslator(messages);
  return (
    <div className="project-db-property-summary">
      {columns.slice(0, 3).map((column) => {
        const value = properties[column.id];
        if (value === undefined || value === "") return null;
        return (
          <span
            key={column.id}
            title={`${column.name} · ${display(value)}`}
            className={
              column.type === "select"
                ? `project-db-summary-tag project-db-tag-${Math.max(0, column.options?.indexOf(display(value)) ?? 0) % 5}`
                : undefined
            }
          >
            {column.type === "checkbox"
              ? t(value === true ? "checked" : "unchecked")
              : display(value)}
          </span>
        );
      })}
    </div>
  );
}

export default function DatabaseProject(props: DatabaseProjectProps) {
  return (
    <DatabaseProjectView
      key={`${props.libraryHome ?? ""}/${props.project.id}/${props.project.database?.datasetId ?? ""}`}
      {...props}
    />
  );
}

function DatabaseProjectView({
  libraryHome,
  project,
  pages,
  readOnly,
  interactionBusy = false,
  query = "",
  onOpen,
  onCreate,
  onRemove,
  onRename,
  activePageId,
  onVisiblePagesChange,
}: DatabaseProjectProps) {
  const t = useTranslator(messages);
  const locale = useLocale();
  const client = workbenchDatasetClient();
  const datasetId = project.database?.datasetId;
  const session = useMemo(
    () =>
      client && datasetId ? client.session(project.id, datasetId) : undefined,
    [client, project.id, datasetId],
  );
  useEffect(
    () => (session && client ? client.retain(session) : undefined),
    [client, session],
  );
  const snapshot = useDatasetSnapshot(session);
  const viewPanelId = useId();
  const selectionKey = databaseViewSelectionKey(
    libraryHome ?? `session:${client?.clientId ?? ""}`,
    project.id,
    datasetId ?? "",
  );
  const [selectedViewId, setSelectedViewId] = useState(() => {
    try {
      return localStorage.getItem(selectionKey) ?? "";
    } catch {
      return "";
    }
  });
  const [localQuery, setLocalQuery] = useState("");
  const [viewPreview, setViewPreview] = useState<
    Record<string, Partial<ProjectDatabaseView>>
  >({});
  const [showFilter, setShowFilter] = useState(false);
  const [showProperties, setShowProperties] = useState(false);
  const [notice, setNotice] = useState("");
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || interactionBusy;
  const [viewDialog, setViewDialog] = useState<{
    mode: "create" | "rename" | "delete";
    view?: ProjectDatabaseView;
  } | null>(null);
  const [viewName, setViewName] = useState("");
  const [viewType, setViewType] =
    useState<ProjectDatabaseView["type"]>("table");
  const [viewError, setViewError] = useState("");
  const parsed = useMemo(() => {
    if (snapshot?.status !== "ready") return null;
    try {
      return { data: validateProjectDatabaseData(snapshot.value) };
    } catch {
      return { error: t("invalid") };
    }
  }, [snapshot?.value, snapshot?.status, t]);
  const data = parsed && "data" in parsed ? parsed.data : undefined;
  const locked =
    readOnly || !!snapshot?.readOnly || snapshot?.status !== "ready" || !data;
  const columns = data?.columns ?? [];
  const views = useMemo(
    () => databaseViews(data ?? { columns: [], rows: [] }),
    [data?.views],
  );
  const savedView =
    views.find((view) => view.id === selectedViewId) ?? views[0];
  const activeView = {
    ...savedView,
    ...(readOnly || snapshot?.readOnly ? viewPreview[savedView.id] : {}),
  };
  const viewMotion = useDatabaseViewMotion(activeView.id, !!data);
  const selectView = (id: string) => {
    if (id !== activeView.id) viewMotion.capture();
    setSelectedViewId(id);
  };
  const filter: DatabaseViewFilter = activeView.filter ?? {
    column: "",
    value: "",
  };
  const sort: DatabaseViewSort | null = activeView.sort ?? null;
  useEffect(() => {
    if (!data) return;
    if (selectedViewId !== activeView.id) setSelectedViewId(activeView.id);
    try {
      localStorage.setItem(selectionKey, activeView.id);
    } catch {
      /* A private window can still switch views. */
    }
  }, [selectionKey, activeView.id, selectedViewId, !!data]);
  const filterColumn = columns.find((column) => column.id === filter.column);
  const activeFilter =
    filter.column === TITLE_PROPERTY || filterColumn
      ? {
          ...filter,
          value:
            filterColumn?.type === "checkbox" && filter.value !== "true"
              ? "false"
              : filter.value,
        }
      : { column: "", value: "" };
  const activeSort =
    sort &&
    (sort.column === TITLE_PROPERTY ||
      columns.some((column) => column.id === sort.column))
      ? sort
      : null;
  const shown = useMemo(
    () =>
      data
        ? databaseViewRows(
            pages,
            data,
            [query, localQuery],
            activeFilter,
            activeSort,
            locale,
          )
        : [],
    [
      data,
      pages,
      query,
      localQuery,
      activeFilter.column,
      activeFilter.value,
      activeSort?.column,
      activeSort?.direction,
      locale,
    ],
  );
  const count = pages.filter((page) => !page.archived).length;
  const board = useMemo(
    () => databaseBoardGroups(shown, columns, activeView.groupBy),
    [shown, columns, activeView.groupBy],
  );
  const visibleIds =
    activeView.type === "board"
      ? board.groups.flatMap((group) => group.rows.map((row) => row.page.id))
      : shown.map((row) => row.page.id);
  const visibleSignature = JSON.stringify(visibleIds);
  const visibleCallback = useRef(onVisiblePagesChange);
  visibleCallback.current = onVisiblePagesChange;
  useEffect(() => {
    if (data)
      visibleCallback.current?.(JSON.parse(visibleSignature) as string[]);
  }, [visibleSignature, !!data]);
  const pageProperties = useMemo(
    () => new Map(data?.rows.map((row) => [row.id, row]) ?? []),
    [data?.rows],
  );
  const filterOptions = Array.from(
    new Set(
      pages
        .filter((page) => !page.archived)
        .map((page) =>
          activeFilter.column === TITLE_PROPERTY
            ? page.title
            : display(pageProperties.get(page.id)?.[activeFilter.column]),
        ),
    ),
  );

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const currentData = () =>
    validateProjectDatabaseData(session?.getSnapshot().value);
  const edit = (operations: DatasetOperation[], schemaChange = false) => {
    if (
      !session ||
      busy ||
      readOnly ||
      session.getSnapshot().readOnly ||
      session.getSnapshot().status !== "ready"
    )
      return false;
    try {
      // Check the merged candidate too: a schema conversion must never leave an invalid date.
      const preview = applyOperations(currentData(), operations, {
        atomic: false,
      });
      if (schemaChange && preview.conflicts.length) {
        setNotice(t("propertyChanged"));
        return false;
      }
      validateProjectDatabaseData(preview.value);
      const conflicts = session.edit(operations);
      setNotice("");
      return conflicts.length === 0;
    } catch (error) {
      setNotice(errorMessage(error));
      return false;
    }
  };
  const updateViewSetting = <K extends "filter" | "sort" | "groupBy">(
    field: K,
    value: ProjectDatabaseView[K] | undefined,
  ) => {
    if (busy) return;
    if (readOnly || session?.getSnapshot().readOnly) {
      setViewPreview((current) => ({
        ...current,
        [savedView.id]: { ...current[savedView.id], [field]: value },
      }));
      return;
    }
    try {
      const current = currentData();
      if (!databaseViews(current).some((view) => view.id === savedView.id)) {
        setNotice(t("viewChanged"));
        return;
      }
      edit(
        databaseViewSettingOperations(
          current,
          savedView.id,
          field,
          value,
          savedView[field],
        ),
      );
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  const setFilter = (next: DatabaseViewFilter) =>
    updateViewSetting("filter", next.column ? next : undefined);
  const setSort = (next: DatabaseViewSort | null) =>
    updateViewSetting("sort", next);
  const openViewDialog = (mode: "create" | "rename" | "delete") => {
    if (locked || busy) return;
    setViewDialog({ mode, view: mode === "create" ? undefined : savedView });
    setViewName(mode === "create" ? "" : savedView.name);
    setViewType(mode === "create" ? "table" : savedView.type);
    setViewError("");
  };
  const submitViewDialog = () => {
    if (!viewDialog || locked || busy) return;
    if (viewDialog.mode !== "delete" && !viewName.trim()) {
      setViewError(t("viewNameRequired"));
      return;
    }
    try {
      const current = currentData();
      if (viewDialog.mode === "create") {
        const next = {
          id: `view-${crypto.randomUUID()}`,
          name: viewName.trim(),
          type: viewType,
        };
        if (!edit(databaseAddViewOperations(current, next), true)) {
          setViewError(t("viewChanged"));
          return;
        }
        selectView(next.id);
      } else if (viewDialog.view) {
        if (
          !databaseViews(current).some(
            (view) => view.id === viewDialog.view!.id,
          )
        ) {
          setViewError(t("viewChanged"));
          return;
        }
        if (viewDialog.mode === "delete") {
          if (databaseViews(current).length <= 1) {
            setViewError(t("keepOneView"));
            return;
          }
          if (
            !edit(databaseDeleteViewOperations(current, viewDialog.view), true)
          ) {
            setViewError(t("viewChanged"));
            return;
          }
          selectView(
            databaseViews(current).find(
              (view) => view.id !== viewDialog.view!.id,
            )!.id,
          );
        } else if (
          !edit(
            databaseViewSettingOperations(
              current,
              viewDialog.view.id,
              "name",
              viewName.trim(),
              viewDialog.view.name,
            ),
            true,
          )
        ) {
          setViewError(t("viewChanged"));
          return;
        }
      }
      setViewDialog(null);
    } catch (error) {
      setViewError(errorMessage(error));
    }
  };
  const updateCell = (
    pageId: string,
    column: DatabaseColumn,
    value: DatabaseValue,
    before: DatabaseValue | undefined,
  ) => {
    if (busy) return;
    try {
      const current = currentData();
      if (
        current.columns.find((item) => item.id === column.id)?.type !==
        column.type
      ) {
        setNotice(t("propertyChanged"));
        return;
      }
      if (!pages.some((page) => page.id === pageId && !page.archived)) return;
      edit(databaseCellOperations(current, pageId, column.id, value, before));
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  const updateProperty = (
    column: DatabaseColumn,
    field: "name" | "options",
    value: string | string[],
    before: unknown,
  ) => {
    if (busy) return;
    if (field === "name" && !String(value).trim()) {
      setNotice(t("propertyEmpty"));
      return;
    }
    edit([
      {
        op: "set",
        path: ["columns", { id: column.id }, field],
        value,
        ...(before === undefined ? { absent: true as const } : { before }),
      },
    ]);
  };
  const addProperty = (column: DatabaseColumn) => {
    try {
      if (currentData().columns.length >= 50) {
        setNotice(t("propertyLimit"));
        return false;
      }
      return edit([{ op: "insert", path: ["columns"], value: column }], true);
    } catch (error) {
      setNotice(errorMessage(error));
      return false;
    }
  };
  const moveProperty = (
    id: string,
    target: string,
    placement: "before" | "after",
  ) => {
    if (locked || busy) return;
    try {
      const operations = databaseMoveColumnOperations(
        currentData(),
        id,
        target,
        placement,
      );
      if (operations.length && edit(operations, true))
        setReorderAnnouncement(
          t("propertyMoved", {
            name:
              columns.find((column) => column.id === id)?.name ?? t("property"),
          }),
        );
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const columnWidths = [
    TITLE_PROPERTY,
    ...columns.map((column) => column.id),
  ].map((id) => ({
    id,
    width: databaseColumnWidth(activeView, id),
    savedWidth: savedView.columnWidths?.[id],
  }));
  const columnResize = useDatabaseColumnResize({
    viewId: activeView.id,
    columns: columnWidths,
    disabled: locked || busy,
    onCommit: (id, width, before) => {
      try {
        edit(
          databaseColumnWidthOperations(
            currentData(),
            activeView.id,
            id,
            width,
            before,
          ),
        );
      } catch (error) {
        setNotice(errorMessage(error));
      }
    },
  });
  const tableReorder = usePropertyReorder({
    ids: columns.map((column) => column.id),
    disabled: locked || busy || !!columnResize.resizing,
    axis: "horizontal",
    onMove: moveProperty,
  });
  const settingsReorder = usePropertyReorder({
    ids: columns.map((column) => column.id),
    disabled: locked || busy,
    axis: "vertical",
    onMove: moveProperty,
  });
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const tableColumns = tableReorder.orderedIds
    .map((id) => columnById.get(id)!)
    .filter(Boolean);
  const settingsColumns = settingsReorder.orderedIds
    .map((id) => columnById.get(id)!)
    .filter(Boolean);
  const resizeHandle = (id: string, name: string) =>
    !locked && (
      <div
        {...columnResize.handleProps(id)}
        className="project-db-column-resize"
        data-resizing={columnResize.resizing === id || undefined}
        aria-label={t("resizeColumn", { name })}
        title={t("columnResizeHint")}
      />
    );
  const cycleSort = (column: string) =>
    setSort(
      sort?.column !== column
        ? { column, direction: "asc" }
        : sort.direction === "asc"
          ? { column, direction: "desc" }
          : null,
    );
  const sortIcon = (column: string) =>
    activeSort?.column === column ? (
      activeSort.direction === "asc" ? (
        <ArrowUp size={13} />
      ) : (
        <ArrowDown size={13} />
      )
    ) : null;
  const retry = () =>
    run(async () => {
      await session?.refresh();
      await session?.flush();
    });
  const conflictLabel = (
    path: (string | number | { id: string | number })[],
  ) => {
    if (path[0] === "intro") return t("introduction");
    const id = path.find((part) => typeof part === "object");
    const rowId = typeof id === "object" ? String(id.id) : "";
    if (path[0] === "columns")
      return (
        columns.find((column) => column.id === rowId)?.name ?? t("property")
      );
    if (path[0] === "views")
      return views.find((view) => view.id === rowId)?.name ?? t("view");
    const page = pages.find((item) => item.id === rowId);
    const field = path.at(-1);
    const property = columns.find((column) => column.id === field)?.name;
    return [page?.title || t("document"), property].filter(Boolean).join(" · ");
  };
  const conflictValue = (value: unknown): string => {
    if (
      value &&
      typeof value === "object" &&
      "type" in value &&
      value.type === "doc"
    )
      return introductionText(value).slice(0, 240) || t("emptyValue");
    return value === undefined
      ? t("removedValue")
      : typeof value === "boolean"
        ? t(value ? "checked" : "unchecked")
        : typeof value === "string" || typeof value === "number"
          ? String(value) || t("emptyValue")
          : Array.isArray(value) &&
              value.every((item) => typeof item === "string")
            ? value.join(", ")
            : t("changedValue");
  };

  return (
    <section
      className="project-database"
      aria-label={`${project.name} · ${t("database")}`}
    >
      <header className="project-db-header">
        <span className="project-db-badge">
          <Database size={13} />
          {t("database")}
        </span>
        <h1>{project.name}</h1>
        <p>{t("description")}</p>
      </header>
      {session && data && (
        <DatabaseIntroduction session={session} readOnly={locked} />
      )}
      <div className="project-db-view-strip">
        <div
          className="project-db-tabs"
          role="tablist"
          aria-label={t("views")}
          ref={viewMotion.tabs}
        >
          <span
            className="project-db-tab-indicator"
            aria-hidden="true"
            ref={viewMotion.indicator}
          />
          {views.map((view, index) => (
            <button
              type="button"
              role="tab"
              key={view.id}
              aria-selected={activeView.id === view.id}
              aria-controls={viewPanelId}
              tabIndex={activeView.id === view.id ? 0 : -1}
              disabled={busy}
              onClick={() => {
                if (!busy) selectView(view.id);
              }}
              onKeyDown={(event) => {
                if (busy) return;
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % views.length
                    : event.key === "ArrowLeft"
                      ? (index + views.length - 1) % views.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? views.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                selectView(views[next].id);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [next]?.focus();
              }}
            >
              {viewIcon(view.type)}
              <span>{view.name}</span>
            </button>
          ))}
        </div>
        {!locked && (
          <div className="project-db-view-actions">
            <button
              type="button"
              disabled={busy || views.length >= 50}
              title={views.length >= 50 ? t("viewLimit") : t("addView")}
              onClick={() => openViewDialog("create")}
            >
              <Plus size={14} />
              <span>{t("addView")}</span>
            </button>
            <button
              type="button"
              className="project-db-icon-button"
              aria-label={t("renameView", { name: savedView.name })}
              disabled={busy}
              title={t("renameView", { name: savedView.name })}
              onClick={() => openViewDialog("rename")}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              className="project-db-icon-button"
              aria-label={t("deleteView", { name: savedView.name })}
              title={
                views.length <= 1
                  ? t("keepOneView")
                  : t("deleteView", { name: savedView.name })
              }
              disabled={busy || views.length <= 1}
              onClick={() => openViewDialog("delete")}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="project-db-toolbar">
        {activeView.type === "board" && board.column && (
          <label className="project-db-group-control">
            <span>{t("groupBy")}</span>
            <select
              aria-label={t("groupBy")}
              value={board.column.id}
              disabled={busy || !data}
              onChange={(event) =>
                updateViewSetting("groupBy", event.target.value)
              }
            >
              {columns
                .filter((column) => column.type === "select")
                .map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <span
          className="project-db-save-state"
          role="status"
          aria-live="polite"
        >
          {readOnly || snapshot?.readOnly
            ? t("readOnly")
            : snapshot?.saving
              ? t("saving")
              : snapshot?.dirty
                ? t("unsaved")
                : snapshot?.status === "ready" &&
                    !snapshot.error &&
                    !snapshot.conflicts.length
                  ? t("saved")
                  : ""}
        </span>
        <div className="project-db-tools">
          <label className="project-db-search">
            <Search size={14} />
            <input
              type="search"
              disabled={busy}
              aria-label={t("search")}
              placeholder={t("search")}
              value={localQuery}
              onChange={(event) => setLocalQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={
              showFilter || activeFilter.column || activeSort ? "is-active" : ""
            }
            aria-expanded={showFilter}
            disabled={busy}
            onClick={() => {
              if (!busy) setShowFilter(!showFilter);
            }}
          >
            <Filter size={14} />
            {t("filter")}
            {activeFilter.column && <span className="project-db-filter-dot" />}
          </button>
          <button
            type="button"
            className={showProperties ? "is-active" : ""}
            aria-expanded={showProperties}
            disabled={locked || busy}
            onClick={() => {
              if (!busy) setShowProperties(!showProperties);
            }}
          >
            <Columns3 size={14} />
            {t("properties")}
          </button>
          {!locked && (
            <>
              <button
                type="button"
                className="project-db-icon-button"
                aria-label={t("undo")}
                title={t("undo")}
                disabled={busy || !snapshot?.canUndo}
                onClick={() => {
                  if (!busy) session?.undo();
                }}
              >
                <Undo2 size={14} />
              </button>
              <button
                type="button"
                className="project-db-icon-button"
                aria-label={t("redo")}
                title={t("redo")}
                disabled={busy || !snapshot?.canRedo}
                onClick={() => {
                  if (!busy) session?.redo();
                }}
              >
                <Redo2 size={14} />
              </button>
            </>
          )}
          <button
            type="button"
            className="project-db-primary"
            disabled={locked || busy}
            onClick={() => void run(onCreate)}
          >
            <Plus size={15} />
            {t("newDocument")}
          </button>
        </div>
      </div>
      {showFilter && (
        <div className="project-db-filter-panel">
          <select
            aria-label={t("filterProperty")}
            disabled={busy}
            value={activeFilter.column}
            onChange={(event) =>
              setFilter({
                column: event.target.value,
                value:
                  columns.find((column) => column.id === event.target.value)
                    ?.type === "checkbox"
                    ? "false"
                    : "",
              })
            }
          >
            <option value="">{t("allDocuments")}</option>
            <option value={TITLE_PROPERTY}>{t("title")}</option>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
          {activeFilter.column && (
            <>
              <span>{t("equals")}</span>
              {filterColumn?.type === "select" ||
              filterColumn?.type === "checkbox" ? (
                <select
                  aria-label={t("filterValue")}
                  disabled={busy}
                  value={activeFilter.value}
                  onChange={(event) =>
                    setFilter({ ...filter, value: event.target.value })
                  }
                >
                  {filterColumn.type !== "checkbox" && (
                    <option value="">{t("emptyValue")}</option>
                  )}
                  {(filterColumn.type === "checkbox"
                    ? ["true", "false"]
                    : Array.from(
                        new Set([
                          ...(filterColumn?.options ?? []),
                          ...filterOptions,
                        ]),
                      )
                  )
                    .filter(Boolean)
                    .map((value) => (
                      <option key={value} value={value}>
                        {value === "true" && filterColumn.type === "checkbox"
                          ? t("checked")
                          : value === "false" &&
                              filterColumn.type === "checkbox"
                            ? t("unchecked")
                            : value}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  aria-label={t("filterValue")}
                  disabled={busy}
                  type={filterColumn?.type === "date" ? "date" : "text"}
                  value={filter.value}
                  onChange={(event) =>
                    setFilter({ ...filter, value: event.target.value })
                  }
                />
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setFilter({ column: "", value: "" })}
              >
                {t("clear")}
              </button>
            </>
          )}
          {activeSort && (
            <button type="button" disabled={busy} onClick={() => setSort(null)}>
              {t("clearSort")}
            </button>
          )}
          <span className="project-db-filter-divider" aria-hidden="true" />
          <label className="project-db-sort-control">
            <span>{t("sort")}</span>
            <select
              aria-label={t("sortProperty")}
              disabled={busy}
              value={activeSort?.column ?? ""}
              onChange={(event) =>
                setSort(
                  event.target.value
                    ? { column: event.target.value, direction: "asc" }
                    : null,
                )
              }
            >
              <option value="">{t("noSort")}</option>
              <option value={TITLE_PROPERTY}>{t("title")}</option>
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          {activeSort && (
            <select
              aria-label={t("sortDirection")}
              disabled={busy}
              value={activeSort.direction}
              onChange={(event) =>
                setSort({
                  ...activeSort,
                  direction: event.target.value as "asc" | "desc",
                })
              }
            >
              <option value="asc">{t("sortAscending")}</option>
              <option value="desc">{t("sortDescending")}</option>
            </select>
          )}
        </div>
      )}
      {showProperties && !locked && (
        <section className="project-db-properties" aria-label={t("properties")}>
          <div className="project-db-property-heading">
            <strong>{t("properties")}</strong>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!busy) setShowProperties(false);
              }}
            >
              {t("closeProperties")}
            </button>
          </div>
          <p>{t("autoSave")}</p>
          <div className="project-db-fixed-property">
            <span className="project-db-type-symbol">Aa</span>
            <strong>{t("title")}</strong>
            <span>{t("fixedTitle")}</span>
          </div>
          <div
            ref={settingsReorder.container}
            {...settingsReorder.containerProps}
          >
            {settingsColumns.map((column) => (
              <div
                className="project-db-property-row"
                key={column.id}
                {...settingsReorder.itemProps(column.id)}
              >
                <button
                  type="button"
                  className="project-db-icon-button project-db-property-grip"
                  disabled={locked || busy || columns.length < 2}
                  aria-label={t("moveProperty", { name: column.name })}
                  title={t("propertyDragVerticalHint")}
                  {...settingsReorder.handleProps(column.id)}
                >
                  <GripVertical size={14} />
                </button>
                <DraftInput
                  value={column.name}
                  label={t("propertyName")}
                  disabled={locked || busy}
                  maxLength={1000}
                  onCommit={(value, before) =>
                    updateProperty(column, "name", value.trim(), before)
                  }
                />
                <select
                  aria-label={`${column.name} · ${t("propertyType")}`}
                  value={column.type}
                  disabled={locked || busy}
                  onChange={(event) => {
                    try {
                      edit(
                        databaseTypeOperations(
                          currentData(),
                          column,
                          event.target.value as ColumnType,
                        ),
                        true,
                      );
                    } catch (error) {
                      setNotice(errorMessage(error));
                    }
                  }}
                >
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`type.${type}`)}
                    </option>
                  ))}
                </select>
                {column.type === "select" ? (
                  <PropertyOptions
                    column={column}
                    disabled={locked || busy}
                    onCommit={(options, before) =>
                      updateProperty(column, "options", options, before)
                    }
                  />
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  className="project-db-icon-button project-db-danger"
                  aria-label={t("deleteProperty", { name: column.name })}
                  disabled={busy}
                  title={t("deleteProperty", { name: column.name })}
                  onClick={() => {
                    try {
                      edit(
                        databaseRemoveColumnOperations(currentData(), column),
                        true,
                      );
                    } catch (error) {
                      setNotice(errorMessage(error));
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <AddDatabaseProperty
            disabled={locked || busy}
            atLimit={columns.length >= 50}
            onCreate={addProperty}
          />
        </section>
      )}
      {notice && (
        <div className="project-db-notice" role="alert">
          <span>{notice}</span>
          <button
            type="button"
            className="project-db-icon-button"
            aria-label={t("dismiss")}
            disabled={busy}
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {snapshot?.error && (
        <div className="project-db-notice" role="alert">
          <span>
            {snapshot.status === "ready"
              ? t("saveFailed", { error: snapshot.error })
              : snapshot.error}
          </span>
          <button type="button" disabled={busy} onClick={() => void retry()}>
            {t("retry")}
          </button>
        </div>
      )}
      {!!snapshot?.conflicts.length && (
        <div className="project-db-conflicts" role="alert">
          <strong>
            {t("conflicts", { count: snapshot.conflicts.length })}
          </strong>
          <p>{t("conflictHint")}</p>
          {snapshot.conflicts.map((conflict) => (
            <div className="project-db-conflict" key={conflict.id}>
              <strong>{conflictLabel(conflict.path)}</strong>
              <span>{t("mine", { value: conflictValue(conflict.mine) })}</span>
              <span>
                {t("theirs", { value: conflictValue(conflict.theirs) })}
              </span>
              {!locked && (
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!busy) session?.resolve(conflict.id, "mine");
                    }}
                  >
                    {t("keepMine")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!busy) session?.resolve(conflict.id, "theirs");
                    }}
                  >
                    {t("keepTheirs")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {snapshot?.recovered.map((draft) => (
        <div className="project-db-notice" role="status" key={draft.clientId}>
          <span>
            {t("recovered", {
              time: new Date(draft.savedAt).toLocaleString(locale),
            })}
          </span>
          {!locked && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    session?.recover(draft.clientId, "restore"),
                  )
                }
              >
                {t("restore")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    session?.recover(draft.clientId, "discard"),
                  )
                }
              >
                {t("discard")}
              </button>
            </>
          )}
        </div>
      ))}
      {!session ? (
        <p className="project-db-state" role="alert">
          {t("unavailable")}
        </p>
      ) : !snapshot || snapshot.status === "loading" ? (
        <p className="project-db-state" role="status">
          {t("loading")}
        </p>
      ) : parsed && "error" in parsed ? (
        <p className="project-db-state" role="alert">
          {parsed.error}
        </p>
      ) : (
        data && (
          <div
            className="project-db-view-panel"
            role="tabpanel"
            id={viewPanelId}
            aria-label={activeView.name}
            ref={viewMotion.panel}
          >
            <div className="project-db-view-content" ref={viewMotion.content}>
              {activeView.type === "table" && (
                <div
                  className="project-db-table-wrap"
                  ref={tableReorder.container}
                  {...tableReorder.containerProps}
                >
                  <table
                    className="project-db-table"
                    ref={columnResize.table}
                    style={{
                      width: columnWidths.reduce(
                        (sum, column) => sum + column.width,
                        locked ? 38 : 173,
                      ),
                    }}
                  >
                    <colgroup>
                      <col
                        data-column-width-id={TITLE_PROPERTY}
                        style={{
                          width: databaseColumnWidth(
                            activeView,
                            TITLE_PROPERTY,
                          ),
                        }}
                      />
                      {tableColumns.map((column) => (
                        <col
                          key={column.id}
                          data-column-width-id={column.id}
                          style={{
                            width: databaseColumnWidth(activeView, column.id),
                          }}
                        />
                      ))}
                      {!locked && (
                        <col data-add-property style={{ width: 135 }} />
                      )}
                      <col style={{ width: 38 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th
                          className="project-db-title-column"
                          scope="col"
                          aria-sort={
                            activeSort?.column === TITLE_PROPERTY
                              ? activeSort.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => cycleSort(TITLE_PROPERTY)}
                          >
                            <span className="project-db-type-symbol">Aa</span>
                            <span className="project-db-column-name">
                              {t("title")}
                            </span>
                            {sortIcon(TITLE_PROPERTY)}
                          </button>
                          {resizeHandle(TITLE_PROPERTY, t("title"))}
                        </th>
                        {tableColumns.map((column) => (
                          <th
                            key={column.id}
                            scope="col"
                            {...tableReorder.itemProps(column.id)}
                            aria-sort={
                              activeSort?.column === column.id
                                ? activeSort.direction === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => cycleSort(column.id)}
                              title={
                                !locked
                                  ? t("propertyDragHorizontalHint")
                                  : undefined
                              }
                              aria-description={
                                !locked
                                  ? t("propertyDragHorizontalHint")
                                  : undefined
                              }
                              {...tableReorder.handleProps(column.id)}
                            >
                              <span className="project-db-type-symbol">
                                {TYPE_SYMBOL[column.type]}
                              </span>
                              <span className="project-db-column-name">
                                {column.name}
                              </span>
                              {sortIcon(column.id)}
                            </button>
                            {resizeHandle(column.id, column.name)}
                          </th>
                        ))}
                        {!locked && (
                          <th scope="col" className="project-db-add-column">
                            <AddDatabaseProperty
                              disabled={busy}
                              atLimit={columns.length >= 50}
                              onCreate={addProperty}
                            />
                          </th>
                        )}
                        <th scope="col" className="project-db-actions-column">
                          <span className="project-db-sr-only">
                            {t("rowActions")}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(({ page, properties }) => (
                        <tr
                          key={page.id}
                          data-active={activePageId === page.id || undefined}
                        >
                          <td className="project-db-title-column">
                            <DocumentName
                              page={page}
                              active={activePageId === page.id}
                              locked={locked}
                              interactionBusy={busy}
                              onOpen={onOpen}
                              onRename={onRename}
                              onError={setNotice}
                            />
                          </td>
                          {tableColumns.map((column) => (
                            <td
                              key={column.id}
                              {...tableReorder.cellProps(column.id)}
                              className={
                                column.type === "checkbox"
                                  ? "project-db-checkbox-cell"
                                  : undefined
                              }
                            >
                              <DatabasePropertyCell
                                column={column}
                                value={properties[column.id]}
                                label={`${page.title || t("untitled")} · ${column.name}`}
                                locked={locked || busy}
                                update={(value, before) =>
                                  updateCell(page.id, column, value, before)
                                }
                              />
                            </td>
                          ))}
                          {!locked && <td className="project-db-add-column" />}
                          <td className="project-db-actions-column">
                            {!locked && (
                              <button
                                type="button"
                                className="project-db-icon-button project-db-row-archive"
                                disabled={busy}
                                title={t("archive", { name: page.title })}
                                aria-label={t("archive", { name: page.title })}
                                onClick={() =>
                                  void run(() => onRemove(page.id))
                                }
                              >
                                <Archive size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {activeView.type === "board" && (
                <>
                  {!board.column && (
                    <p className="project-db-board-hint">
                      {t("boardNoSelect")}
                    </p>
                  )}
                  <div className="project-db-board">
                    {board.groups.map((group) => (
                      <section
                        className="project-db-board-group"
                        key={group.value}
                        aria-label={
                          group.value ||
                          t(board.column ? "ungrouped" : "allDocuments")
                        }
                      >
                        <header>
                          <strong>
                            {group.value ||
                              t(board.column ? "ungrouped" : "allDocuments")}
                          </strong>
                          <span>{group.rows.length}</span>
                        </header>
                        <div className="project-db-board-cards">
                          {group.rows.map(({ page, properties }) => (
                            <article
                              key={page.id}
                              className="project-db-card"
                              data-active={
                                activePageId === page.id || undefined
                              }
                            >
                              <DocumentName
                                page={page}
                                active={activePageId === page.id}
                                locked={locked}
                                interactionBusy={busy}
                                onOpen={onOpen}
                                onRename={onRename}
                                onError={setNotice}
                              />
                              <PropertySummary
                                columns={columns.filter(
                                  (column) => column.id !== board.column?.id,
                                )}
                                properties={properties}
                              />
                              <div className="project-db-card-footer">
                                {board.column && (
                                  <DatabasePropertyCell
                                    column={board.column}
                                    value={properties[board.column.id]}
                                    label={`${page.title || t("untitled")} · ${board.column.name}`}
                                    locked={locked || busy}
                                    update={(value, before) =>
                                      updateCell(
                                        page.id,
                                        board.column!,
                                        value,
                                        before,
                                      )
                                    }
                                  />
                                )}
                                {!locked && (
                                  <button
                                    type="button"
                                    className="project-db-icon-button project-db-row-archive"
                                    disabled={busy}
                                    title={t("archive", { name: page.title })}
                                    aria-label={t("archive", {
                                      name: page.title,
                                    })}
                                    onClick={() =>
                                      void run(() => onRemove(page.id))
                                    }
                                  >
                                    <Archive size={14} />
                                  </button>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                        {!group.rows.length && (
                          <p className="project-db-empty-group">
                            {t("emptyGroup")}
                          </p>
                        )}
                      </section>
                    ))}
                  </div>
                </>
              )}
              {activeView.type === "list" && (
                <ul className="project-db-list" aria-label={activeView.name}>
                  {shown.map(({ page, properties }) => (
                    <li
                      key={page.id}
                      className="project-db-list-row"
                      data-active={activePageId === page.id || undefined}
                    >
                      <DocumentName
                        page={page}
                        active={activePageId === page.id}
                        locked={locked}
                        interactionBusy={busy}
                        onOpen={onOpen}
                        onRename={onRename}
                        onError={setNotice}
                      />
                      <PropertySummary
                        columns={columns}
                        properties={properties}
                      />
                      {!locked && (
                        <button
                          type="button"
                          className="project-db-icon-button project-db-row-archive"
                          disabled={busy}
                          title={t("archive", { name: page.title })}
                          aria-label={t("archive", { name: page.title })}
                          onClick={() => void run(() => onRemove(page.id))}
                        >
                          <Archive size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!shown.length && (
                <div className="project-db-empty">
                  <Database size={28} />
                  <strong>{t(count ? "noMatches" : "empty")}</strong>
                  <p>{t(count ? "noMatchesHint" : "emptyHint")}</p>
                  {!count && (
                    <button
                      type="button"
                      disabled={locked || busy}
                      onClick={() => void run(onCreate)}
                    >
                      <Plus size={15} />
                      {t("newDocument")}
                    </button>
                  )}
                </div>
              )}
              <footer className="project-db-footer">
                <span>
                  {shown.length === count
                    ? t("count", { count })
                    : t("filteredCount", { shown: shown.length, count })}
                </span>
                {activeSort && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSort(null)}
                  >
                    {t("clearSort")}
                  </button>
                )}
              </footer>
            </div>
          </div>
        )
      )}
      <span className="project-db-sr-only" role="status" aria-live="polite">
        {reorderAnnouncement}
      </span>
      {viewDialog &&
        createPortal(
          <Dialog
            title={t(
              viewDialog.mode === "create"
                ? "addView"
                : viewDialog.mode === "rename"
                  ? "renameViewTitle"
                  : "deleteViewTitle",
            )}
            className="project-db-view-dialog"
            onClose={() => {
              if (!busy) setViewDialog(null);
            }}
          >
            <form
              className="studio-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitViewDialog();
              }}
            >
              {viewDialog.mode === "delete" ? (
                <p className="studio-delete-description">
                  {t("deleteViewConfirm", {
                    name: viewDialog.view?.name ?? "",
                  })}
                </p>
              ) : (
                <>
                  <label>
                    {t("viewName")}
                    <input
                      value={viewName}
                      disabled={busy}
                      maxLength={200}
                      onChange={(event) => setViewName(event.target.value)}
                      placeholder={t("viewNamePlaceholder")}
                    />
                  </label>
                  {viewDialog.mode === "create" && (
                    <label>
                      {t("viewType")}
                      <select
                        value={viewType}
                        disabled={busy}
                        onChange={(event) =>
                          setViewType(
                            event.target.value as ProjectDatabaseView["type"],
                          )
                        }
                      >
                        <option value="table">{t("table")}</option>
                        <option value="board">{t("board")}</option>
                        <option value="list">{t("list")}</option>
                      </select>
                    </label>
                  )}
                </>
              )}
              {viewError && (
                <p className="studio-form-error" role="alert">
                  {viewError}
                </p>
              )}
              <footer>
                <button
                  type="button"
                  className="studio-button"
                  disabled={busy}
                  onClick={() => {
                    if (!busy) setViewDialog(null);
                  }}
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  className={`studio-button ${viewDialog.mode === "delete" ? "danger" : "primary"}`}
                  disabled={locked || busy}
                >
                  {t(
                    viewDialog.mode === "delete"
                      ? "deleteViewAction"
                      : viewDialog.mode === "create"
                        ? "createView"
                        : "save",
                  )}
                </button>
              </footer>
            </form>
          </Dialog>,
          document.body,
        )}
    </section>
  );
}
