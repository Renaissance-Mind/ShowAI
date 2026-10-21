export type NativeSourcePath = (string | number)[];
export type NativeSourceEdit =
  | { op: "set"; path: NativeSourcePath; value: unknown }
  | { op: "remove"; path: NativeSourcePath }
  | { op: "resize"; path: NativeSourcePath; length: number };
export function diffNativeSource(base: unknown, next: unknown): NativeSourceEdit[];
/** Result is private transport data; never let its mutable subtrees escape to UI. */
export function applyNativeSourceDelta<T>(base: T, edits: NativeSourceEdit[]): T;
export function shareNativeSource<T>(previous: T, normalized: T): T;
