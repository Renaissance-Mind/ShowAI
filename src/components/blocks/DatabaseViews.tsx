import { useState, type ReactNode, type RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  LayoutDashboard,
  LayoutList,
  List,
  MoreHorizontal,
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

export interface DatabaseViewProps {
  view: DatabaseView;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  shownRows: DatabaseRow[];
  pagedRows: DatabaseRow[];
  editable: boolean;
  sources: ReadonlyMap<string, BlockItemSource> | null;
  cell: (row: DatabaseRow, column: DatabaseColumn) => ReactNode;
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
  const [titleColumn, ...properties] = columns.filter(
    (column) => column.id !== group?.id,
  );
  return (
    <div className="sb-board">
      {board.groups.map((name, index) => {
        const groupRows = group
          ? shownRows.filter((row) => board.groupsOf(row).includes(name))
          : shownRows;
        const emptyUnassigned =
          group && !name && !groupRows.length && board.groups.length > 1;
        if (emptyUnassigned && !editable) return null;
        const label = group ? board.label(name) : t("allRecords");
        const tone = !name
          ? "sb-tag sb-tone-gray"
          : group?.type === "select" || group?.type === "multiSelect"
            ? optionClass(group, name)
            : `sb-tag sb-tag-${index % 5}`;
        return (
          <section
            className={`sb-board-column ${dragging ? "is-droppable" : ""}`}
            aria-label={label}
            data-empty-unassigned={emptyUnassigned || undefined}
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
            <header className={`sb-board-column-header ${tone}`}>
              <span className="sb-board-group-label" title={label}>
                {label}
              </span>
              <span
                className="sb-board-count"
                aria-label={t("recordCount", { count: groupRows.length })}
              >
                {groupRows.length}
              </span>
              {editable && (
                <button
                  type="button"
                  className="sb-icon-button"
                  aria-label={t("newRecordIn", { group: label })}
                  onClick={() => props.addRow(name)}
                >
                  <Plus size={15} />
                </button>
              )}
            </header>
            {groupRows.map((row) => (
              <article
                aria-label={props.rowName(row) || t("untitled")}
                className={`sb-board-card ${dragging?.id === row.id ? "is-dragging" : ""}`}
                key={row.id}
                draggable={!!group && props.cellEditable(row, group)}
                onDragStart={() => setDragging({ id: row.id, from: name })}
                onDragEnd={() => setDragging(null)}
              >
                <div className="sb-board-card-title">
                  {titleColumn
                    ? props.cell(row, titleColumn)
                    : props.rowName(row) || t("untitled")}
                </div>
                {properties.length > 0 && (
                  <dl className="sb-board-card-properties">
                    {properties.map((column) => (
                      <div
                        key={column.id}
                        className="sb-board-card-field"
                        data-type={column.type}
                      >
                        <dt title={column.name}>{column.name}</dt>
                        <dd>{props.cell(row, column)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {editable && (
                  <details className="sb-board-card-actions">
                    <summary
                      className="sb-icon-button"
                      aria-label={t("recordActionsFor", {
                        name: props.rowName(row) || t("untitled"),
                      })}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </summary>
                    <div className="sb-board-card-footer">
                      {group && (
                        <select
                          className="showai-select"
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
                      {props.deleteButton(
                        row,
                        t("deleteNamedRecord", { name: props.rowName(row) }),
                      )}
                    </div>
                  </details>
                )}
              </article>
            ))}
            {editable && !emptyUnassigned && (
              <button
                type="button"
                className="sb-add-row"
                onClick={() => props.addRow(name)}
              >
                <Plus size={14} />
                {t("addRecord")}
              </button>
            )}
          </section>
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
