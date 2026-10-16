import { marked, type Token } from "marked";
import { Fragment, type ReactNode } from "react";
import { isSafeUrl } from "../../portable/validation.mjs";

/** Agent output is Markdown data. HTML is displayed as text and never executed. */
export function AgentMarkdown({
  text,
  onFile,
}: {
  text: string;
  onFile(path: string): void;
}) {
  const link = (href: string, children: ReactNode, key: number) => {
    if (isSafeUrl(href))
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    if (
      href.startsWith("/") ||
      href.startsWith("./") ||
      /^[A-Za-z]:[\\/]/.test(href)
    )
      return (
        <button
          type="button"
          className="agent-file-link"
          key={key}
          onClick={() => onFile(href)}
        >
          {children}
        </button>
      );
    return <Fragment key={key}>{children}</Fragment>;
  };
  const render = (tokens: Token[] | undefined): ReactNode =>
    tokens?.map((token, index) => {
      switch (token.type) {
        case "space":
          return null;
        case "paragraph":
          return <p key={index}>{render(token.tokens)}</p>;
        case "text":
          return (
            <Fragment key={index}>
              {token.tokens ? render(token.tokens) : token.text}
            </Fragment>
          );
        case "heading":
          return <h3 key={index}>{render(token.tokens)}</h3>;
        case "strong":
          return <strong key={index}>{render(token.tokens)}</strong>;
        case "em":
          return <em key={index}>{render(token.tokens)}</em>;
        case "del":
          return <del key={index}>{render(token.tokens)}</del>;
        case "codespan":
          return <code key={index}>{token.text}</code>;
        case "code":
          return (
            <pre key={index}>
              <code data-language={token.lang}>{token.text}</code>
            </pre>
          );
        case "blockquote":
          return <blockquote key={index}>{render(token.tokens)}</blockquote>;
        case "link":
          return link(token.href, render(token.tokens), index);
        case "image":
          return link(token.href, token.text || token.href, index);
        case "list": {
          const Tag = token.ordered ? "ol" : "ul";
          return (
            <Tag key={index}>
              {token.items.map((item: { tokens: Token[] }, i: number) => (
                <li key={i}>{render(item.tokens)}</li>
              ))}
            </Tag>
          );
        }
        case "br":
          return <br key={index} />;
        case "hr":
          return <hr key={index} />;
        case "table":
          return (
            <div className="assistant-table-scroll" key={index}>
              <table>
                <thead>
                  <tr>
                    {token.header.map(
                      (cell: { tokens: Token[] }, i: number) => (
                        <th key={i}>{render(cell.tokens)}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {token.rows.map((row: { tokens: Token[] }[], i: number) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{render(cell.tokens)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        default:
          return <Fragment key={index}>{token.raw}</Fragment>;
      }
    });
  return <div className="assistant-markdown">{render(marked.lexer(text))}</div>;
}
