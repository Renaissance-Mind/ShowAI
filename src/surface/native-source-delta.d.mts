export type NativeSourcePath = (string | number)[];
export type NativeSourceEdit =
  | { op: "set"; path: NativeSourcePath; value: unknown }
  | { op: "remove"; path: NativeSourcePath }
  | { op: "resize"; path: NativeSourcePath; length: number }
  | { op: "splice"; path: NativeSourcePath; index: number; deleteCount: number; items: unknown[] };
export function diffNativeSource(base: unknown, next: unknown): NativeSourceEdit[];
export function applyNativeSourceDelta<T>(base: T, edits: NativeSourceEdit[]): T;
export function applyCapturedSourceDelta<T>(base: T, edits: NativeSourceEdit[]): T;
