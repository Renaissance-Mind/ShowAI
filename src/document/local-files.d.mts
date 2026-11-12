export type LocalResourceKind = "image" | "video" | "audio" | "pdf";
export const LOCAL_FILE_TYPES: Readonly<
  Record<string, { mime: string; kind: LocalResourceKind }>
>;
export function isLocalFileRef(value: unknown): value is string;
export function localRefPath(value: unknown): string | undefined;
export function localRefName(value: unknown): string;
export function localRefType(
  value: unknown,
): { mime: string; kind: LocalResourceKind } | undefined;
export function isLocalResourceRef(
  value: unknown,
  kind?: LocalResourceKind,
): value is string;
export function isDetachedRef(value: unknown): boolean;
export function localFileRef(path: string): string;
export function detachedRef(value: string): string;
