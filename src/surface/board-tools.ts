import type { BoardMode } from "./types";

export const boardTools: {
  tool: BoardMode | null;
  label: string;
  key: string;
  aliases: string[];
}[] = [
  { tool: null, label: "选择工具", key: "1", aliases: ["v"] },
  { tool: "pen", label: "画笔", key: "2", aliases: ["p"] },
  { tool: "highlighter", label: "荧光笔", key: "3", aliases: ["m"] },
  { tool: "rectangle", label: "矩形", key: "4", aliases: ["r"] },
  { tool: "ellipse", label: "椭圆", key: "5", aliases: ["e", "o"] },
  { tool: "arrow", label: "箭头", key: "6", aliases: ["a"] },
  { tool: "region", label: "区域", key: "7", aliases: ["f"] },
  { tool: "text", label: "文字", key: "8", aliases: ["t"] },
  { tool: "hand", label: "抓手", key: "9", aliases: ["h"] },
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
