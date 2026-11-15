import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { highlightCode } from "./code-highlighting";
import "./code-highlighting.css";

type Highlighter = typeof import("./code-highlighting");
type Token = ReturnType<typeof highlightCode>["children"][number];

let highlighter: Highlighter | undefined;
let loading: Promise<Highlighter> | undefined;
export function loadCodeHighlighter() {
  return (loading ??= import("./code-highlighting").then(
    (module) => (highlighter = module),
  ));
}

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

export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}) {
  const [loaded, setLoaded] = useState(highlighter);
  useEffect(() => {
    if (!loaded) void loadCodeHighlighter().then(setLoaded);
  }, [loaded]);
  return useMemo(
    () =>
      loaded
        ? renderTokens(loaded.highlightCode(code, language).children)
        : code,
    [loaded, code, language],
  );
}
