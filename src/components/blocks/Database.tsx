import { BlockDataState, BlockItemSources, BlockSettings } from "./action-host";
import { canEdit } from "../../datasets/editable.mjs";
import {
  DatabaseBulkEdit,
  SelectRecords,
  type DatabaseSelection,
} from "./DatabaseBulkEdit";
import { RecordTitle, RecordDialog } from "./DatabaseRecordControls";
import ExpandableSearch from "../ExpandableSearch";
import {
  createContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useContext,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CheckSquare,
  Copy,
  ArrowUp,
  ArrowDown,
  X,
  Eye,
  Download,
  Filter,
  GripVertical,
  Plus,
  Table2,
  Trash2,
} from "../../ui/icons";
import { downloadFile, text, toCsv, uid } from "./helpers";
import { BlockHeader, Field, blockLabel } from "./shared";
import { resolveCalendar } from "./DatabaseCalendar";
import { MAX_DATABASE_VIEWS, parsePageCell } from "./database-contract.mjs";
import {
  changeView,
  columnWidth,
  databaseViews as savedViews,
  moveColumnTo,
  newViewId,
  duplicateDatabaseView,
  pruneCalendarConfig,
  pruneViews,
  titleSyncActions,
  upgradeViewQuery,
  withViews,
  ROW_ACTION_WIDTH,
  type ViewOverride,
} from "./database-views";
import { usePropertyReorder } from "./database-reorder";
import { useColumnResize } from "./database-column-resize";
import { useDatabaseViewMotion } from "./database-view-motion";
import {
  databaseRecordTargets,
  recordFilterDefaults,
  sameDatabaseValue,
} from "./database-records";
import { pageLink } from "../../document/page-link.mjs";
import { usePageLinks } from "../page-links";
import { getLocale } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";
import fieldMessages from "../../i18n/messages/databaseFields";
import {
  valueTypeOf,
  type ValueTypeContext,
} from "../../datasets/value-types.mjs";
import {
  groupKeys,
  queryRecords,
  readFilter,
  readSorts,
  type FilterGroup,
  type RecordSort,
} from "../../datasets/record-query.mjs";
import { recordTitle } from "../../datasets/derived-fields.mjs";
import {
  DERIVED_KEY,
  snapshotHost,
  useDatabaseHost,
  type FieldTypeListing,
} from "./database-host";
import { isDerivedColumn, useDatabaseDerived } from "./database-derived";
import {
  BUILTIN_FIELD_TYPES,
  fieldUiOf,
  pageTitle,
  useFieldTypeLabel,
  type CellEnvironment,
} from "./database-field-ui";
import { DatabaseQueryEditor } from "./DatabaseQueryEditor";
import { databaseView, databaseViews } from "./DatabaseViews";
import "./database-fields.css";
import type {
  BlockProps,
  DatabaseCalendarConfig,
  DatabaseColumn,
  DatabaseRow,
  DatabaseValue,
  DatabaseView,
  DatabaseViewType,
} from "./types";
import {
  isIndex,
  isRecord,
  isText,
  useReaderState,
} from "../../surface/reader-state";

const CellEnvironmentContext = createContext<CellEnvironment | null>(null);

const typeKey = (column: Pick<DatabaseColumn, "type" | "component">) =>
  column.type === "custom" && column.component
    ? `custom:${column.component.componentId}@${column.component.version}`
    : column.type;
const contributedKey = (listing: FieldTypeListing) =>
  `custom:${listing.ref.componentId}@${listing.ref.version}`;

function withType(
  column: DatabaseColumn,
  key: string,
  contributed: FieldTypeListing[],
): DatabaseColumn {
  const {
    relation: _relation,
    formula: _formula,
    rollup: _rollup,
    component: _component,
    config: _config,
    kind: _kind,
    ...rest
  } = column;
  const listing = contributed.find((item) => contributedKey(item) === key);
  if (listing)
    return {
      ...rest,
      type: "custom",
      component: { ...listing.ref },
      kind: listing.valueKind,
      config: structuredClone(listing.defaultConfig),
    };
  const type = key as DatabaseColumn["type"];
  return {
    ...rest,
    type,
    ...(type === column.type
      ? {
          ...(column.relation ? { relation: column.relation } : {}),
          ...(column.formula ? { formula: column.formula } : {}),
          ...(column.rollup ? { rollup: column.rollup } : {}),
        }
      : type === "relation"
        ? { relation: { dataset: "" } }
        : type === "formula"
          ? { formula: { expression: "" } }
          : type === "rollup"
            ? { rollup: { relation: "", aggregate: "count" } }
            : {}),
  };
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
  update: (value: DatabaseValue) => void;
  createPage?: () => void;
}) {
  const env = useContext(CellEnvironmentContext)!;
  const Field = fieldUiOf(column).Cell;
  return (
    <Field
      row={row}
      column={column}
      value={env.derived.value(row, column)}
      editable={
        editable &&
        !isDerivedColumn(column) &&
        !valueTypeOf(column, {
          contributed: (item) => env.host?.field?.(item)?.valueType,
        }).unknown
      }
      update={update}
      createPage={createPage}
      env={env}
    />
  );
}

function ColumnSettings({
  column,
  columns,
  onChange,
  contributed,
}: {
  column: DatabaseColumn;
  columns: DatabaseColumn[];
  onChange: (column: DatabaseColumn) => void;
  contributed: FieldTypeListing[];
}) {
  const t = useTranslator(messages);
  const typeLabel = useFieldTypeLabel();
  const host = useDatabaseHost();
  const Config = fieldUiOf(column).Config;
  const key = typeKey(column);
  return (
    <>
      <select
        className="showai-select"
        aria-label={t("propertyType", { name: column.name || t("property") })}
        value={key}
        onChange={(event) =>
          onChange(withType(column, event.target.value, contributed))
        }
      >
        {BUILTIN_FIELD_TYPES.map((type) => (
          <option key={type} value={type}>
            {typeLabel(type)}
          </option>
        ))}
        {contributed.map((listing) => (
          <option key={contributedKey(listing)} value={contributedKey(listing)}>
            {listing.name}
          </option>
        ))}
        {!BUILTIN_FIELD_TYPES.includes(key) &&
          !contributed.some((listing) => contributedKey(listing) === key) && (
            <option value={key}>
              {column.component?.componentId ?? column.type}
            </option>
          )}
      </select>
      {Config && (
        <Config
          column={column}
          columns={columns}
          host={host}
          onChange={(changes) => onChange({ ...column, ...changes })}
        />
      )}
    </>
  );
}

function AddProperty({
  columns,
  contributed,
  onAdd,
  onClose,
}: {
  columns: DatabaseColumn[];
  contributed: FieldTypeListing[];
  onAdd: (column: DatabaseColumn) => string;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const [draft, setDraft] = useState<DatabaseColumn>(() => ({
    id: uid(),
    name: "",
    type: "text",
  }));
  const [error, setError] = useState("");
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
        if (!draft.name.trim()) return;
        const problem = onAdd({ ...draft, name: draft.name.trim() });
        if (problem) setError(problem);
        else onClose();
      }}
    >
      <Plus size={13} aria-hidden="true" />
      <input
        className="showai-input"
        aria-label={t("propertyName")}
        placeholder={t("propertyName")}
        value={draft.name}
        maxLength={1000}
        autoFocus
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />
      <ColumnSettings
        column={draft}
        columns={[...columns, draft]}
        contributed={contributed}
        onChange={setDraft}
      />
      <button
        type="submit"
        className="sb-button sb-primary sb-small"
        disabled={!draft.name.trim()}
      >
        <Check size={14} />
        {t("addProperty")}
      </button>
      <button type="button" className="sb-text-button" onClick={onClose}>
        {t("cancel")}
      </button>
      {error && (
        <p role="alert" className="sb-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function DatabaseBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  const tf = useTranslator(fieldMessages);
  const pages = usePageLinks();
  const sourceId = useId();
  const closeRecord = pages?.closeRecord;
  useEffect(() => () => closeRecord?.(sourceId), [sourceId, closeRecord]);
  const liveHost = useDatabaseHost();
  const snapshot = data[DERIVED_KEY];
  const dataState = useContext(BlockDataState);
  const selfDataset = dataState?.dataset;
  const host = useMemo(
    () =>
      liveHost
        ? selfDataset
          ? { ...liveHost, selfDataset }
          : liveHost
        : snapshotHost(snapshot),
    [liveHost, selfDataset, snapshot],
  );
  const contributed = host?.fieldTypes?.() ?? [];
  const columns: DatabaseColumn[] = useMemo(
    () =>
      Array.isArray(data.columns)
        ? data.columns
            .filter((column) => column && typeof column.id === "string")
            .map((column) => ({
              ...column,
              name: text(column.name, t("property")),
              type: typeof column.type === "string" ? column.type : "text",
              options: Array.isArray(column.options)
                ? column.options.map((option: unknown) => text(option))
                : [],
            }))
        : [],
    [data.columns, t],
  );
  const rows: DatabaseRow[] = useMemo(
    () =>
      Array.isArray(data.rows)
        ? data.rows.filter((row) => row && typeof row.id === "string")
        : [],
    [data.rows],
  );
  const derived = useDatabaseDerived(columns, rows, host);
  const shownColumns = derived.columns;
  const context: ValueTypeContext = {
    value: (row, column) =>
      derived.value(row as DatabaseRow, column as unknown as DatabaseColumn),
    pageTitle: (value) =>
      value ? pageTitle(value, pages) || t("linkedPage") : "",
    recordTitles: (column, ids) =>
      derived.recordTitles(column as unknown as DatabaseColumn, ids),
    contributed: (column) => host?.field?.(column)?.valueType,
    locale: getLocale(),
  };
  const typeOf = (column: DatabaseColumn) => valueTypeOf(column, context);
  const writable = Boolean(onChange && !readOnly);
  const rowsEditable =
    writable && (!dataState || canEdit(dataState.editable, "rows", ""));
  const canAdd = rowsEditable && rows.length < 5000;
  const editable =
    writable && (!dataState || canEdit(dataState.editable, "columns"));
  const viewEditable =
    writable && (!dataState || canEdit(dataState.editable, "views"));
  const viewName = (type: DatabaseViewType) => t(databaseView(type).label);
  const { views } = savedViews(data, viewName);
  const [activeView, setActiveView] = useReaderState("activeView", "", {
    accept: isText,
  });
  const [overrides, setOverrides] = useReaderState<
    Record<string, ViewOverride>
  >("viewOverrides", {}, { accept: isRecord });
  const savedView = views.find((view) => view.id === activeView) ?? views[0];
  const current: DatabaseView = {
    ...savedView,
    ...(viewEditable ? {} : overrides[savedView.id]),
  };
  const view = current.type;
  const viewDefinition = databaseView(view);
  const motion = useDatabaseViewMotion(
    `${savedView.id}:${view}`,
    views.length > 1,
  );
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [lastBulk, setLastBulk] = useState<{
    field: string;
    type: DatabaseColumn["type"];
    value: DatabaseValue;
    before: Map<string, DatabaseValue | undefined>;
  } | null>(null);
  const [bulkError, setBulkError] = useState(false);
  const selectView = (id: string) => {
    if (id === savedView.id) return;
    motion.capture();
    setActiveView(id);
    setSelection(null);
    setDraftViewName(null);
    setCreatedRowId(null);
    setPage(0);
  };
  const sorts = readSorts(current);
  const filter = readFilter(current.filter, shownColumns);
  const writeViews = (next: DatabaseView[], base = data) =>
    onChange?.(withViews(base, next));
  const changeCurrent = (changes: Partial<DatabaseView>) => {
    if (changes.type && changes.type !== current.type) motion.capture();
    if (viewEditable)
      writeViews(
        views.map((item) =>
          item.id === savedView.id
            ? changeView(
                item,
                { ...upgradeViewQuery(item, shownColumns), ...changes },
                viewName,
              )
            : item,
        ),
      );
    else
      setOverrides((all) => ({
        ...all,
        [savedView.id]: {
          ...all[savedView.id],
          ...changes,
          ...("sorts" in changes ? { sort: undefined } : {}),
        },
      }));
  };
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
  const [localRecordId, setLocalRecordId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [createdRowId, setCreatedRowId] = useState<string | null>(null);
  const pendingRowPages = useRef(new Map<string, string>());
  const linkingPages = useRef(new Set<string>());
  const latestData = useRef(data);
  latestData.current = data;
  const pageQueue = useRef<Promise<unknown>>(Promise.resolve());
  const sources = useContext(BlockItemSources);
  const cellEditable = (row: DatabaseRow, column: DatabaseColumn) =>
    writable &&
    !sources?.get(row.id)?.readOnly.includes(column.id) &&
    (!dataState || canEdit(dataState.editable, "rows", row.id, column.id));
  const removable = (row: DatabaseRow) =>
    sources?.get(row.id)?.removable ?? true;
  const groupable = shownColumns.filter(
    (column) => !isDerivedColumn(column) && typeOf(column).groups,
  );
  const groupColumn =
    groupable.find((column) => column.id === current.groupBy) ??
    groupable.find((column) => column.id === data.groupBy) ??
    groupable.find((column) => column.type === "select");
  const pageColumns = columns.filter((column) => column.type === "page");
  const titleColumn =
    columns.find(
      (column) =>
        column.id === pageColumns.find((item) => item.titleColumn)?.titleColumn,
    ) ??
    columns.find((column) => column.type === "text") ??
    columns[0];
  const defaultCalendar: DatabaseCalendarConfig =
    data.calendar && typeof data.calendar === "object"
      ? (data.calendar as DatabaseCalendarConfig)
      : {};
  const savedCalendar = current.calendar ?? defaultCalendar;
  const calendar = resolveCalendar(columns, savedCalendar);
  const calendarLabels = [
    titleColumn,
    calendar.contextColumn,
    calendar.colorColumn,
    calendar.doneColumn,
    calendar.startTimeColumn,
    calendar.endTimeColumn,
  ];
  const hidden = new Set(
    current.hiddenColumns ??
      (view === "calendar"
        ? shownColumns
            .filter(
              (column) =>
                !calendarLabels.some((label) => label?.id === column.id),
            )
            .map((column) => column.id)
        : []),
  );
  const visibleColumns = shownColumns.filter(
    (column) => column.id === titleColumn?.id || !hidden.has(column.id),
  );
  const shownRows = queryRecords(
    rows,
    shownColumns,
    { search: query, filter, sorts },
    context,
  );
  const selectedRows = selection
    ? shownRows.filter((row) => selection.has(row.id))
    : [];
  const toggleRow = (row: DatabaseRow) =>
    setSelection((old) => {
      const next = new Set(old);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next.size ? next : null;
    });
  const toggleAll = (checked: boolean) =>
    setSelection(checked ? new Set(shownRows.map((row) => row.id)) : null);
  const selectionProps: DatabaseSelection | undefined = rowsEditable
    ? {
        active: !!selection,
        selected: selection ?? new Set(),
        count: selectedRows.length,
        toggleAll,
      }
    : undefined;
  const bulkColumns = selection
    ? columns.filter(
        (column) =>
          !isDerivedColumn(column) &&
          !typeOf(column).unknown &&
          selectedRows.every((row) => cellEditable(row, column)),
      )
    : [];
  const bulkApply = (
    column: DatabaseColumn,
    draft: DatabaseValue | undefined,
  ) => {
    if (
      !selectedRows.length ||
      !bulkColumns.some((field) => field.id === column.id)
    )
      return;
    const value = draft ?? (typeOf(column).blank() as DatabaseValue);
    if (typeOf(column).check(value, column)) return;
    const before = new Map<string, DatabaseValue | undefined>();
    const ids = new Set(selectedRows.map((row) => row.id));
    const next = rows.map((row) => {
      if (!ids.has(row.id) || sameDatabaseValue(row[column.id], value))
        return row;
      before.set(row.id, row[column.id]);
      return { ...row, [column.id]: value };
    });
    if (before.size) {
      onChange?.({ ...data, rows: next });
      setLastBulk({ field: column.id, type: column.type, value, before });
    }
    setBulkError(false);
    setSelection(null);
  };
  const undoBulk = () => {
    if (!lastBulk) return;
    const { field, type, value, before } = lastBulk;
    const column = columns.find(
      (item) => item.id === field && item.type === type,
    );
    const touched = rows.filter((row) => before.has(row.id));
    if (
      !column ||
      isDerivedColumn(column) ||
      touched.length !== before.size ||
      !touched.every(
        (row) =>
          cellEditable(row, column) && sameDatabaseValue(row[field], value),
      )
    ) {
      setBulkError(true);
      return;
    }
    onChange?.({
      ...data,
      rows: rows.map((row) => {
        if (!before.has(row.id)) return row;
        const old = before.get(row.id);
        const next = { ...row };
        if (old === undefined) delete next[field];
        else next[field] = old;
        return next;
      }),
    });
    setLastBulk(null);
    setBulkError(false);
  };
  const dateColumns = columns.filter((column) => column.type === "date");
  const selectColumns = columns.filter((column) => column.type === "select");
  const pageSize = 30,
    totalPages = Math.max(1, Math.ceil(shownRows.length / pageSize)),
    activePage = Math.min(page, totalPages - 1);
  const pagedRows = shownRows.slice(
    activePage * pageSize,
    (activePage + 1) * pageSize,
  );
  const openRecord = (
    row: DatabaseRow,
    column: DatabaseColumn,
    navigation: string | string[] = column.id,
  ) => {
    const target = parsePageCell(row[column.id]);
    if (!target || !pages?.openRecord) return;
    pages.openRecord({
      ...target,
      sourceId,
      recordId: row.id,
      title: text(data.title, t("database")),
      records: databaseRecordTargets(
        shownRows.some((item) => item.id === row.id)
          ? shownRows
          : [row, ...shownRows],
        navigation,
      ),
    });
  };
  const openRow = (row: DatabaseRow) => {
    const column = pageColumns.find((item) => parsePageCell(row[item.id]));
    if (column && pages?.openRecord) {
      setLocalRecordId(null);
      openRecord(
        row,
        column,
        pageColumns.map((item) => item.id),
      );
    } else {
      pages?.closeRecord?.(sourceId);
      setLocalRecordId(row.id);
    }
  };
  const activateRow = selectionProps?.active ? toggleRow : openRow;
  const localRow = localRecordId
    ? rows.find((row) => row.id === localRecordId)
    : undefined;
  useEffect(() => {
    if (!localRow || !pages?.openRecord) return;
    const column = pageColumns.find((item) => parsePageCell(localRow[item.id]));
    if (column) {
      setLocalRecordId(null);
      openRecord(
        localRow,
        column,
        pageColumns.map((item) => item.id),
      );
    }
  }, [localRow, pages?.openRecord, columns]);
  const localIndex = shownRows.findIndex((row) => row.id === localRecordId);
  const outsideRow =
    createdRowId && !shownRows.some((row) => row.id === createdRowId)
      ? rows.find((row) => row.id === createdRowId)
      : undefined;
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
  const groupNames = groupColumn
    ? groupColumn.type === "checkbox"
      ? ["true", "false"]
      : Array.from(
          new Set([
            ...(groupColumn.options ?? []),
            ...shownRows.flatMap((row) => groupKeys(row, groupColumn, context)),
            "",
          ]),
        )
    : [""];
  const groupLabel = (group: string) =>
    groupColumn?.type === "checkbox"
      ? tf(group === "true" ? "group.true" : "group.false")
      : group || (groupColumn ? t("notSet") : t("allRecords"));
  const widths = current.columnWidths ?? {};
  const updateFields = (id: string, values: Record<string, DatabaseValue>) =>
    onChange?.({
      ...data,
      rows: rows.map((row) => (row.id === id ? { ...row, ...values } : row)),
    });
  const updateRow = (id: string, column: string, value: DatabaseValue) =>
    updateFields(id, { [column]: value });
  const blankRow = (): Record<string, DatabaseValue> =>
    Object.fromEntries(
      columns
        .filter((column) => !isDerivedColumn(column))
        .map((column) => [column.id, typeOf(column).blank() as DatabaseValue]),
    );
  const addRow = (
    group?: string,
    preset: Record<string, DatabaseValue> = {},
  ) => {
    const row: DatabaseRow = {
      id: uid(),
      ...blankRow(),
      ...recordFilterDefaults(filter, columns),
      ...preset,
    };
    if (groupColumn && group !== undefined)
      row[groupColumn.id] = typeOf(groupColumn).regroup!(
        row[groupColumn.id],
        "",
        group,
      ) as DatabaseValue;
    if (!canAdd || (dataState && !canEdit(dataState.editable, "rows", row.id)))
      return;
    const nextRows = [...rows, row];
    const index = queryRecords(
      nextRows,
      shownColumns,
      { search: query, filter, sorts },
      context,
    ).findIndex((item) => item.id === row.id);
    if (index >= 0) setPage(Math.floor(index / pageSize));
    if (canCreatePages && pageColumns[0] && cellEditable(row, pageColumns[0]))
      pendingRowPages.current.set(row.id, pageColumns[0].id);
    onChange?.({ ...data, rows: nextRows });
    setCreatedRowId(index < 0 ? row.id : null);
    setSelection(null);
    return row.id;
  };
  const canCreatePages = rowsEditable && !!pages?.createPage;
  const createLinkedPage = (rowId: string, column: DatabaseColumn) => {
    const bridge = pages;
    if (!bridge?.createPage) return;
    const previous = (latestData.current.rows as DatabaseRow[]).find(
      (row) => row.id === rowId,
    )?.[column.id];
    const key = JSON.stringify([rowId, column.id]);
    if (linkingPages.current.has(key)) return;
    linkingPages.current.add(key);
    setPageError("");
    pageQueue.current = pageQueue.current
      .then(async () => {
        const base = latestData.current;
        const savedColumn = (base.columns as DatabaseColumn[]).find(
          (item) => item.id === column.id,
        );
        const record = (base.rows as DatabaseRow[]).find(
          (item) => item.id === rowId,
        );
        if (!savedColumn || !record || record[column.id] !== previous) return;
        const titleColumn =
          savedColumn.titleColumn ??
          (base.columns as DatabaseColumn[]).find(
            (item) => item.type === "text",
          )?.id;
        const name = titleColumn ? text(record[titleColumn]).trim() : "";
        try {
          const created = await bridge.createPage!({
            ...(name ? { title: name } : {}),
            ...(savedColumn.folder ? { folderId: savedColumn.folder } : {}),
            folderName: text(base.title).trim() || t("database"),
          });
          const latest = latestData.current;
          const currentRow = (latest.rows as DatabaseRow[]).find(
            (item) => item.id === rowId,
          );
          if (
            !currentRow ||
            currentRow[column.id] !== previous ||
            !(latest.columns as DatabaseColumn[]).some(
              (item) => item.id === column.id && item.type === "page",
            )
          )
            return;
          onChange?.({
            ...latest,
            columns: !editable
              ? latest.columns
              : (latest.columns as DatabaseColumn[]).map((item) =>
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
              message:
                reason instanceof Error ? reason.message : String(reason),
            }),
          );
        }
      })
      .finally(() => linkingPages.current.delete(key));
  };
  useEffect(() => {
    for (const [id, field] of pendingRowPages.current) {
      if (!rows.some((row) => row.id === id)) continue;
      pendingRowPages.current.delete(id);
      const column = pageColumns.find((item) => item.id === field);
      if (column && canCreatePages) createLinkedPage(id, column);
    }
  }, [rows, columns, canCreatePages]);
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
      } else if (
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
    const first = sorts[0];
    changeCurrent({
      sorts:
        first?.column === column
          ? first.direction === "asc"
            ? [{ column, direction: "desc" }]
            : []
          : [{ column, direction: "asc" }],
    });
    setPage(0);
  };
  const columnProblem = (column: DatabaseColumn): string => {
    if (column.type === "relation" && !column.relation?.dataset)
      return tf("error.relationTarget", { name: column.name });
    if (column.type === "formula" && !column.formula?.expression.trim())
      return tf("error.formula", { name: column.name });
    if (
      column.type === "rollup" &&
      (!column.rollup?.relation ||
        (column.rollup.aggregate !== "count" && !column.rollup.column))
    )
      return tf("error.rollup", { name: column.name });
    return "";
  };
  const addProperty = (column: DatabaseColumn) => {
    const problem = columnProblem(column);
    if (problem) return problem;
    const derivedColumn = isDerivedColumn(column);
    onChange?.({
      ...data,
      columns: [...columns, column],
      rows: rows.map((row) =>
        sources?.has(row.id) || derivedColumn
          ? row
          : { ...row, [column.id]: typeOf(column).blank() as DatabaseValue },
      ),
    });
    return "";
  };
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
    columns: visibleColumns.map((column, index) => ({
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
  const tableReorder = usePropertyReorder<HTMLDivElement>({
    ids: visibleColumns.map((column) => column.id),
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
  const columnById = new Map(
    visibleColumns.map((column) => [column.id, column]),
  );
  const tableColumns = tableReorder.orderedIds
    .map((id) => columnById.get(id))
    .filter((column): column is DatabaseColumn => !!column);
  const draftById = new Map(draftColumns.map((column) => [column.id, column]));
  const settingsColumns = settingsReorder.orderedIds
    .map((id) => draftById.get(id))
    .filter((column): column is DatabaseColumn => !!column);
  const addView = (copy: boolean) => {
    if (views.length >= MAX_DATABASE_VIEWS) return;
    const created: DatabaseView = copy
      ? duplicateDatabaseView(
          view === "calendar"
            ? { ...current, calendar: savedCalendar }
            : current,
          views,
          (name) => t("copyName", { name }),
        )
      : {
          id: newViewId(views),
          name: viewName("table"),
          type: "table",
        };
    writeViews([...views, created]);
    selectView(created.id);
  };
  const removeView = () => {
    if (views.length < 2) return;
    const index = views.findIndex((item) => item.id === savedView.id);
    const remaining = views.filter((item) => item.id !== savedView.id);
    writeViews(remaining);
    selectView(remaining[Math.max(0, index - 1)].id);
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
        ...structuredClone(column),
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
    const problem = draftColumns.map(columnProblem).find(Boolean);
    if (problem) {
      setError(problem);
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
    })) as DatabaseColumn[];
    const before = new Map(columns.map((column) => [column.id, column]));
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
                cleaned.flatMap((column) => {
                  if (isDerivedColumn(column)) return [];
                  const previous = row[column.id];
                  const type = typeOf(column);
                  if (type.unknown || column.type === "custom")
                    return previous === undefined
                      ? []
                      : [[column.id, previous]];
                  const same =
                    typeKey(before.get(column.id) ?? column) ===
                    typeKey(column);
                  return [
                    [
                      column.id,
                      same &&
                      previous !== undefined &&
                      !type.check(previous, column)
                        ? previous
                        : previous === undefined || previous === ""
                          ? type.blank()
                          : type.normalize(previous, column),
                    ],
                  ];
                }),
              ),
            },
      ),
    };
    const calendarConfig = pruneCalendarConfig(
      data.calendar ? defaultCalendar : undefined,
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
    setEditing(false);
  };
  const updateDraftColumn = (column: DatabaseColumn) =>
    setDraftColumns((current) =>
      current.map((item) => (item.id === column.id ? column : item)),
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
  const readCell = (row: DatabaseRow, column: DatabaseColumn) => (
    <Cell row={row} column={column} editable={false} update={() => undefined} />
  );
  const cellText = (row: DatabaseRow, column: DatabaseColumn) =>
    typeOf(column).text(derived.value(row, column), column, context);
  const rowName = (row: DatabaseRow) =>
    (titleColumn ? cellText(row, titleColumn) : "") || t("untitled");
  const choices = (column: DatabaseColumn) => {
    if (column.type === "relation" && column.relation?.dataset) {
      const table = host?.related(column.relation.dataset);
      if (table)
        return table.rows.map((record) => ({
          id: record.id,
          label: recordTitle(record, table.columns),
        }));
      const ids = [
        ...new Set(
          rows.flatMap((row) => {
            const value = derived.value(row, column);
            return Array.isArray(value) ? (value as string[]) : [];
          }),
        ),
      ];
      const titles = derived.recordTitles(column, ids) ?? ids;
      return ids.map((id, index) => ({ id, label: titles[index] }));
    }
    const values = new Set(column.options ?? []);
    for (const row of rows) {
      const value = row[column.id];
      for (const item of Array.isArray(value) ? value : [value])
        if (typeof item === "string" && item) values.add(item);
    }
    return [...values].map((value) => ({ id: value, label: value }));
  };
  const environment: CellEnvironment = {
    derived,
    host,
    pages,
    openRecord: pages?.openRecord ? openRecord : undefined,
  };
  const recordProperties = (row: DatabaseRow) => (
    <div
      className="sb-block sb-database-record-properties"
      aria-label={t("property")}
    >
      {shownColumns.map((column) => (
        <div className="sb-record-property" key={column.id}>
          <span className="sb-record-property-name">
            <span aria-hidden="true">{fieldUiOf(column).symbol}</span>
            {column.name}
          </span>
          <div>{cell(row, column)}</div>
        </div>
      ))}
    </div>
  );
  const View = viewDefinition.View;
  return (
    <CellEnvironmentContext.Provider value={environment}>
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
                toCsv(shownColumns, shownRows, cellText),
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
                {databaseViews().map(({ type, label, Icon }) => (
                  <button
                    key={type}
                    type="button"
                    className={view === type ? "is-active" : ""}
                    onClick={() => {
                      changeCurrent({ type: type as DatabaseViewType });
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
                    setSelection(null);
                    setQuery(value);
                    setPage(0);
                  }}
                />
                <button
                  type="button"
                  className={`sb-icon-button ${showFilter || filter || sorts.length ? "is-active" : ""}`}
                  aria-label={t("filterDatabase")}
                  aria-expanded={showFilter}
                  onClick={() => setShowFilter(!showFilter)}
                >
                  <Filter size={15} />
                </button>
                {rowsEditable && (
                  <button
                    type="button"
                    className="sb-icon-button"
                    aria-label={t("bulkEdit")}
                    title={t("bulkEdit")}
                    aria-pressed={!!selection}
                    onClick={() => setSelection(selection ? null : new Set())}
                  >
                    <CheckSquare size={15} />
                  </button>
                )}
                {rowsEditable && (
                  <button
                    type="button"
                    className="sb-button sb-primary sb-small"
                    disabled={!canAdd}
                    onClick={() => addRow()}
                  >
                    <Plus size={14} />
                    {t("newRecord")}
                  </button>
                )}
              </div>
              {viewEditable && (
                <div className="sb-board-grouping sb-view-settings">
                  {views.length > 1 && (
                    <input
                      className="showai-input"
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
                    disabled={views.length >= MAX_DATABASE_VIEWS}
                    onClick={() => addView(false)}
                  >
                    <Plus size={13} aria-hidden="true" />
                    {t("newView")}
                  </button>
                  <button
                    type="button"
                    className="sb-text-button"
                    disabled={views.length >= MAX_DATABASE_VIEWS}
                    onClick={() => addView(true)}
                  >
                    <Copy size={13} aria-hidden="true" />
                    {t("duplicateView")}
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
              {viewEditable && (
                <details className="sb-visible-fields">
                  <summary>
                    <Eye size={14} aria-hidden="true" />
                    {t("visibleFields")}
                  </summary>
                  <div>
                    {shownColumns.map((column) => (
                      <label key={column.id}>
                        <input
                          className="showai-checkbox"
                          type="checkbox"
                          checked={
                            column.id === titleColumn?.id ||
                            !hidden.has(column.id)
                          }
                          disabled={column.id === titleColumn?.id}
                          onChange={(event) =>
                            changeCurrent({
                              hiddenColumns: event.target.checked
                                ? [...hidden].filter((id) => id !== column.id)
                                : [...hidden, column.id],
                            })
                          }
                        />
                        {column.name}
                      </label>
                    ))}
                  </div>
                </details>
              )}
              {view === "board" && groupable.length > 0 && (
                <div className="sb-board-grouping">
                  <span>{t("groupBy")}</span>
                  <select
                    className="showai-select"
                    aria-label={t("boardGroupProperty")}
                    value={groupColumn?.id ?? ""}
                    onChange={(event) =>
                      changeCurrent({ groupBy: event.target.value })
                    }
                  >
                    {!groupColumn && <option value="">{t("notSet")}</option>}
                    {groupable.map((column) => (
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
                  ).map(([key, label, options, optional]) =>
                    options.length > (optional ? 0 : 1) ? (
                      <label key={key}>
                        <span>{t(label)}</span>
                        <select
                          className="showai-select"
                          value={calendar[key]?.id ?? ""}
                          onChange={(event) => {
                            const next = { ...savedCalendar };
                            if (event.target.value || key === "colorColumn")
                              next[key] = event.target.value;
                            else delete next[key];
                            changeCurrent({
                              calendar: pruneCalendarConfig(next, columns),
                            });
                          }}
                        >
                          {optional && (
                            <option value="">{t("calendar.none")}</option>
                          )}
                          {options.map((column) => (
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
              const Icon = databaseView(item.type).Icon;
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
                    if (
                      event.altKey ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.shiftKey ||
                      event.nativeEvent.isComposing
                    )
                      return;
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
                  className="showai-input"
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
                      className="showai-input"
                      aria-label={t("propertyName")}
                      value={column.name}
                      onChange={(event) =>
                        updateDraftColumn({
                          ...column,
                          name: event.target.value,
                        })
                      }
                    />
                    <ColumnSettings
                      column={column}
                      columns={[
                        ...draftColumns,
                        ...shownColumns.slice(columns.length),
                      ]}
                      contributed={contributed}
                      onChange={updateDraftColumn}
                    />
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
        {showFilter && shownColumns.length > 0 && (
          <DatabaseQueryEditor
            columns={shownColumns}
            filter={filter}
            sorts={sorts}
            context={context}
            choices={choices}
            onFilter={(next: FilterGroup | undefined) => {
              setSelection(null);
              changeCurrent({ filter: next });
              setPage(0);
            }}
            onSorts={(next: RecordSort[]) => {
              changeCurrent({ sorts: next });
              setPage(0);
            }}
          />
        )}
        {addingProperty && editable && view === "table" && (
          <AddProperty
            columns={shownColumns}
            contributed={contributed}
            onAdd={addProperty}
            onClose={() => {
              setAddingProperty(false);
              addPropertyButton.current?.focus();
            }}
          />
        )}
        {rowsEditable && selection && (
          <DatabaseBulkEdit
            count={selectedRows.length}
            total={shownRows.length}
            columns={bulkColumns}
            all={() => toggleAll(true)}
            clear={() => setSelection(null)}
            apply={bulkApply}
            renderValue={(column, draft, change) => (
              <Cell
                column={column}
                row={{
                  id: "bulk-draft",
                  [column.id]:
                    draft ?? (typeOf(column).blank() as DatabaseValue),
                }}
                editable
                update={change}
              />
            )}
          />
        )}
        {rowsEditable && lastBulk && (
          <div className="sb-record-notice" role="status">
            {bulkError
              ? t("bulkChanged")
              : t("bulkUpdated", { count: lastBulk.before.size })}
            {!bulkError && (
              <button
                type="button"
                className="sb-text-button"
                onClick={undoBulk}
              >
                {t("bulkUndo")}
              </button>
            )}
            <button
              type="button"
              className="sb-icon-button"
              aria-label={t("dismiss")}
              onClick={() => {
                setLastBulk(null);
                setBulkError(false);
              }}
            >
              <X size={14} />
            </button>
          </div>
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
            <View
              view={current}
              columns={visibleColumns}
              titleColumn={titleColumn}
              openRow={activateRow}
              selection={selectionProps}
              titleCell={(row, showCheckbox) => (
                <span className="sb-record-leading">
                  {selectionProps &&
                    (showCheckbox || selectionProps.active) && (
                      <SelectRecords
                        checked={selectionProps.selected.has(row.id)}
                        label={t("selectRecord", { name: rowName(row) })}
                        onChange={() => toggleRow(row)}
                      />
                    )}
                  <RecordTitle
                    selected={selection?.has(row.id)}
                    name={rowName(row)}
                    open={() => activateRow(row)}
                    editor={
                      !selection &&
                      titleColumn &&
                      cellEditable(row, titleColumn) &&
                      !isDerivedColumn(titleColumn)
                        ? cell(row, titleColumn)
                        : undefined
                    }
                  />
                </span>
              )}
              rows={rows}
              shownRows={shownRows}
              pagedRows={pagedRows}
              editable={editable}
              canAdd={canAdd}
              sources={sources}
              cell={selection ? readCell : cell}
              readCell={readCell}
              cellEditable={cellEditable}
              deleteButton={deleteButton}
              rowName={rowName}
              addRow={addRow}
              updateFields={updateFields}
              removeRow={removeRow}
              board={{
                column: groupColumn,
                groups: groupNames,
                groupsOf: (row) =>
                  groupColumn ? groupKeys(row, groupColumn, context) : [""],
                label: groupLabel,
                move: (row, from, to) => {
                  if (!groupColumn || from === to) return;
                  updateRow(
                    row.id,
                    groupColumn.id,
                    typeOf(groupColumn).regroup!(
                      row[groupColumn.id],
                      from,
                      to,
                    ) as DatabaseValue,
                  );
                },
              }}
              table={{
                sorts,
                toggleSort,
                resize: columnResize,
                reorder: tableReorder,
                orderedColumns: tableColumns,
                addingProperty,
                toggleAddProperty: () => setAddingProperty(!addingProperty),
                addPropertyButton,
              }}
              calendar={{
                settings: calendar,
                labels: (row) =>
                  visibleColumns
                    .filter(
                      (column) =>
                        !calendarLabels.some(
                          (label) => label?.id === column.id,
                        ),
                    )
                    .map((column) => {
                      const value = cellText(row, column);
                      return value ? { name: column.name, value } : null;
                    })
                    .filter((item) => item !== null),
                savedKey: JSON.stringify([savedView.id, savedCalendar]),
                changeMode: viewEditable
                  ? (mode) =>
                      changeCurrent({ calendar: { ...savedCalendar, mode } })
                  : undefined,
              }}
            />
          </div>
        </div>
        {outsideRow && (
          <div role="status" className="sb-record-notice">
            {t("outsideView")}
            <button
              type="button"
              className="sb-text-button"
              onClick={() => openRow(outsideRow)}
            >
              {t("openRecord", { name: rowName(outsideRow) })}
            </button>
            <button
              type="button"
              className="sb-icon-button"
              aria-label={t("dismiss")}
              onClick={() => setCreatedRowId(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
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
            {sorts.length > 0 && (
              <button
                type="button"
                className="sb-text-button"
                onClick={() => changeCurrent({ sorts: [] })}
              >
                {t("clearSort")}
              </button>
            )}
          </span>
          {viewDefinition.paged && totalPages > 1 && (
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
        createPortal(recordProperties(peekRow), peek.propertiesHost)}
      {localRow &&
        createPortal(
          <RecordDialog
            title={rowName(localRow)}
            close={() => setLocalRecordId(null)}
            actions={
              <>
                <button
                  type="button"
                  className="sb-icon-button"
                  aria-label={t("previousRecord")}
                  disabled={localIndex <= 0}
                  onClick={() => openRow(shownRows[localIndex - 1])}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="sb-icon-button"
                  aria-label={t("nextRecord")}
                  disabled={
                    localIndex < 0 || localIndex >= shownRows.length - 1
                  }
                  onClick={() => openRow(shownRows[localIndex + 1])}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="sb-icon-button"
                  aria-label={t("closeRecord")}
                  onClick={() => setLocalRecordId(null)}
                >
                  <X size={16} />
                </button>
              </>
            }
          >
            {recordProperties(localRow)}
          </RecordDialog>,
          document.body,
        )}
    </CellEnvironmentContext.Provider>
  );
}
