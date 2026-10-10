import { richTextStyle } from "./model.mjs";
import { createElement, type CSSProperties, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import { mathHtml } from "../blocks/markdown-math.mjs";
import { safeImageUrl, safeUrl } from "../blocks/helpers";
function nodeStyle(node: JSONContent): CSSProperties {
  const attrs = node.attrs ?? {};
  return {
    ...(attrs.textAlign ? { textAlign: attrs.textAlign } : {}),
    ...(attrs.backgroundColor
      ? { backgroundColor: attrs.backgroundColor }
      : {}),
  };
}

function markedText(node: JSONContent): ReactNode {
  let content: ReactNode = node.text ?? "";
  for (const [index, mark] of (node.marks ?? []).entries()) {
    const props = { key: `${mark.type}-${index}` };
    switch (mark.type) {
      case "bold":
        content = <strong {...props}>{content}</strong>;
        break;
      case "italic":
        content = <em {...props}>{content}</em>;
        break;
      case "underline":
        content = <u {...props}>{content}</u>;
        break;
      case "strike":
        content = <s {...props}>{content}</s>;
        break;
      case "code":
        content = <code {...props}>{content}</code>;
        break;
      case "highlight":
        content = (
          <mark
            {...props}
            data-color={mark.attrs?.color ?? mark.attrs?.backgroundColor}
            style={
              {
                "--showai-highlight-color":
                  mark.attrs?.color ?? mark.attrs?.backgroundColor,
              } as CSSProperties
            }
          >
            {content}
          </mark>
        );
        break;
      case "textStyle":
        content = (
          <span
            {...props}
            style={{
              color: mark.attrs?.color,
              fontSize: mark.attrs?.fontSize,
              fontFamily: mark.attrs?.fontFamily,
            }}
          >
            {content}
          </span>
        );
        break;
      case "link":
        content = (
          <a
            {...props}
            href={
              safeUrl(mark.attrs?.href) ||
              (String(mark.attrs?.href ?? "").startsWith("#")
                ? mark.attrs?.href
                : undefined)
            }
            title={mark.attrs?.title}
            target={
              String(mark.attrs?.href ?? "").startsWith("#")
                ? undefined
                : "_blank"
            }
            rel="noopener noreferrer"
          >
            {content}
          </a>
        );
        break;
      default:
        throw new Error(`Unsupported text format: ${mark.type}`);
    }
  }
  return content;
}

function tableColumns(node: JSONContent): ReactNode {
  const widths = (node.content?.[0]?.content ?? []).flatMap((cell) => {
    const span = Number(cell.attrs?.colspan ?? 1);
    const values: number[] = cell.attrs?.colwidth ?? [];
    return Array.from(
      { length: span },
      (_, index) => values[index] || undefined,
    );
  });
  return widths.some(Boolean) ? (
    <colgroup>
      {widths.map((width, index) => (
        <col key={index} style={width ? { width } : undefined} />
      ))}
    </colgroup>
  ) : null;
}

/** Renders only validated page JSON. The exported reader includes no editor runtime. */
export function RichTextNode({
  node,
  renderWidget,
}: {
  node: JSONContent;
  renderWidget?: (kind: string, data: Record<string, unknown>) => ReactNode;
}): ReactNode {
  const attrs = node.attrs ?? {};
  const children = node.content?.map((child, index) => (
    <RichTextNode
      key={child.attrs?.id ?? index}
      node={child}
      renderWidget={renderWidget}
    />
  ));
  const props = {
    id: attrs.id,
    "data-block-id": attrs.id,
    style: nodeStyle(node),
  };
  switch (node.type) {
    case "richText":
      return (
        <div
          {...props}
          className="rich-text-component"
          data-component-kind="text"
          style={richTextStyle(attrs.data)}
        >
          {children}
        </div>
      );
    case "region":
    case "doc":
      return <>{children}</>;
    case "text":
      return markedText(node);
    case "mathInline":
    case "mathBlock":
      return createElement(node.type === "mathBlock" ? "div" : "span", {
        ...props,
        className:
          node.type === "mathBlock" || attrs.display
            ? "sb-math-display"
            : "sb-math-inline",
        dangerouslySetInnerHTML: {
          __html: mathHtml(
            attrs.latex ?? "",
            node.type === "mathBlock" || !!attrs.display,
          ),
        },
      });
    case "hardBreak":
      return <br {...props} />;
    case "paragraph":
      return <p {...props}>{children?.length ? children : <br />}</p>;
    case "heading":
      return createElement(`h${attrs.level ?? 1}`, props, children);
    case "blockquote":
      return <blockquote {...props}>{children}</blockquote>;
    case "bulletList":
      return <ul {...props}>{children}</ul>;
    case "orderedList":
      return (
        <ol {...props} start={attrs.start ?? 1} type={attrs.type}>
          {children}
        </ol>
      );
    case "listItem":
      return <li {...props}>{children}</li>;
    case "taskList":
      return (
        <ul {...props} className="portable-task-list">
          {children}
        </ul>
      );
    case "taskItem":
      return (
        <li {...props} className="portable-task" data-checked={!!attrs.checked}>
          <input
            type="checkbox"
            checked={!!attrs.checked}
            disabled
            aria-label="Task completion"
          />
          <div>{children}</div>
        </li>
      );
    case "codeBlock":
      return (
        <pre {...props}>
          <code
            className={
              attrs.language ? `language-${attrs.language}` : undefined
            }
          >
            {children}
          </code>
        </pre>
      );
    case "horizontalRule":
      return <hr {...props} />;
    case "image":
      return (
        <img
          {...props}
          className="portable-image"
          src={safeImageUrl(attrs.src) || undefined}
          alt={attrs.alt ?? ""}
          title={attrs.title}
          style={{
            ...props.style,
            width: attrs.width || undefined,
            height: attrs.height || undefined,
            ...(attrs.align === "left"
              ? { marginLeft: 0, marginRight: "auto" }
              : attrs.align === "right"
                ? { marginLeft: "auto", marginRight: 0 }
                : {}),
          }}
        />
      );
    case "table":
      return (
        <div className="portable-table-scroll">
          <table {...props}>
            {tableColumns(node)}
            <tbody>{children}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr {...props}>{children}</tr>;
    case "tableCell":
      return (
        <td
          {...props}
          colSpan={attrs.colspan ?? 1}
          rowSpan={attrs.rowspan ?? 1}
        >
          {children}
        </td>
      );
    case "tableHeader":
      return (
        <th
          {...props}
          colSpan={attrs.colspan ?? 1}
          rowSpan={attrs.rowspan ?? 1}
        >
          {children}
        </th>
      );
    case "callout":
      return (
        <aside
          {...props}
          className={`portable-callout tone-${attrs.tone ?? "sage"}`}
        >
          <span className="portable-callout-icon" aria-hidden="true">
            {attrs.icon ?? "💡"}
          </span>
          <div>{children}</div>
        </aside>
      );
    case "toggle":
      return (
        <details {...props} className="portable-toggle" open={!!attrs.open}>
          <summary>{attrs.title || attrs.summary || "展开内容"}</summary>
          <div className="portable-toggle-body">{children}</div>
        </details>
      );
    case "widget":
      return (
        <div
          {...props}
          className="portable-widget"
          data-widget-kind={attrs.kind}
        >
          {renderWidget?.(attrs.kind, attrs.data ?? {})}
        </div>
      );
    default:
      throw new Error(`Unsupported page block: ${node.type}`);
  }
}

export function RichTextContent({
  content,
  data,
  renderWidget,
}: {
  content: JSONContent;
  data?: Record<string, unknown>;
  renderWidget?: (kind: string, data: Record<string, unknown>) => ReactNode;
}) {
  return (
    <div className="portable-content sb-rich-text" style={richTextStyle(data)}>
      <RichTextNode node={content} renderWidget={renderWidget} />
    </div>
  );
}
