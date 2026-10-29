import { BlockItemSources, BlockSettings } from "./action-host";
import ExpandableSearch from "../ExpandableSearch";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns3,
  Download,
  ExternalLink,
  FileText,
  Filter,
  GripVertical,
  LayoutDashboard,
  LayoutList,
  List,
  Plus,
  Table2,
  Trash2,
} from "../../ui/icons";
import {
  downloadFile,
  filterSortRows,
  safeUrl,
  text,
  toCsv,
  uid,
} from "./helpers";
import { BlockHeader, EmptyState, Field, blockLabel } from "./shared";
import {
  DatabaseCalendar,
  pruneCalendarConfig,
  resolveCalendar,
} from "./DatabaseCalendar";
import { normalizeDate, parsePageCell } from "./database-contract.mjs";
import {
  ROW_ACTION_WIDTH,
  changeView,
  columnWidth,
  databaseViews,
  moveColumnTo,
  newViewId,
  pruneViews,
  titleSyncActions,
  withViews,
  type ViewOverride,
} from "./database-views";
import { usePropertyReorder } from "./database-reorder";
import { useColumnResize } from "./database-column-resize";
import { useDatabaseViewMotion } from "./database-view-motion";
import { databaseRecordTargets } from "./database-records";
import { pageLink } from "../../portable/page-link.mjs";
import { PageLinkContext, type PageLinkBridge } from "../page-links";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";
import type {
  BlockProps,
  ColumnType,
  DatabaseCalendarConfig,
  DatabaseColumn,
  DatabaseRow,
  DatabaseView,
  DatabaseViewType,
} from "./types";
import {
  isIndex,
  isRecord,
  isText,
  useReaderState,
} from "../../surface/reader-state";

const TYPES: { value: ColumnType; label: MessageKey<typeof messages> }[] = [
  { value: "text", label: "type.text" },
  { value: "number", label: "type.number" },
  { value: "select", label: "type.select" },
  { value: "checkbox", label: "type.checkbox" },
  { value: "url", label: "type.url" },
  { value: "date", label: "type.date" },
  { value: "page", label: "type.page" },
];
const VIEWS: {
  type: DatabaseViewType;
  label: MessageKey<typeof messages>;
  Icon: typeof Table2;
}[] = [
  { type: "table", label: "table", Icon: Table2 },
  { type: "board", label: "board", Icon: Columns3 },
  { type: "list", label: "list", Icon: List },
  { type: "calendar", label: "calendar", Icon: LayoutDashboard },
];
const TYPE_SYMBOL: Record<ColumnType, string> = {
  text: "Aa",
  number: "#",
  select: "◉",
  checkbox: "☑",
  url: "↗",
  date: "◫",
  page: "▤",
};
// A select value standing for "create a page"; page links never take this form.
const NEW_PAGE = "showai:new-page";
const RecordOpenContext = createContext<
  ((row: DatabaseRow, column: DatabaseColumn) => void) | null
>(null);

/** The title of the page a cell links to, when the host lists it. */
function pageTitle(
  value: unknown,
  pages: PageLinkBridge | null,
): string | undefined {
  const target = parsePageCell(value);
  if (!target || pages?.projectId !== target.projectId) return undefined;
  return pages.pages.find((page) => page.id === target.pageId)?.title;
}

function PageCell({
  value,
  column,
  editable,
  update,
  createPage,
  openRecord,
}: {
  value: unknown;
  column: DatabaseColumn;
  editable: boolean;
  update: (value: string) => void;
  createPage?: () => void;
  openRecord?: () => void;
}) {
  const t = useTranslator(messages);
  const pages = useContext(PageLinkContext);
  const target = parsePageCell(value);
  const title = pageTitle(value, pages);
  const canPeek = !!pages?.openRecord && !!openRecord;
  const link = target && (
    <a
      className="sb-cell-link sb-page-link"
      href={String(value)}
      data-open-project={target.projectId}
      data-open-page={target.pageId}
      data-database-record={canPeek || undefined}
      aria-label={editable ? t("openPage", { title: title ?? "" }) : undefined}
      onClick={(event) => {
        if (
          !canPeek ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        openRecord?.();
      }}
    >
      <FileText size={13} aria-hidden="true" />
      {editable ? null : title || t("linkedPage")}
    </a>
  );
  if (!editable || !pages)
    return link ?? <span className="sb-cell-value sb-placeholder">—</span>;
  const missing =
    target &&
    !pages.pages.some(
      (page) =>
        pages.projectId === target.projectId && page.id === target.pageId,
    );
  return (
    <div className="sb-cell-input-wrap">
      <select
        aria-label={column.name}
        className="sb-cell-page"
        value={text(value)}
        onChange={(event) =>
          event.target.value === NEW_PAGE
            ? createPage?.()
            : update(event.target.value)
        }
      >
        <option value="">{t("notSet")}</option>
        {createPage && <option value={NEW_PAGE}>{t("newPage")}</option>}
        {pages.pages
          .filter((page) => page.id !== pages.pageId)
          .map((page) => (
            <option
              key={page.id}
              value={pageLink({ projectId: pages.projectId, pageId: page.id })}
            >
              {page.title || t("untitled")}
            </option>
          ))}
        {missing && <option value={String(value)}>{t("linkedPage")}</option>}
      </select>
      {link}
    </div>
  );
}

function Cell({
  row,
  column,
  editable,
  update,
  createPage,
}: {
  row: DatabaseRow;
  column: DatabaseColumn;
  editable: boolean;
  update: (value: string | number | boolean) => void;
  /** Page cells: create a page for this record and link it. */
  createPage?: () => void;
}) {
  const t = useTranslator(messages);
  const openRecord = useContext(RecordOpenContext);
  const value = row[column.id];
  if (column.type === "page")
    return (
      <PageCell
        value={value}
        column={column}
        editable={editable}
        update={update}
        createPage={createPage}
        openRecord={openRecord ? () => openRecord(row, column) : undefined}
      />
    );
  if (column.type === "checkbox")
    return (
      <input
        type="checkbox"
        aria-label={column.name}
        checked={Boolean(value)}
        disabled={!editable}
        onChange={(event) => update(event.target.checked)}
      />
    );
  if (!editable) {
    if (column.type === "select" && value)
      return (
        <span
          className={`sb-tag sb-tag-${(column.options?.indexOf(String(value)) ?? 0) % 5}`}
        >
          {text(value)}
        </span>
      );
    if (column.type === "url" && safeUrl(value))
      return (
        <a
          className="sb-cell-link"
          href={safeUrl(value)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {text(value)}
          <ExternalLink size={12} />
        </a>
      );
    return (
      <span className="sb-cell-value">
        {text(value) || <span className="sb-placeholder">—</span>}
      </span>
    );
  }
  if (column.type === "select")
    return (
      <select
        aria-label={column.name}
        value={text(value)}
        className={`sb-cell-select sb-tag-${(column.options?.indexOf(String(value)) ?? 0) % 5}`}
        onChange={(event) => update(event.target.value)}
      >
        <option value="">{t("notSet")}</option>
        {column.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {value && !column.options?.includes(String(value)) && (
          <option value={String(value)}>{String(value)}</option>
        )}
      </select>
    );
  return (
    <div className="sb-cell-input-wrap">
      <input
        aria-label={column.name}
        type={
          column.type === "number" || column.type === "url"
            ? column.type
            : column.type === "date"
              ? "date"
              : "text"
        }
        className="sb-cell-input"
        value={text(value)}
        placeholder={column.type === "url" ? "https://…" : "—"}
        onChange={(event) =>
          update(
            column.type === "number" && event.target.value !== ""
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
      {column.type === "url" && safeUrl(value) && (
        <a
          className="sb-icon-button"
          href={safeUrl(value)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("openLink", { name: column.name })}
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

/** The new-property form the table header opens above the table. */
function AddProperty({
  onAdd,
  onClose,
}: {
  onAdd: (column: DatabaseColumn) => void;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState("");
  return (
    <form
      className="sb-filter-row sb-add-property-row"
      aria-label={t("addProperty")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onAdd({
          id: uid(),
          name: name.trim(),
          type,
          ...(type === "select"
            ? {
                options: [
                  ...new Set(
                    options
                      .split(/[,，]/)
                      .map((option) => option.trim())
                      .filter(Boolean),
                  ),
                ],
              }
            : {}),
        });
        onClose();
      }}
    >
      <Plus size={13} aria-hidden="true" />
      <input
        aria-label={t("propertyName")}
        placeholder={t("propertyName")}
        value={name}
        maxLength={1000}
        // Typing must reach the form, not the page editor holding this component.
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <select
        aria-label={t("propertyType", { name: name || t("property") })}
        value={type}
        onChange={(event) => setType(event.target.value as ColumnType)}
      >
        {TYPES.map((item) => (
          <option key={item.value} value={item.value}>
            {t(item.label)}
          </option>
        ))}
      </select>
      {type === "select" && (
        <input
          aria-label={t("propertyOptions", { name: name || t("property") })}
          placeholder={t("optionsPlaceholder")}
          value={options}
          onChange={(event) => setOptions(event.target.value)}
        />
      )}
      <button
        type="submit"
        className="sb-button sb-primary sb-small"
        disabled={!name.trim()}
      >
        <Check size={14} />
        {t("addProperty")}
      </button>
      <button type="button" className="sb-text-button" onClick={onClose}>
        {t("cancel")}
      </button>
    </form>
  );
}

export function DatabaseBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  const pages = useContext(PageLinkContext);
  const sourceId = useId();
  const closeRecord = pages?.closeRecord;
  useEffect(() => () => closeRecord?.(sourceId), [sourceId, closeRecord]);
  const columns: DatabaseColumn[] = useMemo(
    () =>
      Array.isArray(data.columns)
        ? data.columns
            .filter((column) => column && typeof column.id === "string")
            .map((column) => ({
              id: column.id,
              name: text(column.name, t("property")),
              type: TYPES.some((type) => type.value === column.type)
                ? column.type
                : "text",
              options: Array.isArray(column.options)
                ? column.options.map((option: unknown) => text(option))
                : [],
              ...(column.type === "page" && typeof column.folder === "string"
                ? { folder: column.folder }
                : {}),
              ...(column.type === "page" &&
              typeof column.titleColumn === "string"
                ? { titleColumn: column.titleColumn }
                : {}),
            }))
        : [],
    [data.columns, t],
  );
  const rows: DatabaseRow[] = Array.isArray(data.rows)
    ? data.rows.filter((row) => row && typeof row.id === "string")
    : [];
  const editable = Boolean(onChange && !readOnly);
  const viewName = (type: DatabaseViewType) =>
    t(VIEWS.find((item) => item.type === type)!.label);
  const { views } = databaseViews(data, viewName);
  const [activeView, setActiveView] = useReaderState("activeView", "", {
    accept: isText,
  });
  // Readers change views for themselves; editors change the saved views.
  const [overrides, setOverrides] = useReaderState<
    Record<string, ViewOverride>
  >("viewOverrides", {}, { accept: isRecord });
  const savedView = views.find((view) => view.id === activeView) ?? views[0];
  const current: DatabaseView = {
    ...savedView,
    ...(editable ? {} : overrides[savedView.id]),
  };
  const view = current.type;
  const motion = useDatabaseViewMotion(
    `${savedView.id}:${view}`,
    views.length > 1,
  );
  const selectView = (id: string) => {
    if (id === savedView.id) return;
    motion.capture();
    setActiveView(id);
    setDraftViewName(null);
    setPage(0);
  };
  const sort = current.sort ?? null;
  const filter = current.filter ?? { column: "", value: "" };
  const writeViews = (next: DatabaseView[], base = data) =>
    onChange?.(withViews(base, next));
  const changeCurrent = (changes: Partial<DatabaseView>) => {
    if (changes.type && changes.type !== current.type) motion.capture();
    if (editable)
      writeViews(
        views.map((item) =>
          item.id === savedView.id ? changeView(item, changes, viewName) : item,
        ),
      );
    else
      setOverrides((all) => ({
        ...all,
        [savedView.id]: { ...all[savedView.id], ...changes },
      }));
  };
  // Calendar column choices are reading state seeded from the saved settings, like board grouping.
  const [calendarChoice, setCalendarChoice] =
    useReaderState<DatabaseCalendarConfig>(
      "calendar",
      {},
      { accept: isRecord },
    );
  const [query, setQuery] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [addingProperty, setAddingProperty] = useState(false);
  const addPropertyButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftColumns, setDraftColumns] = useState<DatabaseColumn[]>([]);
  const [draftViewName, setDraftViewName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useReaderState("page", 0, { accept: isIndex });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  // Page creation is asynchronous; it edits the data current when it finishes.
  const latestData = useRef(data);
  latestData.current = data;
  const pageQueue = useRef<Promise<unknown>>(Promise.resolve());
  // Rows mapped from shared data keep their source fields and stay in the source.
  const sources = useContext(BlockItemSources);
  const cellEditable = (row: DatabaseRow, column: DatabaseColumn) =>
    editable && !sources?.get(row.id)?.readOnly.includes(column.id);
  const removable = (row: DatabaseRow) =>
    sources?.get(row.id)?.removable ?? true;
  const selectColumns = columns.filter((column) => column.type === "select");
  const groupColumn =
    columns.find(
      (column) => column.id === current.groupBy && column.type === "select",
    ) ??
    columns.find(
      (column) => column.id === data.groupBy && column.type === "select",
    ) ??
    selectColumns[0];
  // Search, filters and sorting read page cells by the titles readers see.
  const pageColumns = columns.filter((column) => column.type === "page");
  const readable = (row: DatabaseRow): DatabaseRow =>
    pageColumns.length
      ? {
          ...row,
          ...Object.fromEntries(
            pageColumns.map((column) => [
              column.id,
              row[column.id]
                ? pageTitle(row[column.id], pages) || t("linkedPage")
                : "",
            ]),
          ),
        }
      : row;
  const readableRows = pageColumns.length ? rows.map(readable) : rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const shownRows = filterSortRows(
    readableRows,
    columns,
    query,
    columns.some((column) => column.id === filter.column)
      ? filter
      : { column: "", value: "" },
    sort && columns.some((column) => column.id === sort.column) ? sort : null,
  ).map((row) => byId.get(row.id)!);
  const savedCalendar: DatabaseCalendarConfig =
    data.calendar && typeof data.calendar === "object"
      ? (data.calendar as DatabaseCalendarConfig)
      : {};
  const calendar = resolveCalendar(columns, {
    ...savedCalendar,
    ...calendarChoice,
  });
  const dateColumns = columns.filter((column) => column.type === "date");
  const pageSize = 30,
    totalPages = Math.max(1, Math.ceil(shownRows.length / pageSize)),
    activePage = Math.min(page, totalPages - 1);
  const pagedRows = shownRows.slice(
    activePage * pageSize,
    (activePage + 1) * pageSize,
  );
  const openRecord = (row: DatabaseRow, column: DatabaseColumn) => {
    const target = parsePageCell(row[column.id]);
    if (!target || !pages?.openRecord) return;
    pages.openRecord({
      ...target,
      sourceId,
      recordId: row.id,
      title: text(data.title, t("database")),
      records: databaseRecordTargets(shownRows, column.id),
    });
  };
  const peek = pages?.recordPeek;
  const peekRow =
    peek?.sourceId === sourceId
      ? rows.find((row) =>
          peek.recordId
            ? row.id === peek.recordId
            : pageColumns.some((column) => {
                const target = parsePageCell(row[column.id]);
                return (
                  target?.projectId === peek.projectId &&
                  target.pageId === peek.pageId
                );
              }),
        )
      : undefined;
  const options = filter.column
    ? Array.from(
        new Set(readableRows.map((row) => String(row[filter.column] ?? ""))),
      )
    : [];
  const groupNames = groupColumn
    ? Array.from(
        new Set([
          ...(groupColumn.options ?? []),
          ...shownRows.map((row) => text(row[groupColumn.id])),
          "",
        ]),
      )
    : [""];
  const widths = current.columnWidths ?? {};
  const updateFields = (
    id: string,
    values: Record<string, string | number | boolean>,
  ) =>
    onChange?.({
      ...data,
      rows: rows.map((row) => (row.id === id ? { ...row, ...values } : row)),
    });
  const updateRow = (
    id: string,
    column: string,
    value: string | number | boolean,
  ) => updateFields(id, { [column]: value });
  const addRow = (group?: string, preset: Record<string, string> = {}) => {
    const row: DatabaseRow = {
      id: uid(),
      ...Object.fromEntries(
        columns.map((column) => [
          column.id,
          column.type === "checkbox" ? false : "",
        ]),
      ),
      ...preset,
    };
    if (groupColumn && group !== undefined) row[groupColumn.id] = group;
    onChange?.({ ...data, rows: [...rows, row] });
    setPage(Math.floor(rows.length / pageSize));
    setQuery("");
    if (filter.column) changeCurrent({ filter: undefined });
    // A database of pages gives every new record its own page.
    if (canCreatePages && pageColumns[0])
      createLinkedPage(row.id, pageColumns[0]);
    return row.id;
  };
  const canCreatePages = editable && !!pages?.createPage;
  /** Create a page in the column's folder and link it from the record. */
  const createLinkedPage = (rowId: string, column: DatabaseColumn) => {
    const bridge = pages;
    if (!bridge?.createPage) return;
    setPageError("");
    pageQueue.current = pageQueue.current.then(async () => {
      const base = latestData.current;
      const savedColumn = (base.columns as DatabaseColumn[]).find(
        (item) => item.id === column.id,
      );
      const record = (base.rows as DatabaseRow[]).find(
        (item) => item.id === rowId,
      );
      if (!savedColumn || !record) return;
      // The first page names the record column it stays in step with.
      const titleColumn =
        savedColumn.titleColumn ??
        (base.columns as DatabaseColumn[]).find((item) => item.type === "text")
          ?.id;
      const name = titleColumn ? text(record[titleColumn]).trim() : "";
      try {
        const created = await bridge.createPage!({
          ...(name ? { title: name } : {}),
          ...(savedColumn.folder ? { folderId: savedColumn.folder } : {}),
          folderName: text(base.title).trim() || t("database"),
        });
        const latest = latestData.current;
        onChange?.({
          ...latest,
          columns: (latest.columns as DatabaseColumn[]).map((item) =>
            item.id === column.id
              ? {
                  ...item,
                  folder: created.folderId,
                  ...(titleColumn ? { titleColumn } : {}),
                }
              : item,
          ),
          rows: (latest.rows as DatabaseRow[]).map((item) =>
            item.id === rowId
              ? {
                  ...item,
                  [column.id]: pageLink({
                    projectId: bridge.projectId,
                    pageId: created.pageId,
                  }),
                }
              : item,
          ),
        });
      } catch (reason) {
        setPageError(
          t("error.createPage", {
            message: reason instanceof Error ? reason.message : String(reason),
          }),
        );
      }
    });
  };
  // A record name and its page title stay equal: whichever changed since
  // they last matched is copied to the other.
  const titlePageColumn = pageColumns.find((column) =>
    columns.some(
      (item) => item.id === column.titleColumn && item.type === "text",
    ),
  );
  const syncedTitles = useRef(new Map<string, string>());
  const renames = useRef(
    new Map<
      string,
      {
        title: string;
        timer?: ReturnType<typeof setTimeout>;
        saving: boolean;
        listed?: unknown;
      }
    >(),
  );
  const latestPages = useRef(pages);
  latestPages.current = pages;
  useEffect(
    () => () => {
      for (const rename of renames.current.values()) clearTimeout(rename.timer);
    },
    [],
  );
  useEffect(() => {
    const bridge = pages;
    if (!editable || !bridge?.renamePage || !titlePageColumn) return;
    const nameId = titlePageColumn.titleColumn!;
    const pairs: {
      key: string;
      rowId: string;
      pageId: string;
      stored: string;
      live: string;
    }[] = [];
    for (const row of rows) {
      if (sources?.get(row.id)?.readOnly.includes(nameId)) continue;
      const target = parsePageCell(row[titlePageColumn.id]);
      if (!target || target.projectId !== bridge.projectId) continue;
      const linked = bridge.pages.find((item) => item.id === target.pageId);
      if (!linked) continue;
      pairs.push({
        key: `${row.id}\0${target.pageId}`,
        rowId: row.id,
        pageId: target.pageId,
        stored: text(row[nameId]),
        live: linked.title,
      });
    }
    const storedName = (rowId: string) =>
      text(
        (latestData.current.rows as DatabaseRow[]).find(
          (item) => item.id === rowId,
        )?.[nameId],
      );
    const schedule = (
      key: string,
      rowId: string,
      pageId: string,
      title: string,
    ) => {
      const previous = renames.current.get(key);
      clearTimeout(previous?.timer);
      const rename: {
        title: string;
        timer?: ReturnType<typeof setTimeout>;
        saving: boolean;
        listed?: unknown;
      } = { title, saving: false };
      rename.timer = setTimeout(() => {
        rename.timer = undefined;
        rename.saving = true;
        bridge.renamePage!(pageId, rename.title).then(
          () => {
            rename.saving = false;
            const latest = storedName(rowId);
            // Typing went on while the page saved: rename again.
            if (latest.trim() && latest !== rename.title)
              schedule(key, rowId, pageId, latest);
            else rename.listed = latestPages.current?.pages;
          },
          (reason) => {
            renames.current.delete(key);
            setPageError(
              t("error.renamePage", {
                message:
                  reason instanceof Error ? reason.message : String(reason),
              }),
            );
          },
        );
      }, 600);
      renames.current.set(key, rename);
    };
    for (const pair of pairs) {
      const rename = renames.current.get(pair.key);
      if (!rename) continue;
      if (pair.stored === pair.live) {
        clearTimeout(rename.timer);
        renames.current.delete(pair.key);
      }
      // A finished rename waits until the host lists pages again.
      else if (
        !rename.saving &&
        !rename.timer &&
        rename.listed !== bridge.pages
      )
        renames.current.delete(pair.key);
      else if (
        !rename.saving &&
        rename.timer &&
        pair.stored.trim() &&
        pair.stored !== rename.title
      )
        schedule(pair.key, pair.rowId, pair.pageId, pair.stored);
    }
    const { write, rename } = titleSyncActions(
      pairs,
      syncedTitles.current,
      new Set(renames.current.keys()),
    );
    for (const pair of pairs)
      if (rename.has(pair.key))
        schedule(pair.key, pair.rowId, pair.pageId, rename.get(pair.key)!);
    if (!write.size) return;
    const titles = new Map(
      pairs
        .filter((pair) => write.has(pair.key))
        .map((pair) => [pair.rowId, write.get(pair.key)!]),
    );
    const latest = latestData.current;
    onChange?.({
      ...latest,
      rows: (latest.rows as DatabaseRow[]).map((item) =>
        titles.has(item.id)
          ? { ...item, [nameId]: titles.get(item.id)! }
          : item,
      ),
    });
  });
  const removeRow = (id: string) => {
    if (sources?.get(id)?.removable === false) return;
    onChange?.({ ...data, rows: rows.filter((row) => row.id !== id) });
  };
  const toggleSort = (column: string) => {
    changeCurrent({
      sort:
        sort?.column === column
          ? sort.direction === "asc"
            ? { column, direction: "desc" }
            : null
          : { column, direction: "asc" },
    });
    setPage(0);
  };
  const setFilter = (next: { column: string; value: string }) => {
    changeCurrent({ filter: next.column ? next : undefined });
    setPage(0);
  };
  const addProperty = (column: DatabaseColumn) =>
    onChange?.({
      ...data,
      columns: [...columns, column],
      rows: rows.map((row) =>
        sources?.has(row.id)
          ? row
          : { ...row, [column.id]: column.type === "checkbox" ? false : "" },
      ),
    });
  const placeColumn = (
    id: string,
    target: string,
    placement: "before" | "after",
  ) =>
    onChange?.({
      ...data,
      columns: moveColumnTo(columns, id, target, placement),
    });
  const columnResize = useColumnResize({
    viewId: savedView.id,
    columns: columns.map((column, index) => ({
      id: column.id,
      width: columnWidth(current, column.id, index),
      savedWidth: widths[column.id],
    })),
    trailing: editable ? ROW_ACTION_WIDTH : 0,
    disabled: !editable,
    onCommit: (id, width) => {
      const { [id]: _previous, ...rest } = widths;
      changeCurrent({
        columnWidths: width === undefined ? rest : { ...rest, [id]: width },
      });
    },
  });
  const tableReorder = usePropertyReorder({
    ids: columns.map((column) => column.id),
    disabled: !editable || !!columnResize.resizing,
    axis: "horizontal",
    onMove: placeColumn,
  });
  const settingsReorder = usePropertyReorder({
    ids: draftColumns.map((column) => column.id),
    disabled: false,
    axis: "vertical",
    onMove: (id, target, placement) =>
      setDraftColumns((current) =>
        moveColumnTo(current, id, target, placement),
      ),
  });
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const tableColumns = tableReorder.orderedIds
    .map((id) => columnById.get(id))
    .filter((column): column is DatabaseColumn => !!column);
  const draftById = new Map(draftColumns.map((column) => [column.id, column]));
  const settingsColumns = settingsReorder.orderedIds
    .map((id) => draftById.get(id))
    .filter((column): column is DatabaseColumn => !!column);
  const addView = () => {
    const created: DatabaseView = {
      id: newViewId(views),
      name: viewName("table"),
      type: "table",
    };
    writeViews([...views, created]);
    setActiveView(created.id);
    setPage(0);
  };
  const removeView = () => {
    if (views.length < 2) return;
    const index = views.findIndex((item) => item.id === savedView.id);
    const remaining = views.filter((item) => item.id !== savedView.id);
    writeViews(remaining);
    setActiveView(remaining[Math.max(0, index - 1)].id);
    setPage(0);
  };
  const commitViewName = () => {
    const name = draftViewName?.trim();
    setDraftViewName(null);
    if (name && name !== savedView.name) changeCurrent({ name });
  };
  const openEditor = () => {
    setDraftTitle(text(data.title));
    setDraftColumns(
      columns.map((column) => ({
        ...column,
        options: [...(column.options ?? [])],
      })),
    );
    setError("");
    setEditing(!editing);
  };
  const saveColumns = () => {
    if (!draftColumns.length) {
      setError(t("error.keepOneProperty"));
      return;
    }
    if (draftColumns.some((column) => !column.name.trim())) {
      setError(t("error.nameEveryProperty"));
      return;
    }
    const textIds = new Set(
      draftColumns
        .filter((column) => column.type === "text")
        .map((column) => column.id),
    );
    const cleaned = draftColumns.map(({ folder, titleColumn, ...column }) => ({
      ...column,
      ...(column.type === "page" && folder ? { folder } : {}),
      ...(column.type === "page" && titleColumn && textIds.has(titleColumn)
        ? { titleColumn }
        : {}),
      name: column.name.trim(),
      options: [
        ...new Set(
          (column.options ?? []).map((option) => option.trim()).filter(Boolean),
        ),
      ],
    }));
    const next: Record<string, unknown> = {
      ...data,
      title: draftTitle,
      columns: cleaned,
      rows: rows.map((row) =>
        sources?.has(row.id)
          ? row
          : {
              id: row.id,
              ...Object.fromEntries(
                cleaned.map((column) => {
                  const previous = row[column.id];
                  const value =
                    column.type === "checkbox"
                      ? previous === true || previous === "true"
                      : column.type === "number"
                        ? previous === "" ||
                          previous === undefined ||
                          previous === null
                          ? ""
                          : Number.isFinite(Number(previous))
                            ? Number(previous)
                            : ""
                        : column.type === "date"
                          ? normalizeDate(text(previous))
                          : column.type === "page"
                            ? parsePageCell(previous)
                              ? String(previous)
                              : ""
                            : text(previous);
                  return [column.id, value];
                }),
              ),
            },
      ),
    };
    // Calendar settings and views must keep pointing at columns of the right type.
    const calendarConfig = pruneCalendarConfig(
      data.calendar ? savedCalendar : undefined,
      cleaned,
    );
    if (calendarConfig) next.calendar = calendarConfig;
    if (
      next.view === "calendar" &&
      !cleaned.some((column) => column.type === "date")
    )
      delete next.view;
    if (Array.isArray(data.views)) next.views = pruneViews(views, cleaned);
    onChange?.(next);
    setCalendarChoice({});
    setEditing(false);
  };
  const updateDraftColumn = (id: string, changes: Partial<DatabaseColumn>) =>
    setDraftColumns((current) =>
      current.map((column) =>
        column.id === id ? { ...column, ...changes } : column,
      ),
    );
  const deleteButton = (row: DatabaseRow, label: string) =>
    removable(row) && (
      <button
        type="button"
        className="sb-icon-button sb-danger"
        aria-label={label}
        onClick={() => removeRow(row.id)}
      >
        <Trash2 size={13} />
      </button>
    );
  const cell = (row: DatabaseRow, column: DatabaseColumn) => (
    <Cell
      row={row}
      column={column}
      editable={cellEditable(row, column)}
      update={(value) => updateRow(row.id, column.id, value)}
      createPage={
        canCreatePages && cellEditable(row, column)
          ? () => createLinkedPage(row.id, column)
          : undefined
      }
    />
  );
  const rowName = (row: DatabaseRow) => text(readable(row)[columns[0]?.id]);
  return (
    <RecordOpenContext.Provider value={pages?.openRecord ? openRecord : null}>
    <section
      className="sb-block sb-database"
      aria-label={blockLabel(data.title, t("database"))}
    >
      <BlockHeader
        title={text(data.title)}
        // i18n-exempt: matches the saved default title
        defaultTitle="数据库"
        icon={<Table2 size={17} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label={t("exportDatabase")}
          title={t("exportCsv")}
          onClick={() =>
            downloadFile(
              toCsv(columns, shownRows),
              `${text(data.title, t("database"))}.csv`,
              "text/csv;charset=utf-8",
            )
          }
        >
          <Download size={15} />
        </button>
        <details className="sb-tools-menu">
          <summary aria-label={t("viewAndFilterMenu")}>
            <Filter size={14} aria-hidden="true" />
            {t("viewAndFilter")}
          </summary>
          <div className="sb-database-toolbar">
            <div className="sb-view-tabs">
              {VIEWS.map(({ type, label, Icon }) => (
                <button
                  key={type}
                  type="button"
                  className={view === type ? "is-active" : ""}
                  onClick={() => {
                    changeCurrent({ type });
                    setPage(0);
                  }}
                >
                  <Icon size={14} />
                  {t(label)}
                </button>
              ))}
            </div>
            <div className="sb-database-tools">
              <ExpandableSearch
                label={t("searchDatabase")}
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setPage(0);
                }}
              />
              <button
                type="button"
                className={`sb-icon-button ${showFilter || filter.column ? "is-active" : ""}`}
                aria-label={t("filterDatabase")}
                onClick={() => setShowFilter(!showFilter)}
              >
                <Filter size={15} />
              </button>
              {editable && (
                <button
                  type="button"
                  className="sb-button sb-primary sb-small"
                  onClick={() => addRow()}
                >
                  <Plus size={14} />
                  {t("newRecord")}
                </button>
              )}
            </div>
            {editable && (
              <div className="sb-board-grouping sb-view-settings">
                {views.length > 1 && (
                  <input
                    aria-label={t("viewName")}
                    value={draftViewName ?? savedView.name}
                    maxLength={200}
                    onChange={(event) => setDraftViewName(event.target.value)}
                    onBlur={commitViewName}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitViewName();
                      if (event.key === "Escape") setDraftViewName(null);
                    }}
                  />
                )}
                <button
                  type="button"
                  className="sb-text-button"
                  onClick={addView}
                >
                  <Plus size={13} aria-hidden="true" />
                  {t("newView")}
                </button>
                {views.length > 1 && (
                  <button
                    type="button"
                    className="sb-text-button sb-danger"
                    onClick={removeView}
                  >
                    {t("deleteView")}
                  </button>
                )}
              </div>
            )}
            {view === "board" && selectColumns.length > 0 && (
              <div className="sb-board-grouping">
                <span>{t("groupBy")}</span>
                <select
                  aria-label={t("boardGroupProperty")}
                  value={groupColumn?.id ?? ""}
                  onChange={(event) =>
                    changeCurrent({ groupBy: event.target.value })
                  }
                >
                  {selectColumns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {view === "calendar" && calendar.dateColumn && (
              <div className="sb-board-grouping sb-calendar-settings">
                {(
                  [
                      [
                        "dateColumn",
                        "calendar.dateProperty",
                        dateColumns,
                        false,
                      ],
                    [
                      "endDateColumn",
                      "calendar.endDateProperty",
                      dateColumns.filter(
                        (column) => column.id !== calendar.dateColumn?.id,
                      ),
                      true,
                    ],
                    [
                      "colorColumn",
                      "calendar.colorProperty",
                      selectColumns,
                      true,
                    ],
                    [
                      "doneColumn",
                      "calendar.doneProperty",
                      columns.filter((column) => column.type === "checkbox"),
                      true,
                    ],
                  ] as const
                ).map(([key, label, choices, optional]) =>
                  choices.length > (optional ? 0 : 1) ? (
                    <label key={key}>
                      <span>{t(label)}</span>
                      <select
                        value={calendar[key]?.id ?? ""}
                        onChange={(event) =>
                          setCalendarChoice((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        {optional && (
                          <option value="">{t("calendar.none")}</option>
                        )}
                        {choices.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </details>
      </BlockHeader>
      {views.length > 1 && (
        <div
          className="sb-database-views"
            ref={motion.tabs}
          role="tablist"
          aria-label={t("views")}
        >
            <span
              ref={motion.indicator}
              className="sb-database-view-indicator"
              aria-hidden="true"
            />
          {views.map((item) => {
            const Icon =
              VIEWS.find((entry) => entry.type === item.type)?.Icon ?? Table2;
            const active = item.id === savedView.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                  id={`${sourceId}-view-${item.id}`}
                  aria-controls={`${sourceId}-panel`}
                aria-selected={active}
                  tabIndex={active ? 0 : -1}
                className={active ? "is-active" : ""}
                  onClick={() => selectView(item.id)}
                  onKeyDown={(event) => {
                    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
                    const index = views.findIndex(
                      (entry) => entry.id === item.id,
                    );
                    const next =
                      event.key === "ArrowRight"
                        ? (index + 1) % views.length
                        : event.key === "ArrowLeft"
                          ? (index - 1 + views.length) % views.length
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? views.length - 1
                              : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    selectView(views[next].id);
                    motion.tabs.current
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                      [next]?.focus();
                }}
              >
                <Icon size={13} aria-hidden="true" />
                <span>{item.name}</span>
              </button>
            );
          })}
        </div>
      )}
      {editing && (
        <BlockSettings>
          <div className="sb-editor-panel">
            <Field label={t("databaseName")}>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
            </Field>
            <div
              className="sb-property-list"
              ref={settingsReorder.container}
              {...settingsReorder.containerProps}
            >
              {settingsColumns.map((column) => (
                <div
                  className="sb-property-row"
                  key={column.id}
                  {...settingsReorder.itemProps(column.id)}
                >
                  <button
                    type="button"
                    className="sb-icon-button sb-property-grip"
                    aria-label={t("moveProperty", { name: column.name })}
                    title={t("propertyDragVerticalHint")}
                    disabled={draftColumns.length < 2}
                    {...settingsReorder.handleProps(column.id)}
                  >
                    <GripVertical size={14} />
                  </button>
                  <input
                    aria-label={t("propertyName")}
                    value={column.name}
                    onChange={(event) =>
                        updateDraftColumn(column.id, {
                          name: event.target.value,
                        })
                    }
                  />
                  <select
                    aria-label={t("propertyType", { name: column.name })}
                    value={column.type}
                    onChange={(event) =>
                      updateDraftColumn(column.id, {
                        type: event.target.value as ColumnType,
                      })
                    }
                  >
                    {TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {t(type.label)}
                      </option>
                    ))}
                  </select>
                  {column.type === "page" && (
                    <select
                      className="sb-options-input"
                      aria-label={t("titleColumn", { name: column.name })}
                      value={column.titleColumn ?? ""}
                      onChange={(event) =>
                        updateDraftColumn(column.id, {
                          titleColumn: event.target.value || undefined,
                        })
                      }
                    >
                      <option value="">{t("titleColumnNone")}</option>
                      {draftColumns
                        .filter((item) => item.type === "text")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {t("titleColumnFrom", { name: item.name })}
                          </option>
                        ))}
                    </select>
                  )}
                  {column.type === "select" && (
                    <input
                      className="sb-options-input"
                      aria-label={t("propertyOptions", { name: column.name })}
                      placeholder={t("optionsPlaceholder")}
                      value={column.options?.join(",")}
                      onChange={(event) =>
                        updateDraftColumn(column.id, {
                          options: event.target.value.split(/[,，]/),
                        })
                      }
                    />
                  )}
                  <button
                    type="button"
                    className="sb-icon-button sb-danger"
                    aria-label={t("deleteProperty", { name: column.name })}
                    onClick={() =>
                      setDraftColumns((current) =>
                        current.filter((item) => item.id !== column.id),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            {error && (
              <p role="alert" className="sb-error">
                {error}
              </p>
            )}
            <div className="sb-panel-footer">
              <button
                type="button"
                className="sb-button"
                onClick={() =>
                  setDraftColumns((current) => [
                    ...current,
                    // i18n-exempt: default property name saved into the document
                    { id: uid(), name: "新属性", type: "text" },
                  ])
                }
              >
                <Plus size={14} />
                {t("addProperty")}
              </button>
              <button
                type="button"
                className="sb-button sb-primary"
                onClick={saveColumns}
              >
                <Check size={14} />
                {t("saveProperties")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
      {showFilter && (
        <div className="sb-filter-row">
          <Filter size={13} />
          <select
            aria-label={t("filterProperty")}
            value={filter.column}
            onChange={(event) => {
              const column = event.target.value;
              setFilter({
                column,
                value: column ? String(readableRows[0]?.[column] ?? "") : "",
              });
            }}
          >
            <option value="">{t("allRecords")}</option>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
          {filter.column && (
            <>
              <span>{t("equals")}</span>
              <select
                aria-label={t("filterValue")}
                value={filter.value}
                onChange={(event) =>
                  setFilter({ ...filter, value: event.target.value })
                }
              >
                {[...new Set([...options, filter.value])].map((option) => (
                  <option key={option} value={option}>
                    {option || t("notSet")}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sb-text-button"
                onClick={() => setFilter({ column: "", value: "" })}
              >
                {t("clear")}
              </button>
            </>
          )}
        </div>
      )}
      {addingProperty && editable && view === "table" && (
        <AddProperty
          onAdd={addProperty}
          onClose={() => {
            setAddingProperty(false);
            addPropertyButton.current?.focus();
          }}
        />
      )}
        <div className="sb-database-view-viewport" ref={motion.panel}>
          <div
            className="sb-database-view-content"
            ref={motion.content}
            id={`${sourceId}-panel`}
            role={views.length > 1 ? "tabpanel" : undefined}
            aria-labelledby={
              views.length > 1 ? `${sourceId}-view-${savedView.id}` : undefined
            }
          >
      {view === "calendar" ? (
        <DatabaseCalendar
          key={JSON.stringify(savedCalendar)}
          columns={columns}
          rows={shownRows}
          settings={calendar}
          editable={editable}
          renderCell={cell}
          onMove={(id, start, end) =>
            updateFields(id, {
              [calendar.dateColumn!.id]: start,
              ...(end && calendar.endDateColumn
                ? { [calendar.endDateColumn.id]: end }
                : {}),
            })
          }
          onAdd={
            calendar.dateColumn
                    ? (date) =>
                        addRow(undefined, { [calendar.dateColumn!.id]: date })
              : undefined
          }
          onRemove={removeRow}
        />
      ) : view === "table" ? (
        <>
          <div
            className="sb-table-scroll"
            ref={tableReorder.container}
            {...tableReorder.containerProps}
          >
            <table
              className="sb-database-table"
              ref={columnResize.table}
              style={{
                width:
                  columns.reduce(
                    (sum, column, index) =>
                      sum + columnWidth(current, column.id, index),
                    0,
                  ) + (editable ? ROW_ACTION_WIDTH : 0),
              }}
            >
              <colgroup>
                {tableColumns.map((column) => (
                  <col
                    key={column.id}
                    data-column-width-id={column.id}
                    style={{
                      width: columnWidth(
                        current,
                        column.id,
                        columns.indexOf(column),
                      ),
                    }}
                  />
                ))}
                {editable && <col />}
              </colgroup>
              <thead>
                <tr>
                  {tableColumns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      {...tableReorder.itemProps(column.id)}
                      aria-sort={
                        sort?.column === column.id
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                              title={
                                editable ? t("propertyHeaderHint") : undefined
                              }
                        {...tableReorder.handleProps(column.id)}
                      >
                        <span className="sb-type-symbol">
                          {TYPE_SYMBOL[column.type]}
                        </span>
                              <span className="sb-column-name">
                                {column.name}
                              </span>
                        {sort?.column === column.id &&
                          (sort.direction === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          ))}
                      </button>
                      {editable && (
                        <div
                          {...columnResize.handleProps(column.id)}
                          className="sb-column-resize"
                          data-resizing={
                                  columnResize.resizing === column.id ||
                                  undefined
                          }
                          aria-label={t("resizeProperty", {
                            name: column.name,
                          })}
                          title={t("columnResizeHint")}
                        />
                      )}
                    </th>
                  ))}
                  {editable && (
                    <th className="sb-row-action">
                      <button
                        ref={addPropertyButton}
                        type="button"
                        className="sb-add-property"
                        aria-label={t("addProperty")}
                        title={t("addProperty")}
                        aria-expanded={addingProperty}
                        onClick={() => setAddingProperty(!addingProperty)}
                      >
                        <Plus size={14} aria-hidden="true" />
                      </button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => (
                  <tr key={row.id} title={sources?.get(row.id)?.label}>
                    {tableColumns.map((column) => (
                      <td
                        key={column.id}
                        {...tableReorder.cellProps(column.id)}
                      >
                        {cell(row, column)}
                      </td>
                    ))}
                    {editable && (
                      <td className="sb-row-action">
                        {deleteButton(
                          row,
                          t("deleteNamedRecord", { name: rowName(row) }),
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shownRows.length === 0 && (
            <EmptyState
              icon={<LayoutList size={25} strokeWidth={1.4} />}
                    title={
                      rows.length ? t("empty.noMatches") : t("empty.start")
                    }
            />
          )}
        </>
      ) : view === "list" ? (
        <>
          <ul className="sb-database-list">
            {pagedRows.map((row) => (
              <li key={row.id} title={sources?.get(row.id)?.label}>
                {columns[0] && (
                        <div className="sb-list-title">
                          {cell(row, columns[0])}
                        </div>
                )}
                <div className="sb-list-properties">
                  {columns.slice(1).map((column) =>
                    row[column.id] === "" ||
                    row[column.id] === undefined ||
                          (column.type === "checkbox" &&
                            !row[column.id]) ? null : (
                      <span className="sb-list-property" key={column.id}>
                        <span>{column.name}</span>
                        <Cell
                          row={row}
                          column={column}
                          editable={false}
                          update={() => undefined}
                        />
                      </span>
                    ),
                  )}
                </div>
                {editable && (
                  <span className="sb-row-action">
                    {deleteButton(
                      row,
                      t("deleteNamedRecord", { name: rowName(row) }),
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {editable && (
            <button
              type="button"
              className="sb-add-row"
              onClick={() => addRow()}
            >
              <Plus size={13} />
              {t("addRecord")}
            </button>
          )}
          {shownRows.length === 0 && (
            <EmptyState
              icon={<List size={25} strokeWidth={1.4} />}
                    title={
                      rows.length ? t("empty.noMatches") : t("empty.start")
                    }
            />
          )}
        </>
      ) : (
        <>
          <div className="sb-board">
            {groupNames.map((group, groupIndex) => {
              const groupRows = groupColumn
                      ? shownRows.filter(
                          (row) => text(row[groupColumn.id]) === group,
                        )
                : shownRows;
              return (
                <div
                  className={`sb-board-column ${draggingId ? "is-droppable" : ""}`}
                  key={group}
                  onDragOver={(event) => {
                    if (editable && groupColumn && draggingId)
                      event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (!editable || !groupColumn || !draggingId) return;
                    event.preventDefault();
                    updateRow(draggingId, groupColumn.id, group);
                    setDraggingId(null);
                  }}
                >
                  <div className="sb-board-column-header">
                    <span className={`sb-tag sb-tag-${groupIndex % 5}`}>
                            {group ||
                              (groupColumn ? t("notSet") : t("allRecords"))}
                    </span>
                    <span>{groupRows.length}</span>
                    {editable && (
                      <button
                        type="button"
                        className="sb-icon-button"
                        aria-label={t("newRecordIn", {
                          group: group || t("notSet"),
                        })}
                        onClick={() => addRow(group)}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                  {groupRows.map((row) => (
                    <div
                      className={`sb-board-card ${draggingId === row.id ? "is-dragging" : ""}`}
                      key={row.id}
                      draggable={editable && Boolean(groupColumn)}
                      onDragStart={() => setDraggingId(row.id)}
                      onDragEnd={() => setDraggingId(null)}
                    >
                      {columns
                        .filter((column) => column.id !== groupColumn?.id)
                        .map((column, index) => (
                          <div
                            key={column.id}
                            className={
                              index === 0
                                ? "sb-board-card-title"
                                : "sb-board-card-field"
                            }
                          >
                            {index > 0 && <span>{column.name}</span>}
                            {cell(row, column)}
                          </div>
                        ))}
                      {editable && (
                        <div className="sb-board-card-footer">
                          {groupColumn && (
                            <select
                              aria-label={t("moveToGroup")}
                              value={text(row[groupColumn.id])}
                              onChange={(event) =>
                                updateRow(
                                  row.id,
                                  groupColumn.id,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">{t("notSet")}</option>
                              {groupNames.filter(Boolean).map((name) => (
                                <option key={name}>{name}</option>
                              ))}
                            </select>
                          )}
                          {deleteButton(row, t("deleteRecord"))}
                        </div>
                      )}
                    </div>
                  ))}
                  {editable && (
                    <button
                      type="button"
                      className="sb-add-row"
                      onClick={() => addRow(group)}
                    >
                      <Plus size={13} />
                      {t("addRecord")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
          </div>
        </div>
      {pageError && (
        <p role="alert" className="sb-error sb-database-error">
          {pageError}
        </p>
      )}
      <div className="sb-database-footer">
        <span>
          {shownRows.length === rows.length
            ? t("recordCount", { count: rows.length })
            : t("filteredRecordCount", {
                shown: shownRows.length,
                count: rows.length,
              })}
          {sort && (
            <button
              type="button"
              className="sb-text-button"
              onClick={() => changeCurrent({ sort: null })}
            >
              {t("clearSort")}
            </button>
          )}
        </span>
        {(view === "table" || view === "list") && totalPages > 1 && (
          <div className="sb-pagination">
            <button
              type="button"
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              {t("previousPage")}
            </button>
            <span>
              {activePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={activePage + 1 === totalPages}
              onClick={() => setPage(activePage + 1)}
            >
              {t("nextPage")}
            </button>
          </div>
        )}
      </div>
    </section>
      {peekRow &&
        peek?.propertiesHost &&
        createPortal(
          <div
            className="sb-block sb-database-record-properties"
            aria-label={t("property")}
          >
            {columns.map((column) => (
              <div className="sb-record-property" key={column.id}>
                <span className="sb-record-property-name">
                  <span aria-hidden="true">{TYPE_SYMBOL[column.type]}</span>
                  {column.name}
                </span>
                <div>{cell(peekRow, column)}</div>
              </div>
            ))}
          </div>,
          peek.propertiesHost,
        )}
    </RecordOpenContext.Provider>
  );
}
