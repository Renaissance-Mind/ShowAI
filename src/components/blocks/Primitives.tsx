import { useState, type CSSProperties } from "react";
import { NativeInkPreview } from "../../surface/NativeInkPreview";
import "./katex.css";
import "./research-media.css";
import { safeImageUrl, text } from "./helpers";
import type { BlockProps } from "./types";
import { type MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/primitives";

import {
  validatePrimitiveData,
  tableColumnAlignment,
  alignTableData,
} from "./primitive-contract.mjs";
import { BasicTableControls, type TableAlignment } from "./TableAlignment";
export { validatePrimitiveData } from "./primitive-contract.mjs";

const appearance = (data: Record<string, unknown>): CSSProperties => ({
  color: text(data.color) || undefined,
  backgroundColor: text(data.backgroundColor) || undefined,
  fontSize: typeof data.fontSize === "number" ? data.fontSize : undefined,
  textAlign: ["left", "center", "right", "justify"].includes(text(data.align))
    ? (data.align as CSSProperties["textAlign"])
    : undefined,
  borderRadius: typeof data.radius === "number" ? data.radius : undefined,
  padding: typeof data.padding === "number" ? data.padding : undefined,
});

export { RichText as TextBlock } from "../rich-text/RichText";
import { RichText as TextBlock } from "../rich-text/RichText";

const imageFields: [string, MessageKey<typeof messages>][] = [
  ["src", "imageSrc"],
  ["alt", "imageAlt"],
  ["caption", "imageCaption"],
];

export function ImageBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  validatePrimitiveData("image", data);
  if (data.nativeInk)
    return (
      <NativeInkPreview
        ink={data.nativeInk as Parameters<typeof NativeInkPreview>[0]["ink"]}
      />
    );
  const src = safeImageUrl(data.src);
  return (
    <figure
      className="sb-primitive sb-image"
      style={appearance(data)}
      aria-label={text(data.alt) || t("imageFrame")}
    >
      {src ? (
        <img
          src={src}
          alt={text(data.alt)}
          style={{
            width: typeof data.width === "number" ? data.width : "100%",
            height: typeof data.height === "number" ? data.height : "auto",
            objectFit: data.fit === "cover" ? "cover" : "contain",
            borderRadius:
              typeof data.radius === "number" ? data.radius : undefined,
          }}
        />
      ) : (
        <div className="sb-image-empty">{t("addImage")}</div>
      )}
      {text(data.caption) && <figcaption>{text(data.caption)}</figcaption>}
      {!readOnly && onChange && (
        <details className="sb-primitive-editor">
          <summary>{t("editImage")}</summary>
          {imageFields.map(([key, label]) => (
            <label key={key}>
              {t(label)}
              <input
                aria-label={t(label)}
                value={text(data[key])}
                onChange={(event) =>
                  onChange({ ...data, [key]: event.target.value })
                }
              />
            </label>
          ))}
        </details>
      )}
    </figure>
  );
}

export function TableBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  validatePrimitiveData("table", data);
  const columns = (data.columns ?? []) as string[];
  const rows = (data.rows ?? []) as (string | number | boolean)[][];
  const editable = Boolean(onChange && !readOnly);
  const minimumWidth =
    typeof data.fontSize === "number" && data.fontSize >= 18
      ? columns.length * (data.fontSize * 10 + 16)
      : undefined;
  const [tableRoot, setTableRoot] = useState<HTMLElement | null>(null);
  const align = (column: number | null, alignment: TableAlignment) => {
    if (!editable) return;
    onChange?.(alignTableData(data, column, alignment));
  };
  const edit = (row: number, col: number, value: string) =>
    onChange?.({
      ...data,
      rows: rows.map((cells, i) =>
        i === row ? cells.map((cell, j) => (j === col ? value : cell)) : cells,
      ),
    });
  return (
    <section
      ref={setTableRoot}
      className={`sb-primitive sb-table${editable ? " is-editable" : ""}`}
      style={appearance(data)}
      aria-label={text(data.title) || t("table")}
    >
      {text(data.title) && <h3>{text(data.title)}</h3>}
      <div className="sb-table-frame">
        <div
          className="sb-table-scroll"
          tabIndex={minimumWidth ? 0 : undefined}
          role={minimumWidth ? "region" : undefined}
          aria-label={
            minimumWidth
              ? t("scrollTable", {
                  title: text(data.title) || t("comparisonTable"),
                })
              : undefined
          }
        >
          <table style={{ minWidth: minimumWidth }}>
            <thead>
              <tr>
                {columns.map((column, i) => (
                  <th
                    key={i}
                    style={{ textAlign: tableColumnAlignment(data, i) }}
                  >
                    {readOnly || !onChange ? (
                      column
                    ) : (
                      <input
                        aria-label={t("columnName", { column: i + 1 })}
                        value={column}
                        onChange={(event) =>
                          onChange({
                            ...data,
                            columns: columns.map((c, j) =>
                              i === j ? event.target.value : c,
                            ),
                          })
                        }
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      style={{ textAlign: tableColumnAlignment(data, j) }}
                    >
                      {readOnly || !onChange ? (
                        String(cell)
                      ) : (
                        <input
                          aria-label={t("cell", { row: i + 1, column: j + 1 })}
                          value={String(cell)}
                          onChange={(event) => edit(i, j, event.target.value)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editable && (
        <BasicTableControls
          root={tableRoot}
          getAlignment={(column) =>
            column !== null
              ? tableColumnAlignment(data, column)
              : columns.every(
                    (_, i) =>
                      tableColumnAlignment(data, i) ===
                      tableColumnAlignment(data, 0),
                  )
                ? tableColumnAlignment(data, 0)
                : null
          }
          onChange={align}
        />
      )}
      {!readOnly && onChange && (
        <div className="sb-table-actions">
          <button
            onClick={() =>
              onChange({ ...data, rows: [...rows, columns.map(() => "")] })
            }
          >
            {t("addRow")}
          </button>
          <button
            disabled={!rows.length}
            onClick={() => onChange({ ...data, rows: rows.slice(0, -1) })}
          >
            {t("removeLastRow")}
          </button>
        </div>
      )}
    </section>
  );
}

export function CalloutBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  return (
    <aside
      className="sb-primitive sb-callout"
      style={{
        borderLeft: "2px solid var(--text, #222222)",
        background: "var(--surface, #f7f7f7)",
        padding: "14px 18px",
        ...appearance(data),
      }}
      aria-label={text(data.title) || t("callout")}
    >
      {text(data.title) && <strong>{text(data.title)}</strong>}
      <TextBlock
        data={{
          content: data.content,
          format: typeof data.content === "string" ? "markdown" : "richtext",
        }}
        readOnly={readOnly}
        onChange={
          onChange
            ? (next) => onChange({ ...data, content: next.content })
            : undefined
        }
      />
    </aside>
  );
}
export function ToggleBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  return (
    <details
      className="sb-primitive sb-toggle"
      style={appearance(data)}
      open={data.open === true || undefined}
    >
      <summary>{text(data.summary) || t("toggleSummary")}</summary>
      <TextBlock
        data={{
          content: data.content,
          format: typeof data.content === "string" ? "markdown" : "richtext",
        }}
        readOnly={readOnly}
        onChange={
          onChange
            ? (next) => onChange({ ...data, content: next.content })
            : undefined
        }
      />
    </details>
  );
}
export function DividerBlock({ data }: BlockProps) {
  return (
    <hr
      className="sb-primitive sb-divider"
      style={{
        border: 0,
        borderTop: `1px solid ${text(data.color) || "var(--line, #dddddd)"}`,
        margin: "22px 0",
      }}
    />
  );
}
export function CodeBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  return (
    <section
      className="sb-primitive sb-code"
      style={appearance(data)}
      aria-label={t("code")}
    >
      <pre>
        <code
          className={
            text(data.language) ? `language-${text(data.language)}` : undefined
          }
        >
          {text(data.content)}
        </code>
      </pre>
      {!readOnly && onChange && (
        <textarea
          aria-label={t("codeContent")}
          value={text(data.content)}
          onChange={(event) =>
            onChange({ ...data, content: event.target.value })
          }
        />
      )}
    </section>
  );
}
