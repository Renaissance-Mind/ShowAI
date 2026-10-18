import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

type Side = "ours" | "theirs";

export default function ConflictDiff({
  left,
  right,
  leftLabel,
  rightLabel,
  selected,
  disabled,
  onSelect,
}: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
  selected: Side | undefined;
  disabled: boolean;
  onSelect: (side: Side) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef({ selected, disabled, onSelect });
  controls.current = { selected, disabled, onSelect };
  const panes = useRef<HTMLElement[]>([]);
  const updateSelection = () => {
    for (const pane of panes.current) {
      const checked = pane.dataset.side === controls.current.selected;
      pane.setAttribute("aria-checked", String(checked));
      pane.setAttribute("aria-disabled", String(controls.current.disabled));
      pane.tabIndex = checked && !controls.current.disabled ? 0 : -1;
    }
  };
  useEffect(() => {
    const extensions = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ tabindex: "-1" }),
      EditorView.theme({
        "&": {
          backgroundColor: "transparent",
          color: "var(--text)",
          fontSize: "13px",
        },
        ".cm-scroller": { fontFamily: "var(--font-sans)", lineHeight: "1.8" },
        ".cm-content": { padding: "16px 0" },
        ".cm-line": { padding: "0 18px" },
        "&.cm-merge-a .cm-changedLine": {
          backgroundColor: "var(--conflict-ours-soft)",
        },
        "&.cm-merge-b .cm-changedLine": {
          backgroundColor: "var(--conflict-theirs-soft)",
        },
        "&.cm-merge-a .cm-changedText": {
          backgroundColor: "var(--conflict-ours-mark)",
          textDecoration: "none",
        },
        "&.cm-merge-b .cm-changedText": {
          backgroundColor: "var(--conflict-theirs-mark)",
          textDecoration: "none",
        },
      }),
    ];
    const view = new MergeView({
      parent: host.current!,
      a: { doc: left, extensions },
      b: { doc: right, extensions },
      gutter: false,
      diffConfig: { scanLimit: 1000, timeout: 100 },
    });
    panes.current = [view.a.dom.parentElement!, view.b.dom.parentElement!];
    panes.current.forEach((pane, index) => {
      const side: Side = index === 0 ? "ours" : "theirs";
      const label = index === 0 ? leftLabel : rightLabel;
      pane.dataset.side = side;
      pane.setAttribute("role", "radio");
      pane.setAttribute("aria-label", label);
      const header = document.createElement("div");
      header.className = "conflict-version-heading";
      const indicator = document.createElement("span");
      indicator.className = "conflict-version-indicator";
      indicator.setAttribute("aria-hidden", "true");
      const title = document.createElement("strong");
      title.textContent = label;
      header.append(title, indicator);
      pane.prepend(header);
      pane.addEventListener(
        "click",
        () => {
          if (!controls.current.disabled) controls.current.onSelect(side);
        },
        true,
      );
      pane.addEventListener("keydown", (event) => {
        if (controls.current.disabled) return;
        const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
        if (arrows.includes(event.key)) {
          event.preventDefault();
          controls.current.onSelect(side === "ours" ? "theirs" : "ours");
          panes.current[1 - index].focus({ preventScroll: true });
        } else if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          controls.current.onSelect(side);
        }
      });
    });
    updateSelection();
    return () => {
      panes.current = [];
      view.destroy();
    };
  }, [left, right, leftLabel, rightLabel]);
  useEffect(updateSelection, [selected, disabled]);
  return (
    <div
      className="conflict-diff"
      role="radiogroup"
      aria-label={`${leftLabel} / ${rightLabel}`}
      ref={host}
    />
  );
}
