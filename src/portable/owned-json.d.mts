/** Internal actual recursive factory, not a caller-asserted frozen flag. */
export function freezeOwnedJSON<T>(value: T): T;
export function isOwnedJSON(value: unknown): boolean;
export function ownedJSONMetrics(
  value: object,
): { readonly bytes: number; readonly children: readonly object[] } | undefined;

/** Capture arbitrary external data independently; frozen caller objects are not proof. */
export function captureOwnedJSON<T>(value: T): T;
/** Exclusively parse and seal the actual JSON graph before it can escape. */
export function parseOwnedJSON(raw: string, base?: unknown): unknown;
