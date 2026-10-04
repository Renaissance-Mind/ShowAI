import {
  createElement,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { marked, type Token, type Tokens } from "marked";
import { safeImageUrl, safeUrl, text } from "./helpers";
import type { BlockProps } from "./types";

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

function markdownNodes(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => {
    const t = token as Token & { tokens?: Token[]; text?: string };
    const children = t.tokens ? markdownNodes(t.tokens) : t.text;
    switch (token.type) {
      case "space":
        return null;
      case "heading":
        return createElement(`h${token.depth}`, { key: index }, children);
      case "paragraph":
        return <p key={index}>{children}</p>;
      case "text":
      case "escape":
        return <span key={index}>{children}</span>;
      case "strong":
        return <strong key={index}>{children}</strong>;
      case "em":
        return <em key={index}>{children}</em>;
      case "del":
        return <s key={index}>{children}</s>;
      case "codespan":
        return <code key={index}>{token.text}</code>;
      case "code":
        return (
          <pre key={index}>
            <code>{token.text}</code>
          </pre>
        );
      case "blockquote":
        return <blockquote key={index}>{children}</blockquote>;
      case "br":
        return <br key={index} />;
      case "hr":
        return <hr key={index} />;
      case "link":
        return (
          <a
            key={index}
            href={safeUrl(token.href) || undefined}
            title={token.title ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        );
      case "image":
        return (
          <img
            key={index}
            src={safeImageUrl(token.href) || undefined}
            alt={token.text}
          />
        );
      case "list": {
        const items = (token as Tokens.List).items.map((item, i) => (
          <li key={i}>
            {item.task && (
              <input
                type="checkbox"
                disabled
                checked={!!item.checked}
                aria-label="任务状态"
              />
            )}
            {markdownNodes(item.tokens)}
          </li>
        ));
        return token.ordered ? (
          <ol key={index} start={Number(token.start) || 1}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
      case "table":
        return (
          <table key={index}>
            <thead>
              <tr>
                {(token as Tokens.Table).header.map((cell, i) => (
                  <th key={i}>{markdownNodes(cell.tokens)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(token as Tokens.Table).rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{markdownNodes(cell.tokens)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      default:
        return <span key={index}>{t.text ?? token.raw}</span>;
    }
  });
}

export function TextBlock({ data, onChange, readOnly }: BlockProps) {
  validatePrimitiveData("text", data);
  const content = text(data.content);
  return (
    <section
      className="sb-primitive sb-text"
      style={appearance(data)}
      aria-label="文本框"
    >
      <div className="sb-rich-text">
        {data.format === "plain" ? (
          <p style={{ whiteSpace: "pre-wrap" }}>{content}</p>
        ) : (
          markdownNodes(marked.lexer(content))
        )}
      </div>
      {!readOnly && onChange && (
        <details className="sb-primitive-editor">
          <summary>编辑文本</summary>
          <textarea
            aria-label="文本内容"
            value={content}
            onChange={(event) =>
              onChange({ ...data, content: event.target.value })
            }
          />
        </details>
      )}
    </section>
  );
}

export function ImageBlock({ data, onChange, readOnly }: BlockProps) {
  validatePrimitiveData("image", data);
  const src = safeImageUrl(data.src);
  return (
    <figure
      className="sb-primitive sb-image"
      style={appearance(data)}
      aria-label={text(data.alt) || "图像框"}
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
        <div className="sb-image-empty">添加图片</div>
      )}
      {text(data.caption) && <figcaption>{text(data.caption)}</figcaption>}
      {!readOnly && onChange && (
        <details className="sb-primitive-editor">
          <summary>编辑图片</summary>
          {["src", "alt", "caption"].map((key, i) => (
            <label key={key}>
              {["图片地址", "替代文字", "图注"][i]}
              <input
                aria-label={["图片地址", "替代文字", "图注"][i]}
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
  validatePrimitiveData("table", data);
  const columns = (data.columns ?? []) as string[];
  const rows = (data.rows ?? []) as (string | number | boolean)[][];
  const editable = Boolean(onChange && !readOnly);
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
      aria-label={text(data.title) || "基础表格"}
    >
      {text(data.title) && <h3>{text(data.title)}</h3>}
      <div className="sb-table-frame">
        <div className="sb-table-scroll">
          <table>
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
                        aria-label={`列 ${i + 1} 名称`}
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
                          aria-label={`第 ${i + 1} 行第 ${j + 1} 列`}
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
            添加行
          </button>
          <button
            disabled={!rows.length}
            onClick={() => onChange({ ...data, rows: rows.slice(0, -1) })}
          >
            移除末行
          </button>
        </div>
      )}
    </section>
  );
}

export function CalloutBlock({ data, onChange, readOnly }: BlockProps) {
  return (
    <aside
      className="sb-primitive sb-callout"
      style={{
        borderLeft: "2px solid var(--text, #222222)",
        background: "var(--surface, #f7f7f7)",
        padding: "14px 18px",
        ...appearance(data),
      }}
      aria-label={text(data.title) || "提示框"}
    >
      {text(data.title) && <strong>{text(data.title)}</strong>}
      <TextBlock
        data={{ content: text(data.content), format: "markdown" }}
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
  return (
    <details
      className="sb-primitive sb-toggle"
      style={appearance(data)}
      open={data.open === true || undefined}
    >
      <summary>{text(data.summary) || "展开内容"}</summary>
      <TextBlock
        data={{ content: text(data.content), format: "markdown" }}
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
  return (
    <section
      className="sb-primitive sb-code"
      style={appearance(data)}
      aria-label="代码块"
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
          aria-label="代码内容"
          value={text(data.content)}
          onChange={(event) =>
            onChange({ ...data, content: event.target.value })
          }
        />
      )}
    </section>
  );
}
