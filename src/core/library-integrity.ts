import { ContentLibrary } from "./content-library";
import { CoreError, type IntegrityProblem } from "./model";

/** What Settings shows after checking the library. */
export type IntegrityResult =
  | { ok: true; checkedAt: string }
  | {
      ok: false;
      checkedAt: string;
      problem: IntegrityProblem | "unknown";
      message: string;
    };

/**
 * Maps a verification failure to a result. Damage the check recognises keeps
 * its kind; any other stored-content error is reported as unknown. Failures
 * that are not about stored content (a missing library, permissions) throw.
 */
export function integrityResult(
  error: unknown,
  checkedAt = new Date().toISOString(),
): IntegrityResult {
  // SQLite reports a damaged file itself: SQLITE_CORRUPT (11) or SQLITE_NOTADB (26).
  const sqlite = (error as { errcode?: unknown } | null)?.errcode;
  if (typeof sqlite === "number" && [11, 26].includes(sqlite & 0xff))
    return {
      ok: false,
      checkedAt,
      problem: "database",
      message: (error as Error).message,
    };
  if (!(error instanceof CoreError) || error.code !== "INVALID_DATA")
    throw error;
  const kind = error.details?.integrity;
  return {
    ok: false,
    checkedAt,
    problem:
      kind === "database" ||
      kind === "content" ||
      kind === "history" ||
      kind === "repository"
        ? kind
        : "unknown",
    message: error.message,
  };
}

/** Runs what `showai library verify` runs and reports the outcome. */
export async function checkLibraryIntegrity(
  root: string,
): Promise<IntegrityResult> {
  const checkedAt = new Date().toISOString();
  return new ContentLibrary(root).verify().then(
    () => ({ ok: true as const, checkedAt }),
    (error) => integrityResult(error, checkedAt),
  );
}
