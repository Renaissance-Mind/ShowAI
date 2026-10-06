export type LayoutMode = "flow" | "grid" | "free";
export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height?: number;
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
