import { createHash } from "node:crypto";
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./diff";
import { CoreError } from "./model";
import {
  atomicLibraryFile,
  fileIdentity,
  readLibraryBytes,
  readLibraryFileState,
  safeLibraryPath,
} from "./library-files";
import type { ContentLibrary as GitLibrary } from "./content-library";
import { holdsLibraryLock, withLibraryLock } from "./library-lock";

export interface WorkspaceConflict {
  format: "showai-workspace-conflict";
  version: 1;
  id: string;
  path: string;
  baseRevision: string | null;
  observedAt: string;
  kind: "added" | "modified" | "deleted";
  observedHash: string | null;
  state: "unresolved" | "resolved";
  resolution?: "discard" | "import" | "merge";
  resolvedAt?: string;
  resolvedRevision?: string | null;
}

export function workspaceHash(
  path: string,
  bytes: Buffer | null,
): string | null {
  if (bytes === null) return null;
  const exact = /\/components\//.test(path) && !path.endsWith("/compiled.json");
  let normalized: string | Buffer = bytes;
  if (path.endsWith(".json") && !exact) {
    try {
      normalized = canonicalJson(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Records external edits among workspace files. Comparing reads one committed
 * state without the writer lease; files that match it, or that a save is still
 * writing, need nothing more. Only the rest are confirmed and recorded under the
 * lease, after any save in progress finishes.
 */
export async function recordWorkspaceChanges(
  library: Pick<
    GitLibrary,
    "root" | "workspace" | "treeEntries" | "readFiles" | "head" | "readSnapshot"
  >,
  paths: string[],
): Promise<WorkspaceConflict[]> {
  const protection = new WorkspaceProtection(library);
  if (holdsLibraryLock(library.root))
    return protection.inspect(paths, await library.head());
  let suspects = paths.length
    ? await library.readSnapshot((head) => protection.changed(paths, head))
    : [];
  if (suspects.length) {
    const writing = await protection.writing();
    suspects = suspects.filter((path) => !writing.has(path));
  }
  const conflicts: WorkspaceConflict[] = [];
  for (let offset = 0; offset < suspects.length; offset += 16)
    conflicts.push(
      ...(await withLibraryLock(library.root, async () =>
        protection.inspect(
          suspects.slice(offset, offset + 16),
          await library.head(),
        ),
      )),
    );
  return conflicts;
}

/**
 * Parsed conflict records by conflicts directory and id, with the identity of
 * the file each was read from. capture() can rewrite a resolved record as
 * unresolved under the same id, so a record is reused only while its file is.
 */
const conflictRecords = new Map<
  string,
  Map<string, { identity: string; record: WorkspaceConflict }>
>();

const COMPARE_BATCH = 16;
const sameBytes = (a: Buffer | null, b: Buffer | null) =>
  a === null || b === null ? a === b : a.equals(b);

/** External content stays in place and is independently retained before resolution. */
export class WorkspaceProtection {
  /** Workspace bytes baseline() fingerprinted, so materialize() can reuse them. */
  private recorded = new Map<
    string,
    { bytes: Buffer | null; hash: string | null }
  >();
  /** Committed files the caller already holds, by revision; null marks an absent path. */
  private known = new Map<string, Map<string, Buffer | null>>();
  constructor(
    readonly library: Pick<
      GitLibrary,
      "root" | "workspace" | "treeEntries" | "readFiles"
    >,
  ) {}

  async list(path?: string): Promise<WorkspaceConflict[]> {
    const root = join(this.library.root, "local", "conflicts");
    const entries = await readdir(root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    let cache = conflictRecords.get(root);
    if (!cache) conflictRecords.set(root, (cache = new Map()));
    const records: WorkspaceConflict[] = [],
      present = new Set<string>();
    let parentsChecked = false;
    for (const entry of entries) {
      const name = entry.name;
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      present.add(name);
      const file = join(root, name, "conflict.json");
      // A real directory holding an unchanged regular file needs no read.
      if (entry.isDirectory() && !parentsChecked) {
        await safeLibraryPath(this.library.root, root);
        parentsChecked = true;
      }
      const info = entry.isDirectory()
        ? await lstat(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          })
        : undefined;
      const cached = cache.get(name);
      let value: WorkspaceConflict;
      if (info?.isFile() && cached?.identity === fileIdentity(info))
        value = cached.record;
      else {
        const read = await readLibraryFileState(this.library.root, file);
        if (!read) {
          cache.delete(name);
          continue;
        }
        value = JSON.parse(read.bytes.toString("utf8")) as WorkspaceConflict;
        if (
          value.format !== "showai-workspace-conflict" ||
          value.version !== 1 ||
          value.id !== name ||
          !value.path ||
          !["unresolved", "resolved"].includes(value.state)
        )
          throw new CoreError(
            "INVALID_DATA",
            "Invalid workspace conflict record.",
          );
        cache.set(name, { identity: read.identity, record: value });
      }
      if (!path || value.path === path) records.push({ ...value });
    }
    for (const name of cache.keys()) if (!present.has(name)) cache.delete(name);
    return records.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }

  async capture(
    path: string,
    baseRevision: string | null,
    observed: Buffer | null,
    existed: boolean,
  ): Promise<WorkspaceConflict> {
    const observedHash = workspaceHash(path, observed);
    const existing = (await this.list(path)).find(
      (record) =>
        record.state === "unresolved" && record.observedHash === observedHash,
    );
    if (existing) return existing;
    const id = createHash("sha256")
      .update(JSON.stringify([path, baseRevision, observedHash]))
      .digest("hex");
    const record: WorkspaceConflict = {
      format: "showai-workspace-conflict",
      version: 1,
      id,
      path,
      baseRevision,
      observedHash,
      observedAt: new Date().toISOString(),
      kind: observed === null ? "deleted" : existed ? "modified" : "added",
      state: "unresolved",
    };
    const directory = join(this.library.root, "local", "conflicts", id);
    if (observed)
      await atomicLibraryFile(
        this.library.root,
        join(directory, "input"),
        observed,
      );
    await atomicLibraryFile(
      this.library.root,
      join(directory, "conflict.json"),
      Buffer.from(JSON.stringify(record, null, 2)),
    );
    return record;
  }

  /**
   * Paths of saves that committed but may still be writing workspace files. A
   * save writes its journal before committing, compares each file with its
   * prior fingerprint while writing, and removes the journal afterwards.
   */
  async writing(): Promise<Set<string>> {
    const root = join(this.library.root, "local", "transactions");
    const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const paths = new Set<string>();
    for (const name of names) {
      const bytes = await readLibraryBytes(
        this.library.root,
        join(root, name, "journal.json"),
      );
      if (!bytes) continue;
      const journal = JSON.parse(bytes.toString("utf8")) as {
        paths?: unknown;
      };
      if (Array.isArray(journal.paths))
        for (const path of journal.paths)
          if (typeof path === "string") paths.add(path);
    }
    return paths;
  }

  /** Paths whose workspace file differs from the revision. Reads only. */
  async changed(paths: string[], revision: string | null): Promise<string[]> {
    return (await this.compare(paths, revision)).map((item) => item.path);
  }

  async inspect(
    paths: string[],
    revision: string | null,
  ): Promise<WorkspaceConflict[]> {
    const conflicts: WorkspaceConflict[] = [];
    for (const item of await this.compare(paths, revision))
      conflicts.push(
        await this.capture(item.path, revision, item.actual, item.tracked),
      );
    return conflicts;
  }

  /**
   * Records files as committed at a revision, read or written by the caller in
   * the same writer transaction, so comparisons reuse them instead of reading.
   */
  remember(revision: string, files: Map<string, Buffer | null>) {
    const known = this.known.get(revision) ?? new Map();
    for (const [path, bytes] of files) known.set(path, bytes);
    this.known.set(revision, known);
  }

  /** Which of the paths the revision contains. */
  private async tracked(paths: string[], revision: string | null) {
    const known = revision ? this.known.get(revision) : undefined;
    const found = new Set(paths.filter((path) => known?.get(path)));
    const unknown = paths.filter((path) => !known?.has(path));
    if (revision && unknown.length)
      for (const entry of await this.library.treeEntries(
        { paths: unknown },
        revision,
      ))
        found.add(entry.path);
    return found;
  }

  /** Committed bytes of paths the revision contains. */
  private async committed(paths: string[], revision: string) {
    const known = this.known.get(revision);
    const unread = paths.filter((path) => !known?.get(path));
    const files = unread.length
      ? await this.library.readFiles(unread, revision)
      : new Map<string, Buffer>();
    for (const path of paths) {
      const bytes = known?.get(path);
      if (bytes) files.set(path, bytes);
    }
    return files;
  }

  private async compare(paths: string[], revision: string | null) {
    const tree = await this.tracked(paths, revision);
    const differences: {
      path: string;
      actual: Buffer | null;
      tracked: boolean;
    }[] = [];
    // A whole-library scan decodes every page and package; reading it in one
    // request held gigabytes at once and exhausted the shared V8 heap.
    for (let offset = 0; offset < paths.length; offset += COMPARE_BATCH) {
      const batch = paths.slice(offset, offset + COMPARE_BATCH),
        present = batch.filter((path) => tree.has(path));
      const committed =
        revision && present.length
          ? await this.committed(present, revision)
          : new Map<string, Buffer>();
      for (const path of batch) {
        const actual = await readLibraryBytes(
          this.library.root,
          join(this.library.workspace, path),
        );
        const expected = committed.get(path) ?? null;
        if (
          !sameBytes(actual, expected) &&
          workspaceHash(path, actual) !== workspaceHash(path, expected)
        )
          differences.push({ path, actual, tracked: tree.has(path) });
      }
    }
    return differences;
  }

  async baseline(
    paths: string[],
    revision: string | null,
    allowed = new Set<string>(),
  ): Promise<Record<string, string | null>> {
    const found = await this.inspect(paths, revision);
    const pending = (await this.list()).filter(
      (record) =>
        record.state === "unresolved" &&
        paths.includes(record.path) &&
        !allowed.has(record.id),
    );
    if (found.length || pending.length)
      throw new CoreError(
        "CONFLICT",
        "文件被外部工具修改，外部版本已保留。请先处理该资源的冲突。",
        {
          conflictId: (found[0] ?? pending[0]).id,
          currentRevision: revision ?? undefined,
        },
      );
    const result: Record<string, string | null> = Object.create(null);
    for (const path of paths) {
      const bytes = await readLibraryBytes(
        this.library.root,
        join(this.library.workspace, path),
      );
      result[path] = workspaceHash(path, bytes);
      this.recorded.set(path, { bytes, hash: result[path] });
    }
    return result;
  }

  /** workspaceHash, reusing the fingerprint baseline() took of the same bytes. */
  private fingerprint(path: string, bytes: Buffer | null) {
    const recorded = this.recorded.get(path);
    return recorded && sameBytes(recorded.bytes, bytes)
      ? recorded.hash
      : workspaceHash(path, bytes);
  }

  async materialize(
    paths: string[],
    revision: string,
    before: Record<string, string | null>,
  ): Promise<WorkspaceConflict[]> {
    const tree = await this.tracked(paths, revision);
    const files = await this.committed(
      paths.filter((path) => tree.has(path)),
      revision,
    );
    const conflicts: WorkspaceConflict[] = [];
    for (const path of paths) {
      const target = join(this.library.workspace, path);
      const actual = await readLibraryBytes(this.library.root, target),
        desired = files.get(path) ?? null;
      // Identical bytes have identical fingerprints; otherwise the file is the
      // save's own projection when it still has the fingerprint taken before.
      const fingerprint = sameBytes(actual, desired)
        ? undefined
        : this.fingerprint(path, actual);
      if (
        fingerprint !== undefined &&
        fingerprint !== before[path] &&
        fingerprint !== workspaceHash(path, desired)
      ) {
        conflicts.push(
          await this.capture(path, revision, actual, tree.has(path)),
        );
        continue;
      }
      if (desired !== null)
        await atomicLibraryFile(this.library.root, target, desired);
      else {
        await safeLibraryPath(this.library.root, target);
        await rm(target, { force: true });
      }
    }
    return conflicts;
  }

  async input(
    id: string,
  ): Promise<{ conflict: WorkspaceConflict; bytes: Buffer | null }> {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new CoreError("INVALID_PATH", "Invalid conflict identity.");
    const conflict = (await this.list()).find((record) => record.id === id);
    if (!conflict)
      throw new CoreError("NOT_FOUND", "Workspace conflict not found.");
    const bytes = await readLibraryBytes(
      this.library.root,
      join(this.library.root, "local", "conflicts", id, "input"),
    );
    if (workspaceHash(conflict.path, bytes) !== conflict.observedHash)
      throw new CoreError(
        "INVALID_DATA",
        "The preserved external draft is corrupt.",
      );
    return { conflict, bytes };
  }

  async resolve(
    id: string,
    resolution: "discard" | "import" | "merge",
    revision: string | null,
  ): Promise<WorkspaceConflict> {
    const { conflict } = await this.input(id);
    const record: WorkspaceConflict = {
      ...conflict,
      state: "resolved",
      resolution,
      resolvedAt: new Date().toISOString(),
      resolvedRevision: revision,
    };
    await atomicLibraryFile(
      this.library.root,
      join(this.library.root, "local", "conflicts", id, "conflict.json"),
      Buffer.from(JSON.stringify(record, null, 2)),
    );
    return record;
  }
}
