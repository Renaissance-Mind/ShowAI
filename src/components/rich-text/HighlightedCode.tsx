import { useMemo, type ReactNode } from "react";
import { highlightCode } from "./code-highlighting";
import "./code-highlighting.css";

type Token = ReturnType<typeof highlightCode>["children"][number];

function renderTokens(nodes: readonly Token[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element") return null;
    const classes = node.properties.className;
    return (
      <span
        key={index}
        className={Array.isArray(classes) ? classes.join(" ") : undefined}
      >
        {renderTokens(node.children)}
      </span>
    );
  });
}

/** Tokens are React text/spans, so code containing HTML stays inert. */
export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}) {
  return useMemo(
    () => renderTokens(highlightCode(code, language).children),
    [code, language],
  );
}
