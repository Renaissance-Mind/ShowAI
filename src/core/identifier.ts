import { CoreError } from "./model";

/** Project, page and dataset identifiers: one path segment on every platform. */
export function isId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) &&
    !/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(id)
  );
}
export function assertId(id: string): string {
  if (!isId(id)) {
    throw new CoreError(
      "INVALID_PATH",
      "Identifiers must contain only letters, numbers, hyphens, and underscores.",
    );
  }
  return id;
}
