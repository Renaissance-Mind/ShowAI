import type { BoardTool } from "./types";
import type { MessageKey } from "../i18n";
import type messages from "../i18n/messages/surface";

export const boardTools: {
  tool: BoardTool | null;
  label: MessageKey<typeof messages>;
  key: string;
  alias: string;
}[] = [
  { tool: null, label: "tool.select", key: "1", alias: "v" },
  { tool: "pen", label: "tool.pen", key: "2", alias: "p" },
  { tool: "highlighter", label: "tool.highlighter", key: "3", alias: "h" },
  { tool: "rectangle", label: "tool.rectangle", key: "4", alias: "r" },
  { tool: "ellipse", label: "tool.ellipse", key: "5", alias: "e" },
  { tool: "arrow", label: "tool.arrow", key: "6", alias: "a" },
  { tool: "region", label: "tool.region", key: "7", alias: "f" },
];

export function boardToolForKey(key: string) {
  return boardTools.find(
    (entry) => entry.key === key || entry.alias === key.toLowerCase(),
  );
}
