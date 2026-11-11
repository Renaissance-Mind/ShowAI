import type {
  CatalogScope,
  EditablePackage,
  MergeConflict,
  PackageRevisionRef,
} from "../components/custom/types";

export type PackageKind = "component" | "template";

/** The fields of a catalog listing that identify and order its revisions. */
export interface RevisionItem {
  id: string;
  name: string;
  version: string;
  integrity: string;
  scope: CatalogScope;
  updatedAt?: string;
  parents?: PackageRevisionRef[];
  /** The project that owns a project-scope revision. */
  projectId?: string;
}

const SCOPE_ORDER: Record<string, number> = {
  project: 0,
  global: 1,
  published: 2,
  builtin: 3,
};

/** The exact revision reference catalog actions take. */
export function exactRef(
  kind: PackageKind,
  item: Pick<RevisionItem, "id" | "version" | "integrity" | "scope">,
  projectId?: string,
): PackageRevisionRef {
  return {
    kind,
    id: item.id,
    version: item.version,
    integrity: item.integrity,
    scope: item.scope,
    ...(item.scope === "project" && projectId ? { projectId } : {}),
  };
}

function parseVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version);
  return match
    ? {
        numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
        pre: match[4],
      }
    : null;
}

/** Semantic version order; a prerelease sorts before its release. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left),
    b = parseVersion(right);
  if (!a || !b) return left.localeCompare(right, undefined, { numeric: true });
  for (let index = 0; index < 3; index++)
    if (a.numbers[index] !== b.numbers[index])
      return a.numbers[index] - b.numbers[index];
  if (a.pre === b.pre) return 0;
  if (a.pre === undefined) return 1;
  if (b.pre === undefined) return -1;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true });
}

/** The next free patch version after `version`. */
export function nextVersion(version: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const parsed = parseVersion(version);
  const [major, minor] = parsed?.numbers ?? [1, 0];
  let patch = parsed?.numbers[2] ?? -1;
  for (const item of used) {
    const other = parseVersion(item);
    if (
      other &&
      other.numbers[0] === major &&
      other.numbers[1] === minor &&
      other.numbers[2] > patch
    )
      patch = other.numbers[2];
  }
  let candidate: string;
  do candidate = `${major}.${minor}.${++patch}`;
  while (used.has(candidate));
  return candidate;
}

/** Every revision of one package, newest first, project copies before shared ones. */
export function packageRevisions<T extends RevisionItem>(
  items: T[],
  id: string,
): T[] {
  return items
    .filter((item) => item.id === id)
    .sort(
      (left, right) =>
        compareVersions(right.version, left.version) ||
        (SCOPE_ORDER[left.scope] ?? 9) - (SCOPE_ORDER[right.scope] ?? 9),
    );
}

export interface Divergence<T extends RevisionItem> {
  /** The shared revision the project copy started from. */
  base: T;
  /** Newer shared revisions of the origin, newest first. */
  candidates: T[];
}

/**
 * A project copy diverged from its origin when the shared catalog has a newer
 * revision of the package it was forked or last merged from.
 */
export function divergence<T extends RevisionItem>(
  current: RevisionItem,
  items: T[],
): Divergence<T> | null {
  if (current.scope !== "project" || !current.parents?.length) return null;
  const shared = items.filter((item) => item.scope !== "project");
  // After a merge the origin parent is the shared one; after a fork it is the only one.
  const base = current.parents
    .map((parent) =>
      shared.find(
        (item) =>
          item.id === parent.id &&
          item.version === parent.version &&
          item.integrity === parent.integrity,
      ),
    )
    .filter((item): item is T => !!item)
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  if (!base) return null;
  const merged = new Set(current.parents.map((parent) => parent.integrity));
  const candidates = packageRevisions(shared, base.id).filter(
    (item) =>
      item.integrity !== base.integrity &&
      !merged.has(item.integrity) &&
      compareVersions(item.version, base.version) > 0,
  );
  return candidates.length ? { base, candidates } : null;
}

function decodePointer(path: string): string[] {
  if (path === "/" || path === "") return [];
  return path
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** A conflict path in reading order, e.g. `manifest › description`. */
export function conflictLabel(path: string): string {
  const parts = decodePointer(path);
  return parts.length ? parts.join(" › ") : "/";
}

export type MergeChoice = "ours" | "theirs";

/**
 * The merge preview keeps the project value at every conflict. Applies the
 * person's choices: taking the origin value, or removing the field when the
 * origin removed it.
 */
export function applyMergeChoices(
  merged: EditablePackage,
  conflicts: MergeConflict[],
  choices: Record<string, MergeChoice>,
): EditablePackage {
  let result = structuredClone(merged) as unknown;
  for (const conflict of conflicts) {
    if (choices[conflict.path] !== "theirs") continue;
    const parts = decodePointer(conflict.path);
    const value =
      conflict.theirs === undefined
        ? undefined
        : structuredClone(conflict.theirs);
    if (!parts.length) {
      result = value;
      continue;
    }
    let target = result as Record<string, unknown>;
    for (const key of parts.slice(0, -1)) {
      const next = target[key];
      if (!next || typeof next !== "object") target[key] = {};
      target = target[key] as Record<string, unknown>;
    }
    const last = parts.at(-1)!;
    if (value === undefined) delete target[last];
    else target[last] = value;
  }
  return result as EditablePackage;
}

/** A conflict value shown for comparison: text as is, other values as JSON. */
export function conflictValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/**
 * Whether a refused removal says the revision is still in use. The remove
 * actions report referencing pages; any of these shapes counts.
 */
export function isStillReferenced(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, details } = error as {
    code?: unknown;
    details?: Record<string, unknown>;
  };
  if (
    details &&
    ["references", "pages", "referencedBy"].some(
      (key) => Array.isArray(details[key]) && details[key].length > 0,
    )
  )
    return true;
  return code === "REFERENCED" || code === "IN_USE";
}
