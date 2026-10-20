export interface PortableInk {
  format: "showai-ink-v1";
  brushVersion: 1;
  brush: "pen" | "marker" | "pencil" | "monoline";
  strokeCount: 1;
  width: number;
  opacity: number;
  extent: [number, number];
  samples: number[][];
  transform: number[];
  mask?: (string | number)[][];
  sourceDrawing?: string;
  seed?: number;
  createdAt?: number;
}
export const PORTABLE_INK_FORMAT: "showai-ink-v1";
export function portableInkColor(color: string, dark?: boolean): string;
export function isPortableInk(ink: unknown): ink is PortableInk;
export function isInkNode(node: {
  type?: string;
  attrs?: Record<string, any>;
}): boolean;
export function portableNodeInk(node: {
  attrs: Record<string, any>;
}): PortableInk;
export function createPortableInk(
  points: { x: number; y: number; pressure?: number }[],
  width: number,
  extent: [number, number],
  brush?: PortableInk["brush"],
  pressure?: boolean,
): PortableInk;
export function validatePortableInk(ink: unknown): PortableInk;
export function portableInkGeometry(
  ink: PortableInk,
  strokeWidth?: number,
): { path: string; mask?: string; polygons: { x: number; y: number }[][] };
export function portableInkHit(
  ink: PortableInk,
  point: { x: number; y: number },
  strokeWidth?: number,
): { inside: boolean; distance: number; solid: boolean; area: number };
export function portableInkBounds(
  ink: PortableInk,
  strokeWidth?: number,
): { x: number; y: number; width: number; height: number };
