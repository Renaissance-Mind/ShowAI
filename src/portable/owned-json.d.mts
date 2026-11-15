export function freezeOwnedJSON<T>(value: T): T;
export function isOwnedJSON(value: unknown): boolean;
export function ownedJSONMetrics(
  value: object,
): { readonly bytes: number; readonly children: readonly object[] } | undefined;
export type CapturedResourceTree =
  Readonly<{ value: string; bytes: number }> | readonly CapturedResourceTree[];
export interface CapturedContentSummary {
  readonly structureBytes: number;
  readonly jsonBytes: number;
  readonly prettyPadding: number;
  readonly prettyDepthFactor: number;
  readonly maximumDepth: number;
  readonly resources: CapturedResourceTree | null;
  readonly bookkeepingBytes: number;
}
export function capturedContentSummary(
  value: unknown,
): CapturedContentSummary | undefined;

export function captureOwnedJSON<T>(value: T, maximumNewCopyBytes?: number): T;
export function parseOwnedJSON(raw: string, base?: unknown): unknown;
export function shareCapturedJSON<T>(base: unknown, target: T): T;
