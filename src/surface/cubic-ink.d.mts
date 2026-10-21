import type { PortableInkV2 } from "./portable-ink.mjs";
import type { CompiledInkInput } from "./ink-kernel/compiled-ink-input.mjs";
import type {
  InkStrokeCommand,
  InkStrokeResult,
} from "./ink-kernel/ink-stroke-kernel.mjs";
export function cubicInkGeometry(
  ink: PortableInkV2,
  width?: number,
  pressure?: boolean,
): { commands: InkStrokeCommand[]; path: string; statistics: InkStrokeResult };
export function cubicInkQueryGeometry(
  ink: PortableInkV2,
  width?: number,
  pressure?: boolean,
): {
  bounds: { x: number; y: number; width: number; height: number };
  polygons: { x: number; y: number }[][];
};
export function cubicInkBounds(
  ink: PortableInkV2,
  width?: number,
  pressure?: boolean,
): { x: number; y: number; width: number; height: number };
export function cubicInkHit(
  ink: PortableInkV2,
  point: { x: number; y: number },
  width?: number,
  pressure?: boolean,
): { inside: boolean; distance: number; solid: true; area: number };
export function cubicInkFromInput(
  input: CompiledInkInput,
  options: {
    sourceID: string;
    extent: [number, number];
    origin?: { x: number; y: number };
    brush?: PortableInkV2["brush"];
    opacity?: number;
    outlineTolerance?: number;
    capture?: boolean;
  },
): PortableInkV2;
