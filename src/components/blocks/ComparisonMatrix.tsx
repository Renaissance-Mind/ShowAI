import { Fragment, useMemo, useState } from "react";
import type { BlockProps } from "./types";
import { differingRows } from "./analysis-contract.mjs";
import "./analysis.css";

type Tone = "yes" | "no" | "partial" | "neutral" | "na";
type Row = { id: string; label: string; hint?: string; group?: string };
type Column = {
  id: string;
  label: string;
  note?: string;
  url?: string;
  highlight?: boolean;
};
type Cell = {
  row: string;
  column: string;
  tone: Tone;
  text?: string;
  note?: string;
};
type Matrix = {
  title?: string;
  description?: string;
  rows: Row[];
  columns: Column[];
  cells: Cell[];
  legend?: Partial<Record<Tone, string>>;
};

const MARKS: Record<Tone, string> = {
  yes: "✓",
  no: "✕",
  partial: "◐",
  neutral: "•",
  na: "",
};
const LEGEND: Record<Tone, string> = {
  yes: "采用 / 满足",
  no: "不采用 / 不满足",
  partial: "部分或有改动",
  neutral: "中性说明",
  na: "未涉及",
};

export function ComparisonMatrixBlock({ data }: BlockProps) {
  const model = data as unknown as Matrix;
  const [focus, setFocus] = useState<string | null>(null);
  const [diffOnly, setDiffOnly] = useState(false);
  const cellMap = useMemo(
    () =>
      new Map(
        model.cells.map((cell) => [`${cell.row}\u0000${cell.column}`, cell]),
      ),
    [model.cells],
  );
  const differing = useMemo(() => new Set(differingRows(model)), [model]);
  const rows = diffOnly
    ? model.rows.filter((row) => differing.has(row.id))
    : model.rows;
  const tones = (Object.keys(MARKS) as Tone[]).filter((tone) =>
    model.cells.some((cell) => cell.tone === tone),
  );
  const notes = model.cells.filter((cell) => cell.note);
  const columnClass = (column: Column) =>
    [
      column.highlight ? "is-highlight" : "",
      focus === column.id ? "is-focus" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <section
      className="sb-block an-block"
      aria-label={model.title ?? "对比矩阵"}
    >
      <div className="an-head">
        {model.title && <h3 className="an-title">{model.title}</h3>}
        {model.description && <p className="an-sub">{model.description}</p>}
        <div className="an-tools">
          <button
            type="button"
            className="an-chip"
            aria-pressed={diffOnly}
            onClick={() => setDiffOnly((value) => !value)}
          >
            只看差异 {differing.size}/{model.rows.length}
          </button>
          {focus && (
            <button
              type="button"
              className="an-chip"
              onClick={() => setFocus(null)}
            >
              取消聚焦
            </button>
          )}
        </div>
      </div>
      <div className="an-matrix-scroll">
        <table className={`an-matrix${focus ? " has-focus" : ""}`}>
          <thead>
            <tr>
              <th className="an-rowhead" scope="col">
                维度
              </th>
              {model.columns.map((column) => (
                <th key={column.id} scope="col" className={columnClass(column)}>
                  <button
                    type="button"
                    className="an-col-button"
                    aria-pressed={focus === column.id}
                    onClick={() =>
                      setFocus(focus === column.id ? null : column.id)
                    }
                  >
                    {column.label}
                    {column.note && (
                      <span className="an-col-note">{column.note}</span>
                    )}
                  </button>
                  {column.url && (
                    <a
                      href={column.url}
                      target="_blank"
                      rel="noreferrer"
                      className="an-col-note"
                    >
                      来源 ↗
                    </a>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={model.columns.length + 1} className="an-empty">
                  所有维度在各列之间都相同。
                </td>
              </tr>
            )}
            {rows.map((row, index) => {
              const groupStart =
                row.group && row.group !== rows[index - 1]?.group;
              return (
                <Fragment key={row.id}>
                  {groupStart && (
                    <tr className="an-group-row">
                      <th colSpan={model.columns.length + 1} scope="rowgroup">
                        {row.group}
                      </th>
                    </tr>
                  )}
                  <tr>
                    <th className="an-rowhead" scope="row">
                      <div className="an-row-label">{row.label}</div>
                      {row.hint && (
                        <div className="an-row-hint">{row.hint}</div>
                      )}
                    </th>
                    {model.columns.map((column) => {
                      const cell = cellMap.get(`${row.id}\u0000${column.id}`);
                      const tone = cell?.tone ?? "na";
                      const noteIndex = cell?.note
                        ? notes.indexOf(cell) + 1
                        : 0;
                      return (
                        <td
                          key={column.id}
                          className={columnClass(column)}
                          title={cell?.note}
                        >
                          <span className={`an-cell an-tone-${tone}`}>
                            {MARKS[tone] && (
                              <b aria-hidden="true">{MARKS[tone]}</b>
                            )}
                            <span>
                              {cell?.text ??
                                (tone === "na"
                                  ? "—"
                                  : (model.legend?.[tone] ?? LEGEND[tone]))}
                            </span>
                          </span>
                          {noteIndex > 0 && (
                            <sup className="an-note-mark">{noteIndex}</sup>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="an-legend">
        {tones.map((tone) => (
          <span key={tone} className={`an-tone-${tone}`}>
            {MARKS[tone] ? <b>{MARKS[tone]}</b> : "—"}{" "}
            {model.legend?.[tone] ?? LEGEND[tone]}
          </span>
        ))}
        <span>点击列头可聚焦一列</span>
      </div>
      {notes.length > 0 && (
        <ol className="an-static" aria-label="注释">
          {notes.map((cell) => (
            <li key={`${cell.row}-${cell.column}`}>
              {model.columns.find((c) => c.id === cell.column)?.label} ·{" "}
              {model.rows.find((r) => r.id === cell.row)?.label}：{cell.note}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
