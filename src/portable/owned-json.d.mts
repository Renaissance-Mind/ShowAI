/** Internal actual recursive factory, not a caller-asserted frozen flag. */
export function freezeOwnedJSON<T>(value: T): T;
export function isOwnedJSON(value: unknown): boolean;
export function ownedJSONMetrics(
  value: object,
): { readonly bytes: number; readonly children: readonly object[] } | undefined;

/** Capture arbitrary external data independently; frozen caller objects are not
 * proof. The optional budget can only lower the defensive new-copy limit;
 * already held immutable branches allocate no defensive copy. Capacity/model
 * validation remains a separate complete gate. */
export function captureOwnedJSON<T>(value: T, maximumNewCopyBytes?: number): T;
/** Exclusively parse and seal the actual JSON graph before it can escape. */
export function parseOwnedJSON(raw: string, base?: unknown): unknown;
