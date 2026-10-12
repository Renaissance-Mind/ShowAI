export type SurfaceKind = "page" | "board";
export type PageWidthMode = "standard" | "wide" | "full";
export type DrawingTool =
  "pen" | "highlighter" | "rectangle" | "ellipse" | "arrow";
export type BoardTool = DrawingTool | "region";
export interface DrawingStyle {
  color: string;
  fillColor: string;
  strokeWidth: number;
}
export type LayoutMode = "flow" | "grid" | "free";
export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height?: number;
  rotation?: number;
  /** Last measured content dimensions; never imposes a CSS height. */
  contentSize?: { width: number; height: number };
  heightMode?: "fixed" | "auto";
  mode?: LayoutMode;
  columns?: number;
  gap?: number;
}
export interface SavedView {
  id: string;
  name: string;
  targets: string[];
}
export interface PageViews {
  initial: string | null;
  saved: SavedView[];
  readingOrder: string[];
}
