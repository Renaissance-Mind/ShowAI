export type StrokePoint = [number, number];
export interface InkStrokeSegment {
  points: StrokePoint[];
  radius: [number, number];
}
export interface InkStrokeOptions {
  tolerance?: number;
  geometryVersion?: 1;
  maxDepth?: number;
  maxLeaves?: number;
  maxCommands?: number;
}
export interface InkStrokeResult {
  commands: number;
  contours: number;
  envelopeCurves: number;
  fallbackLeaves: number;
  sampledChecks: number;
  leaves: number;
  maximumDepth: number;
  fallbackContours: number;
  sampledEnvelopeError: number;
  fallbackCenterBound: number;
  arcErrorBound: number;
}
export type InkStrokeCommand = ["M" | "L" | "Q" | "C" | "Z", ...number[]];
/** Round circular sweep geometry1; see C header for exact approximation,
 * empty/discontinuous/closed input and single-opacity nonzero-union semantics. */
export class CompiledInkStroke {
  constructor();
  counts(
    segments: InkStrokeSegment[],
    options?: InkStrokeOptions,
  ): InkStrokeResult;
  build(
    segments: InkStrokeSegment[],
    options?: InkStrokeOptions,
  ): { commands: InkStrokeCommand[]; result: InkStrokeResult };
}
