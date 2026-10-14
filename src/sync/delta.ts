import {
  SyncError,
  syncProtocol,
  type ProjectSnapshot,
  type SyncUser,
} from "./protocol";

/** The server accepts a publication as changes to its current head. */
export const snapshotDeltaCapability = "snapshot-delta-v1";
/** An event subscriber accepts revisions as changes to the previous head. */
export const revisionDeltaFeature = "revision-delta-v1";

/** A current-format snapshot expressed against its base snapshot's files. */
export interface SnapshotDelta {
  parents: string[];
  change: ProjectSnapshot["change"];
  set: Record<string, string>;
  remove: string[];
  source?: { user: SyncUser; receivedAt: string };
}

export function snapshotDelta(
  base: ProjectSnapshot,
  next: ProjectSnapshot,
): SnapshotDelta {
  // Entries keep every path an own property, including names like "__proto__".
  const set = Object.fromEntries(
    Object.entries(next.files).filter(
      ([path, digest]) =>
        !Object.hasOwn(base.files, path) || base.files[path] !== digest,
    ),
  );
  const remove = Object.keys(base.files).filter(
    (path) => !Object.hasOwn(next.files, path),
  );
  return { parents: next.parents, change: next.change, set, remove };
}

const invalid = () =>
  new SyncError(400, "INVALID_DELTA", "Invalid project snapshot changes.");

/**
 * Rebuilds the full snapshot. The caller still validates the result and
 * compares its revision, so a wrong base can only produce a mismatch.
 */
export function applySnapshotDelta(
  base: ProjectSnapshot,
  value: unknown,
  projectId: string,
): ProjectSnapshot {
  const delta = value as SnapshotDelta;
  if (
    !delta ||
    typeof delta !== "object" ||
    !Array.isArray(delta.parents) ||
    !delta.change ||
    typeof delta.change !== "object" ||
    !delta.set ||
    typeof delta.set !== "object" ||
    Array.isArray(delta.set) ||
    !Array.isArray(delta.remove) ||
    delta.remove.length > 100_000 ||
    Object.keys(delta.set).length > 100_000
  )
    throw invalid();
  const files = new Map(Object.entries(base.files));
  for (const path of delta.remove) {
    if (typeof path !== "string" || !files.delete(path)) throw invalid();
  }
  for (const [path, digest] of Object.entries(delta.set)) {
    if (typeof digest !== "string") throw invalid();
    files.set(path, digest);
  }
  return {
    format: syncProtocol,
    projectId,
    parents: delta.parents,
    files: Object.fromEntries(files),
    change: delta.change,
  };
}
