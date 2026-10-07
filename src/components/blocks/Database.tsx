import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns3,
  Download,
  ExternalLink,
  Filter,
  LayoutList,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from "../../ui/icons";
import {
  downloadFile,
  filterSortRows,
  safeUrl,
  text,
  toCsv,
  uid,
} from "./helpers";
import { BlockHeader, EmptyState, Field } from "./shared";
import type {
  BlockProps,
  ColumnType,
  DatabaseColumn,
  DatabaseRow,
} from "./types";

const TYPES: { value: ColumnType; label: string }[] = [
  { value: "text", label: "文本" },
  { value: "number", label: "数字" },
  { value: "select", label: "单选" },
  { value: "checkbox", label: "复选框" },
  { value: "url", label: "链接" },
];
const TYPE_SYMBOL: Record<ColumnType, string> = {
  text: "Aa",
  number: "#",
  select: "◉",
  checkbox: "☑",
  url: "↗",
};

function Cell({
  row,
  column,
  editable,
  update,
}: {
  row: DatabaseRow;
  column: DatabaseColumn;
  editable: boolean;
  update: (value: string | number | boolean) => void;
}) {
  const value = row[column.id];
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
        <option value="">未设置</option>
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
          column.type === "number"
            ? "number"
            : column.type === "url"
              ? "url"
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
          aria-label={`打开${column.name}`}
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

export function DatabaseBlock({ data, onChange, readOnly }: BlockProps) {
  const columns: DatabaseColumn[] = useMemo(
    () =>
      Array.isArray(data.columns)
        ? data.columns
            .filter((column) => column && typeof column.id === "string")
            .map((column) => ({
              id: column.id,
              name: text(column.name, "属性"),
              type: TYPES.some((type) => type.value === column.type)
                ? column.type
                : "text",
              options: Array.isArray(column.options)
                ? column.options.map((option: unknown) => text(option))
                : [],
            }))
        : [],
    [data.columns],
  );
  const rows: DatabaseRow[] = Array.isArray(data.rows)
    ? data.rows.filter((row) => row && typeof row.id === "string")
    : [];
  const [view, setView] = useState<"table" | "board">("table");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [filter, setFilter] = useState({ column: "", value: "" });
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftColumns, setDraftColumns] = useState<DatabaseColumn[]>([]);
  const [error, setError] = useState("");
  const [grouping, setGrouping] = useState(text(data.groupBy));
  const [page, setPage] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const editable = Boolean(onChange && !readOnly);
  const selectColumns = columns.filter((column) => column.type === "select");
  const groupColumn =
    columns.find(
      (column) => column.id === grouping && column.type === "select",
    ) ?? selectColumns[0];
  const shownRows = filterSortRows(rows, columns, query, filter, sort);
  const pageSize = 30,
    totalPages = Math.max(1, Math.ceil(shownRows.length / pageSize)),
    activePage = Math.min(page, totalPages - 1);
  const options = filter.column
    ? Array.from(new Set(rows.map((row) => String(row[filter.column] ?? ""))))
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
  const updateRow = (
    id: string,
    column: string,
    value: string | number | boolean,
  ) =>
    onChange?.({
      ...data,
      rows: rows.map((row) =>
        row.id === id ? { ...row, [column]: value } : row,
      ),
    });
  const addRow = (group?: string) => {
    const row: DatabaseRow = {
      id: uid(),
      ...Object.fromEntries(
        columns.map((column) => [
          column.id,
          column.type === "checkbox" ? false : "",
        ]),
      ),
    };
    if (groupColumn && group !== undefined) row[groupColumn.id] = group;
    onChange?.({ ...data, rows: [...rows, row] });
    setPage(Math.floor(rows.length / pageSize));
    setQuery("");
    setFilter({ column: "", value: "" });
  };
  const removeRow = (id: string) =>
    onChange?.({ ...data, rows: rows.filter((row) => row.id !== id) });
  const toggleSort = (column: string) => {
    setSort((current) =>
      current?.column === column
        ? current.direction === "asc"
          ? { column, direction: "desc" }
          : null
        : { column, direction: "asc" },
    );
    setPage(0);
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
      setError("请至少保留一个属性。");
      return;
    }
    if (draftColumns.some((column) => !column.name.trim())) {
      setError("请为每个属性填写名称。");
      return;
    }
    const cleaned = draftColumns.map((column) => ({
      ...column,
      name: column.name.trim(),
      options: [
        ...new Set(
          (column.options ?? []).map((option) => option.trim()).filter(Boolean),
        ),
      ],
    }));
    onChange?.({
      ...data,
      title: draftTitle,
      columns: cleaned,
      rows: rows.map((row) => ({
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
                  : text(previous);
            return [column.id, value];
          }),
        ),
      })),
    });
    if (!cleaned.some((column) => column.id === filter.column))
      setFilter({ column: "", value: "" });
    setEditing(false);
  };
  const updateDraftColumn = (id: string, changes: Partial<DatabaseColumn>) =>
    setDraftColumns((current) =>
      current.map((column) =>
        column.id === id ? { ...column, ...changes } : column,
      ),
    );
  return (
    <section
      className="sb-block sb-database"
      aria-label={text(data.title) || "数据库"}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle="数据库"
        icon={<Table2 size={17} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label="导出数据库"
          title="导出 CSV"
          onClick={() =>
            downloadFile(
              toCsv(columns, shownRows),
              `${text(data.title, "数据库")}.csv`,
              "text/csv;charset=utf-8",
            )
          }
        >
          <Download size={15} />
        </button>
        <details className="sb-tools-menu">
          <summary aria-label="数据库视图与筛选">
            <Filter size={14} aria-hidden="true" />
            视图与筛选
          </summary>
          <div className="sb-database-toolbar">
            <div className="sb-view-tabs">
              <button
                type="button"
                className={view === "table" ? "is-active" : ""}
                onClick={() => setView("table")}
              >
                <Table2 size={14} />
                表格
              </button>
              <button
                type="button"
                className={view === "board" ? "is-active" : ""}
                onClick={() => setView("board")}
              >
                <Columns3 size={14} />
                看板
              </button>
            </div>
            <div className="sb-database-tools">
              <label className="sb-search">
                <Search size={14} />
                <input
                  aria-label="搜索数据库"
                  placeholder="搜索…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
                {query && (
                  <button
                    type="button"
                    className="sb-icon-button"
                    aria-label="清除搜索"
                    onClick={() => setQuery("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </label>
              <button
                type="button"
                className={`sb-icon-button ${showFilter || filter.column ? "is-active" : ""}`}
                aria-label="筛选数据库"
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
                  新建
                </button>
              )}
            </div>
            {view === "board" && selectColumns.length > 0 && (
              <div className="sb-board-grouping">
                <span>分组依据</span>
                <select
                  aria-label="看板分组属性"
                  value={groupColumn?.id ?? ""}
                  onChange={(event) => setGrouping(event.target.value)}
                >
                  {selectColumns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </details>
      </BlockHeader>
      {editing && (
        <div className="sb-editor-panel">
          <Field label="数据库名称">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
            />
          </Field>
          <div className="sb-property-list">
            {draftColumns.map((column) => (
              <div className="sb-property-row" key={column.id}>
                <input
                  aria-label="属性名称"
                  value={column.name}
                  onChange={(event) =>
                    updateDraftColumn(column.id, { name: event.target.value })
                  }
                />
                <select
                  aria-label={`${column.name}的类型`}
                  value={column.type}
                  onChange={(event) =>
                    updateDraftColumn(column.id, {
                      type: event.target.value as ColumnType,
                    })
                  }
                >
                  {TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                {column.type === "select" && (
                  <input
                    className="sb-options-input"
                    aria-label={`${column.name}的选项，用逗号分隔`}
                    placeholder="选项，用逗号分隔"
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
                  aria-label={`删除属性${column.name}`}
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
                  { id: uid(), name: "新属性", type: "text" },
                ])
              }
            >
              <Plus size={14} />
              添加属性
            </button>
            <button
              type="button"
              className="sb-button sb-primary"
              onClick={saveColumns}
            >
              <Check size={14} />
              保存属性
            </button>
          </div>
        </div>
      )}
      {showFilter && (
        <div className="sb-filter-row">
          <Filter size={13} />
          <select
            aria-label="筛选属性"
            value={filter.column}
            onChange={(event) => {
              const column = event.target.value;
              setFilter({
                column,
                value: column ? String(rows[0]?.[column] ?? "") : "",
              });
              setPage(0);
            }}
          >
            <option value="">全部记录</option>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
          {filter.column && (
            <>
              <span>等于</span>
              <select
                aria-label="筛选值"
                value={filter.value}
                onChange={(event) => {
                  setFilter((current) => ({
                    ...current,
                    value: event.target.value,
                  }));
                  setPage(0);
                }}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option || "未设置"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sb-text-button"
                onClick={() => setFilter({ column: "", value: "" })}
              >
                清除
              </button>
            </>
          )}
        </div>
      )}
      {view === "table" ? (
        <>
          <div className="sb-table-scroll">
            <table className="sb-database-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.id}>
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                      >
                        <span className="sb-type-symbol">
                          {TYPE_SYMBOL[column.type]}
                        </span>
                        {column.name}
                        {sort?.column === column.id &&
                          (sort.direction === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          ))}
                      </button>
                    </th>
                  ))}
                  {editable && (
                    <th className="sb-row-action" aria-label="行操作" />
                  )}
                </tr>
              </thead>
              <tbody>
                {shownRows
                  .slice(activePage * pageSize, (activePage + 1) * pageSize)
                  .map((row) => (
                    <tr key={row.id}>
                      {columns.map((column) => (
                        <td key={column.id}>
                          <Cell
                            row={row}
                            column={column}
                            editable={editable}
                            update={(value) =>
                              updateRow(row.id, column.id, value)
                            }
                          />
                        </td>
                      ))}
                      {editable && (
                        <td className="sb-row-action">
                          <button
                            type="button"
                            className="sb-icon-button sb-danger"
                            aria-label={`删除记录${text(row[columns[0]?.id])}`}
                            onClick={() => removeRow(row.id)}
                          >
                            <Trash2 size={13} />
                          </button>
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
              title={rows.length ? "没有符合条件的记录" : "从第一条记录开始"}
              description={
                rows.length
                  ? "尝试调整搜索或筛选条件。"
                  : "添加记录，也可以在区块设置中定义属性。"
              }
            />
          )}
        </>
      ) : (
        <>
          {!groupColumn && (
            <p className="sb-inline-hint">
              添加一个「单选」属性，即可按选项分组。
            </p>
          )}
          <div className="sb-board">
            {groupNames.map((group, groupIndex) => {
              const groupRows = groupColumn
                ? shownRows.filter((row) => text(row[groupColumn.id]) === group)
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
                      {group || (groupColumn ? "未设置" : "全部记录")}
                    </span>
                    <span>{groupRows.length}</span>
                    {editable && (
                      <button
                        type="button"
                        className="sb-icon-button"
                        aria-label={`在${group || "未设置"}中新建记录`}
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
                            <Cell
                              row={row}
                              column={column}
                              editable={editable}
                              update={(value) =>
                                updateRow(row.id, column.id, value)
                              }
                            />
                          </div>
                        ))}
                      {editable && (
                        <div className="sb-board-card-footer">
                          {groupColumn && (
                            <select
                              aria-label="移动到分组"
                              value={text(row[groupColumn.id])}
                              onChange={(event) =>
                                updateRow(
                                  row.id,
                                  groupColumn.id,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">未设置</option>
                              {groupNames.filter(Boolean).map((name) => (
                                <option key={name}>{name}</option>
                              ))}
                            </select>
                          )}
                          <button
                            type="button"
                            className="sb-icon-button sb-danger"
                            aria-label="删除记录"
                            onClick={() => removeRow(row.id)}
                          >
                            <Trash2 size={13} />
                          </button>
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
                      新记录
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <div className="sb-database-footer">
        <span>
          {shownRows.length === rows.length
            ? `${rows.length} 条记录`
            : `${shownRows.length} / ${rows.length} 条记录`}
          {sort && (
            <button
              type="button"
              className="sb-text-button"
              onClick={() => setSort(null)}
            >
              清除排序
            </button>
          )}
        </span>
        {view === "table" && totalPages > 1 && (
          <div className="sb-pagination">
            <button
              type="button"
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              上一页
            </button>
            <span>
              {activePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={activePage + 1 === totalPages}
              onClick={() => setPage(activePage + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
