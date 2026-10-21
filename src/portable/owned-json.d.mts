/** Internal actual recursive factory, not a caller-asserted frozen flag. */
export function freezeOwnedJSON<T>(value: T): T;
export function isOwnedJSON(value: unknown): boolean;
export function ownedJSONMetrics(
  value: object,
): { readonly bytes: number; readonly children: readonly object[] } | undefined;
