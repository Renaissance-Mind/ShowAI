import type { DrawingTone } from "./svg-contract.mjs";
export { DRAWING_TONES, type DrawingTone } from "./svg-contract.mjs";
export type Side = "top" | "right" | "bottom" | "left";
export declare const MECHANISM_LIMITS: Record<string, number>;
export declare const LINK_STYLES: readonly ("solid" | "dashed")[];
export declare const LINK_ENDS: readonly ("end" | "both" | "none")[];
export declare const LINK_WEIGHTS: readonly ("thin" | "normal" | "thick")[];
export declare const SIDES: readonly Side[];
export declare const MARK_KINDS: readonly ("check" | "cross")[];
interface Placed {
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}
export interface MechanismTable {
  title?: string;
  columns?: string[];
  rows?: string[][];
  empty?: string;
}
export interface MechanismNode extends Placed {
  id: string;
  label?: string;
  sub?: string;
  tone?: DrawingTone;
  note?: string;
  table?: MechanismTable;
  in?: string[];
}
export interface MechanismZone extends Placed {
  id: string;
  label?: string;
  tone?: DrawingTone;
}
export interface MechanismLink {
  id: string;
  from: string;
  to: string;
  label?: string;
  tone?: DrawingTone;
  style?: "solid" | "dashed";
  ends?: "end" | "both" | "none";
  weight?: "thin" | "normal" | "thick";
  fromSide?: Side;
  toSide?: Side;
  in?: string[];
}
export interface MechanismMark {
  id: string;
  on: string;
  kind: "check" | "cross";
  tone?: DrawingTone;
  label?: string;
  in?: string[];
}
export interface MechanismStep {
  id: string;
  title: string;
  text?: string;
  focus?: string[];
  tones?: Record<string, DrawingTone>;
  labels?: Record<string, string>;
  tables?: Record<
    string,
    { rows?: string[][]; highlight?: number; tone?: DrawingTone }
  >;
}
export interface MechanismData {
  title?: string;
  description?: string;
  nodes: MechanismNode[];
  zones?: MechanismZone[];
  links?: MechanismLink[];
  marks?: MechanismMark[];
  steps?: MechanismStep[];
  initialStep?: string;
}
export declare function validateMechanismData(data: unknown): MechanismData;
