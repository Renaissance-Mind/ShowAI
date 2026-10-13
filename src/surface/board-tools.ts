import type { BoardTool } from "./types";

export const boardTools: {
  tool: BoardTool | null;
  label: string;
  key: string;
  alias: string;
}[] = [
  { tool: null, label: "选择工具", key: "1", alias: "v" },
  { tool: "pen", label: "画笔", key: "2", alias: "p" },
  { tool: "highlighter", label: "荧光笔", key: "3", alias: "h" },
  { tool: "rectangle", label: "矩形", key: "4", alias: "r" },
  { tool: "ellipse", label: "椭圆", key: "5", alias: "e" },
  { tool: "arrow", label: "箭头", key: "6", alias: "a" },
  { tool: "region", label: "区域", key: "7", alias: "f" },
];

export function boardToolForKey(key: string) {
  return boardTools.find(
    (entry) => entry.key === key || entry.alias === key.toLowerCase(),
  );
}
