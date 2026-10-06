import {
  createElement,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { JSONContent } from "@tiptap/core";
import { Widget } from "../components/blocks/Widget";

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
            style={{
              backgroundColor:
                mark.attrs?.color ?? mark.attrs?.backgroundColor ?? "#fff0ac",
            }}
          >
            {content}
          </mark>
        );
        break;
      case "link":
        content = (
          <a
            {...props}
            href={mark.attrs?.href}
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
export function PageNode({ node }: { node: JSONContent }): ReactNode {
  const attrs = node.attrs ?? {};
  const children = node.content?.map((child, index) => (
    <PageNode key={child.attrs?.id ?? index} node={child} />
  ));
  const props = {
    id: attrs.id,
    "data-block-id": attrs.id,
    style: nodeStyle(node),
  };
  switch (node.type) {
    case "doc":
      return <>{children}</>;
    case "text":
      return markedText(node);
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
          src={attrs.src}
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
          <ReadingWidget kind={attrs.kind} data={attrs.data ?? {}} />
        </div>
      );
    default:
      throw new Error(`Unsupported page block: ${node.type}`);
  }
}

export function PageContent({ content }: { content: JSONContent }) {
  return (
    <div className="portable-content">
      <PageNode node={content} />
    </div>
  );
}

/** Editing is confined to the explicitly requested preview, never the stored Page. */
function ReadingWidget({
  kind,
  data,
}: {
  kind: string;
  data: Record<string, unknown>;
}) {
  const [local, setLocal] = useState(data);
  useEffect(() => setLocal(data), [data]);
  const options =
    typeof window === "undefined"
      ? undefined
      : window.document.querySelector(
          'script#showai-read-options[type="application/json"]',
        )?.textContent;
  const draft = options ? JSON.parse(options).draft === true : false;
  return (
    <Widget
      kind={kind}
      data={local}
      readOnly={!draft}
      onChange={draft ? setLocal : undefined}
    />
  );
}
