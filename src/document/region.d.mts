export interface RegionData {
  name?: string;
  mode?: "flow" | "grid" | "free";
  columns?: number;
  gap?: number;
  minColumnWidth?: number;
  blocks?: { kind: string; data: Record<string, unknown> }[];
}
export function validateRegionData(
  data: unknown,
  depth?: number,
): asserts data is RegionData;
export function regionGridStyle(frame?: {
  columns?: number;
  gap?: number;
  minColumnWidth?: number;
}): { gridTemplateColumns: string; gap: number };
