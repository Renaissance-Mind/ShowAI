export interface PackedComponentHtml {
  index: number;
  parts: (string | ["styles" | "script", number, number])[];
}
export function packedArtifact<T>(
  artifact: T,
  options?: { inlineOnly?: boolean },
): { artifact: T; html: PackedComponentHtml[] };
export function restoreArtifact<T>(bundle: {
  artifact: T;
  html?: PackedComponentHtml[];
}): T;
