import { useState } from "react";
import {
  MousePointer2,
  Pencil,
  Highlighter,
  Square,
  Circle,
  ArrowUpRight,
  PanelsTopLeft,
  ChevronDown,
} from "../ui/icons";
import { boardTools } from "./board-tools";
import type { BoardTool } from "./types";
import "./board-tools.css";

const icons = [
  MousePointer2,
  Pencil,
  Highlighter,
  Square,
  Circle,
  ArrowUpRight,
  PanelsTopLeft,
];

export function BoardTools({
  tool,
  onChange,
}: {
  tool: BoardTool | null;
  onChange: (tool: BoardTool | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="board-tool-stack">
      <div className="board-tool-shortcuts">
        <button
          type="button"
          className="board-tool-disclosure"
          aria-label={expanded ? "收起快捷键" : "展开快捷键"}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            size={12}
            style={expanded ? undefined : { transform: "rotate(180deg)" }}
          />
        </button>
        {expanded && (
          <div className="board-tool-keys" aria-hidden="true">
            {boardTools.map(({ key }) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </div>
        )}
      </div>
      <div className="board-tool-buttons">
        {boardTools.map(({ tool: value, label, key }, index) => {
          const Icon = icons[index];
          return (
            <button
              type="button"
              key={key}
              aria-label={label}
              aria-keyshortcuts={key}
              title={`${label}（${key}）`}
              aria-pressed={tool === value}
              onClick={() => onChange(value)}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
