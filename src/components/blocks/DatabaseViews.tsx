// The database's views. Each view registers one definition: its name, icon,
// whether it pages its records, and how it lays out the records the query
// already filtered and sorted. A later view (timeline, gallery) plugs in
// through registerDatabaseView with the same props.
import { useState, type ReactNode, type RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  LayoutDashboard,
  LayoutList,
  List,
  Plus,
  Table2,
} from "../../ui/icons";
import { EmptyState } from "./shared";
import { DatabaseCalendar } from "./DatabaseCalendar";
import { ROW_ACTION_WIDTH, columnWidth } from "./database-views";
import type { usePropertyReorder } from "./database-reorder";
import type { useColumnResize } from "./database-column-resize";
import { fieldUiOf, optionClass } from "./database-field-ui";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";
import type { BlockItemSource } from "./action-host";
import type { RecordSort } from "../../datasets/record-query.mjs";
import type {
  DatabaseColumn,
  DatabaseRow,
  DatabaseValue,
  DatabaseView,
} from "./types";
import type { resolveCalendar } from "./DatabaseCalendar";

/** What every view receives from the database. */
export interface DatabaseViewProps {
  view: DatabaseView;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  /** Records after search, filter and sort. */
  shownRows: DatabaseRow[];
  /** The current page of shownRows, for views that page. */
  pagedRows: DatabaseRow[];
  editable: boolean;
  sources: ReadonlyMap<string, BlockItemSource> | null;
  cell: (row: DatabaseRow, column: DatabaseColumn) => ReactNode;
  /** A cell shown read-only, e.g. the properties under a list item. */
  readCell: (row: DatabaseRow, column: DatabaseColumn) => ReactNode;
  cellEditable: (row: DatabaseRow, column: DatabaseColumn) => boolean;
  deleteButton: (row: DatabaseRow, label: string) => ReactNode;
  rowName: (row: DatabaseRow) => string;
  addRow: (group?: string, preset?: Record<string, DatabaseValue>) => string;
  updateFields: (id: string, values: Record<string, DatabaseValue>) => void;
  removeRow: (id: string) => void;
  board: {
    column?: DatabaseColumn;
    groups: string[];
    groupsOf: (row: DatabaseRow) => string[];
    label: (group: string) => string;
    move: (row: DatabaseRow, from: string, to: string) => void;
  };
  table: {
    sorts: RecordSort[];
    toggleSort: (column: string) => void;
    resize: ReturnType<typeof useColumnResize>;
    reorder: ReturnType<typeof usePropertyReorder<HTMLDivElement>>;
    orderedColumns: DatabaseColumn[];
    addingProperty: boolean;
    toggleAddProperty: () => void;
    addPropertyButton: RefObject<HTMLButtonElement | null>;
  };
  calendar: {
    settings: ReturnType<typeof resolveCalendar>;
    savedKey: string;
  };
}
export interface DatabaseViewDefinition {
  type: string;
  label: MessageKey<typeof messages>;
  Icon: typeof Table2;
  /** Views that page show 30 records at a time. */
  paged: boolean;
  View: (props: DatabaseViewProps) => ReactNode;
}

const registry = new Map<string, DatabaseViewDefinition>();
export function registerDatabaseView(definition: DatabaseViewDefinition) {
  registry.set(definition.type, definition);
}
export function databaseView(type: string): DatabaseViewDefinition {
  return registry.get(type) ?? registry.get("table")!;
}
export function databaseViews(): DatabaseViewDefinition[] {
  return [...registry.values()];
}

function TableView(props: DatabaseViewProps) {
  const t = useTranslator(messages);
  const { view, columns, pagedRows, shownRows, rows, editable, table } = props;
  const sort = table.sorts[0];
  const width = (column: DatabaseColumn) =>
    columnWidth(view, column.id, columns.indexOf(column));
  return (
    <>
      <div
        className="sb-table-scroll"
        ref={table.reorder.container}
        {...table.reorder.containerProps}
      >
        <table
          className="sb-database-table"
          ref={table.resize.table}
          style={{
            width:
              columns.reduce((sum, column) => sum + width(column), 0) +
              (editable ? ROW_ACTION_WIDTH : 0),
          }}
        >
          <colgroup>
            {table.orderedColumns.map((column) => (
              <col
                key={column.id}
                data-column-width-id={column.id}
                style={{ width: width(column) }}
              />
            ))}
            {editable && <col />}
          </colgroup>
          <thead>
            <tr>
              {table.orderedColumns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  {...table.reorder.itemProps(column.id)}
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
                    onClick={() => table.toggleSort(column.id)}
                    title={editable ? t("propertyHeaderHint") : undefined}
                    {...table.reorder.handleProps(column.id)}
                  >
                    <span className="sb-type-symbol">
                      {fieldUiOf(column).symbol}
                    </span>
                    <span className="sb-column-name">{column.name}</span>
                    {sort?.column === column.id &&
                      (sort.direction === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      ))}
                  </button>
                  {editable && (
                    <div
                      {...table.resize.handleProps(column.id)}
                      className="sb-column-resize"
                      data-resizing={
                        table.resize.resizing === column.id || undefined
                      }
                      aria-label={t("resizeProperty", { name: column.name })}
                      title={t("columnResizeHint")}
                    />
                  )}
                </th>
              ))}
              {editable && (
                <th className="sb-row-action">
                  <button
                    ref={table.addPropertyButton}
                    type="button"
                    className="sb-add-property"
                    aria-label={t("addProperty")}
                    title={t("addProperty")}
                    aria-expanded={table.addingProperty}
                    onClick={table.toggleAddProperty}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => (
              <tr key={row.id} title={props.sources?.get(row.id)?.label}>
                {table.orderedColumns.map((column) => (
                  <td key={column.id} {...table.reorder.cellProps(column.id)}>
                    {props.cell(row, column)}
                  </td>
                ))}
                {editable && (
                  <td className="sb-row-action">
                    {props.deleteButton(
                      row,
                      t("deleteNamedRecord", { name: props.rowName(row) }),
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
          title={rows.length ? t("empty.noMatches") : t("empty.start")}
        />
      )}
    </>
  );
}

const isBlank = (value: unknown) =>
  value === "" ||
  value === undefined ||
  value === null ||
  value === false ||
  (Array.isArray(value) && !value.length);

function ListView(props: DatabaseViewProps) {
  const t = useTranslator(messages);
  const { columns, pagedRows, shownRows, rows, editable } = props;
  return (
    <>
      <ul className="sb-database-list">
        {pagedRows.map((row) => (
          <li key={row.id} title={props.sources?.get(row.id)?.label}>
            {columns[0] && (
              <div className="sb-list-title">{props.cell(row, columns[0])}</div>
            )}
            <div className="sb-list-properties">
              {columns.slice(1).map((column) =>
                isBlank(row[column.id]) &&
                column.type !== "formula" &&
                column.type !== "rollup" &&
                !column.relation?.reverseOf ? null : (
                  <span className="sb-list-property" key={column.id}>
                    <span>{column.name}</span>
                    {props.readCell(row, column)}
                  </span>
                ),
              )}
            </div>
            {editable && (
              <span className="sb-row-action">
                {props.deleteButton(
                  row,
                  t("deleteNamedRecord", { name: props.rowName(row) }),
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
          onClick={() => props.addRow()}
        >
          <Plus size={13} />
          {t("addRecord")}
        </button>
      )}
      {shownRows.length === 0 && (
        <EmptyState
          icon={<List size={25} strokeWidth={1.4} />}
          title={rows.length ? t("empty.noMatches") : t("empty.start")}
        />
      )}
    </>
  );
}

function BoardView(props: DatabaseViewProps) {
  const t = useTranslator(messages);
  const { columns, shownRows, editable, board } = props;
  const [dragging, setDragging] = useState<{ id: string; from: string } | null>(
    null,
  );
  const group = board.column;
  return (
    <div className="sb-board">
      {board.groups.map((name, index) => {
        const groupRows = group
          ? shownRows.filter((row) => board.groupsOf(row).includes(name))
          : shownRows;
        return (
          <div
            className={`sb-board-column ${dragging ? "is-droppable" : ""}`}
            key={name}
            onDragOver={(event) => {
              if (editable && group && dragging) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!editable || !group || !dragging) return;
              event.preventDefault();
              const row = shownRows.find((item) => item.id === dragging.id);
              if (row) board.move(row, dragging.from, name);
              setDragging(null);
            }}
          >
            <div className="sb-board-column-header">
              <span
                className={
                  group?.type === "select" || group?.type === "multiSelect"
                    ? optionClass(group, name)
                    : `sb-tag sb-tag-${index % 5}`
                }
              >
                {group ? board.label(name) : t("allRecords")}
              </span>
              <span>{groupRows.length}</span>
              {editable && (
                <button
                  type="button"
                  className="sb-icon-button"
                  aria-label={t("newRecordIn", { group: board.label(name) })}
                  onClick={() => props.addRow(name)}
                >
                  <Plus size={14} />
                </button>
              )}
            </div>
            {groupRows.map((row) => (
              <div
                className={`sb-board-card ${dragging?.id === row.id ? "is-dragging" : ""}`}
                key={row.id}
                draggable={!!group && props.cellEditable(row, group)}
                onDragStart={() => setDragging({ id: row.id, from: name })}
                onDragEnd={() => setDragging(null)}
              >
                {columns
                  .filter((column) => column.id !== group?.id)
                  .map((column, position) => (
                    <div
                      key={column.id}
                      className={
                        position === 0
                          ? "sb-board-card-title"
                          : "sb-board-card-field"
                      }
                    >
                      {position > 0 && <span>{column.name}</span>}
                      {props.cell(row, column)}
                    </div>
                  ))}
                {editable && (
                  <div className="sb-board-card-footer">
                    {group && group.type !== "multiSelect" && (
                      <select
                        aria-label={t("moveToGroup")}
                        disabled={!props.cellEditable(row, group)}
                        value={name}
                        onChange={(event) =>
                          board.move(row, name, event.target.value)
                        }
                      >
                        {board.groups.map((option) => (
                          <option key={option} value={option}>
                            {board.label(option)}
                          </option>
                        ))}
                      </select>
                    )}
                    {props.deleteButton(row, t("deleteRecord"))}
                  </div>
                )}
              </div>
            ))}
            {editable && (
              <button
                type="button"
                className="sb-add-row"
                onClick={() => props.addRow(name)}
              >
                <Plus size={13} />
                {t("addRecord")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CalendarView(props: DatabaseViewProps) {
  const { calendar } = props;
  const date = calendar.settings.dateColumn;
  const end = calendar.settings.endDateColumn;
  return (
    <DatabaseCalendar
      key={calendar.savedKey}
      columns={props.columns}
      rows={props.shownRows}
      settings={calendar.settings}
      editable={props.editable}
      renderCell={props.cell}
      onMove={(id, start, until) =>
        props.updateFields(id, {
          [date!.id]: start,
          ...(until && end ? { [end.id]: until } : {}),
        })
      }
      onAdd={
        date ? (day) => props.addRow(undefined, { [date.id]: day }) : undefined
      }
      onRemove={props.removeRow}
    />
  );
}

registerDatabaseView({
  type: "table",
  label: "table",
  Icon: Table2,
  paged: true,
  View: TableView,
});
registerDatabaseView({
  type: "board",
  label: "board",
  Icon: Columns3,
  paged: false,
  View: BoardView,
});
registerDatabaseView({
  type: "list",
  label: "list",
  Icon: List,
  paged: true,
  View: ListView,
});
registerDatabaseView({
  type: "calendar",
  label: "calendar",
  Icon: LayoutDashboard,
  paged: false,
  View: CalendarView,
});
