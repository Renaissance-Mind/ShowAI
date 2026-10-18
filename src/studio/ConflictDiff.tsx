import { useEffect, useRef, useState } from "react";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useTranslator } from "../i18n/react";
import recoveryMessages from "../i18n/messages/recovery";

/** A read-only diff: choosing a version always keeps its complete structured value. */
export default function ConflictDiff({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const t = useTranslator(recoveryMessages);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const extensions = (label: string) => [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label, tabindex: "0" }),
      EditorState.phrases.of({
        "$ unchanged lines": t("unchangedLines", { count: "$" }),
      }),
      EditorView.theme({
        "&": {
          backgroundColor: "transparent",
          color: "var(--text)",
          fontSize: "13px",
        },
        ".cm-scroller": { fontFamily: "var(--font-sans)", lineHeight: "1.8" },
        ".cm-content": { padding: "16px 0" },
        ".cm-line": { padding: "0 18px" },
        "&.cm-focused": {
          outline: "2px solid var(--accent)",
          outlineOffset: "-2px",
        },
        "&.cm-merge-a .cm-changedLine, .cm-deletedChunk, .cm-deletedLine": {
          backgroundColor: "var(--conflict-ours-soft)",
        },
        "&.cm-merge-b .cm-changedLine, .cm-insertedLine": {
          backgroundColor: "var(--conflict-theirs-soft)",
        },
        "&.cm-merge-a .cm-changedText, .cm-deletedText": {
          backgroundColor: "var(--conflict-ours-mark)",
          textDecoration: "none",
        },
        "&.cm-merge-b .cm-changedText, .cm-insertedText": {
          backgroundColor: "var(--conflict-theirs-mark)",
          textDecoration: "none",
        },
        ".cm-collapsedLines": {
          background: "var(--surface)",
          color: "var(--muted)",
          border: "0",
          padding: "8px",
        },
      }),
    ];
    const view = narrow
      ? new EditorView({
          parent: host.current!,
          doc: right,
          extensions: [
            ...extensions(`${leftLabel} / ${rightLabel}`),
            unifiedMergeView({
              original: left,
              mergeControls: false,
              gutter: false,
              collapseUnchanged: { margin: 3, minSize: 8 },
              diffConfig: { scanLimit: 1000, timeout: 100 },
            }),
          ],
        })
      : new MergeView({
          parent: host.current!,
          a: { doc: left, extensions: extensions(leftLabel) },
          b: { doc: right, extensions: extensions(rightLabel) },
          gutter: false,
          collapseUnchanged: { margin: 3, minSize: 8 },
          diffConfig: { scanLimit: 1000, timeout: 100 },
        });
    return () => view.destroy();
  }, [left, right, leftLabel, rightLabel, t, narrow]);
  return <div className="conflict-diff" ref={host} />;
}
