export type DrawingTone =
  "blue" | "gray" | "violet" | "teal" | "green" | "red" | "orange";
export declare const DRAWING_TONES: readonly DrawingTone[];
export declare const SVG_LIMITS: { sourceLength: number; textLength: number };
export declare const SVG_ELEMENTS: readonly string[];
export declare function safeSvgHref(value: unknown): boolean;
export declare function safeSvgUrls(value: unknown): boolean;
export interface SvgData {
  source: string;
  alt: string;
  title?: string;
  caption?: string;
  maxWidth?: number;
}
export declare function validateSvgData(data: unknown): SvgData;
