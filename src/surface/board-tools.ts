import type { BoardMode } from "./types";
import type { MessageKey } from "../i18n";
import type messages from "../i18n/messages/surface";

export const boardTools: {
  tool: BoardMode | null;
  label: MessageKey<typeof messages>;
  key: string;
  aliases: string[];
}[] = [
  { tool: null, label: "tool.select", key: "1", aliases: ["v"] },
  { tool: "pen", label: "tool.pen", key: "2", aliases: ["p"] },
  { tool: "highlighter", label: "tool.highlighter", key: "3", aliases: ["m"] },
  { tool: "rectangle", label: "tool.rectangle", key: "4", aliases: ["r"] },
  { tool: "ellipse", label: "tool.ellipse", key: "5", aliases: ["e", "o"] },
  { tool: "arrow", label: "tool.arrow", key: "6", aliases: ["a"] },
  { tool: "region", label: "tool.region", key: "7", aliases: ["f"] },
  { tool: "text", label: "tool.text", key: "8", aliases: ["t"] },
  { tool: "hand", label: "tool.hand", key: "9", aliases: ["h"] },
];

export function boardToolForKey(key: string) {
  const lower = key.toLowerCase();
  return boardTools.find(
    (entry) => entry.key === key || entry.aliases.includes(lower),
  );
}

/** Tooltip shortcut text, e.g. "P / 2". */
export function boardToolShortcut(tool: BoardMode | null) {
  const entry = boardTools.find((item) => item.tool === tool);
  return entry
    ? [...entry.aliases.map((alias) => alias.toUpperCase()), entry.key].join(
        " / ",
      )
    : "";
}
