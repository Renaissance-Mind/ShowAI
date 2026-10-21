import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ContentLibrary as GitLibrary } from "./content-library";
import {
  changeContext,
  libraryMutations,
  legacyMutations,
} from "./history-context";
import { withLibraryLock } from "./library-lock";
import { CoreError } from "./model";
import type { ChangeContext, FileChanges } from "./history-model";

export const libraryReadSnapshot = new AsyncLocalStorage<{
  root: string;
  library: GitLibrary;
  revision: string | null;
}>();
export async function withLibrarySnapshot<T>(
  home: string,
  action: () => Promise<T>,
): Promise<T> {
  const root = resolve(home);
  if (
    libraryReadSnapshot.getStore()?.root === root ||
    libraryMutations.getStore()?.root === root
  )
    return action();
  const library = versionedLibrary(root);
  if (!library) return action();
  return withLibraryLock(root, async () =>
    libraryReadSnapshot.run(
      { root, library, revision: await library.head() },
      action,
    ),
  );
}

export function versionedLibrary(home: string): GitLibrary | undefined {
  const root = resolve(home);
  const snapshot = libraryReadSnapshot.getStore();
  if (snapshot?.root === root) return snapshot.library;
  const marker = join(root, "library.json");
  if (!existsSync(marker)) return undefined;
  const manifest = JSON.parse(readFileSync(marker, "utf8"));
  if (manifest.format !== "showai-library" || manifest.version !== 2)
    throw new CoreError("INVALID_DATA", "Unsupported content library format.");
  return new GitLibrary(root);
}
export function workspaceRoot(home: string): string {
  return versionedLibrary(home)?.workspace ?? resolve(home);
}

export function logicalPath(home: string, path: string): string | undefined {
  const library = versionedLibrary(home);
  if (!library) return undefined;
  const local = relative(library.workspace, resolve(path));
  if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
    return undefined;
  const name = local.split(sep).join("/");
  return /^(projects\/|packages\/|assets\/|publications\/|imports\/|runtimes\/|sidebar\.json$)/.test(
    name,
  )
    ? name
    : undefined;
}

export async function mutateLibrary<T>(
  home: string,
  action: () => Promise<T>,
  context: ChangeContext = changeContext(),
): Promise<T> {
  const library = versionedLibrary(home);
  if (!library) {
    const root = resolve(home);
    if (legacyMutations.getStore() === root) return action();
    const result = await withLibraryLock(root, async () => {
      // Activation may have completed while this writer waited for its lease.
      if (versionedLibrary(root)) return { migrated: true as const };
      return {
        migrated: false as const,
        value: await legacyMutations.run(root, action),
      };
    });
    return result.migrated
      ? mutateLibrary(root, action, context)
      : result.value;
  }
  const state = libraryMutations.getStore();
  if (state?.root === library.root) {
    const origins = Object.fromEntries(
      ["restoredFrom", "mergedFrom", "externalConflictId", "restoredSnapshot"]
        .filter((key) => context[key as keyof ChangeContext] !== undefined)
        .map((key) => [key, context[key as keyof ChangeContext]]),
    );
    state.origins = { ...state.origins, ...origins };
    return action();
  }
  const result = await library.transaction(context, action);
  if (result.entry?.workspaceConflicts?.length) {
    const error = new CoreError(
      "CONFLICT",
      "保存失败：外部文件在保存期间发生变化。修改及外部版本均已保留，请立即处理冲突。",
      {
        conflictId: result.entry.workspaceConflicts[0].id,
        currentRevision: result.entry.revision,
      },
    );
    error.saveFailed = true;
    error.recovery = { action: "read-compare-save" };
    throw error;
  }
  // A saved page or dataset record, possibly inside a dataset apply result.
  const savedRecord = (value: unknown) =>
    !!value &&
    typeof value === "object" &&
    ("document" in value || "dataset" in value) &&
    "path" in value;
  const record =
    !savedRecord(result.value) &&
    result.value &&
    typeof result.value === "object" &&
    "record" in result.value &&
    savedRecord((result.value as { record: unknown }).record)
      ? (result.value as { record: unknown }).record
      : result.value;
  if (
    result.entry &&
    record &&
    typeof record === "object" &&
    ("document" in record || "dataset" in record) &&
    "path" in record &&
    typeof record.path === "string"
  ) {
    const path = logicalPath(home, record.path);
    if (path)
      Object.assign(record, {
        revision: await library.resourceRevision(path, result.entry.revision),
        ...(result.entry.workspaceConflicts?.length
          ? { workspaceConflicts: result.entry.workspaceConflicts }
          : {}),
      });
  }
  return result.value;
}

export async function writeLibraryFiles(
  home: string,
  changes: FileChanges,
  expected?: Map<string, string | null>,
): Promise<void> {
  const library = versionedLibrary(home);
  if (!library)
    throw new CoreError(
      "INVALID_DATA",
      "Versioned writes require an initialized library.",
    );
  const state = libraryMutations.getStore();
  if (state?.root === library.root) await library.stageFiles(changes, expected);
  else await library.writeFiles(changes, changeContext(), expected);
}

export async function readLibraryFile(
  home: string,
  path: string,
): Promise<Buffer | undefined> {
  const library = versionedLibrary(home),
    name = logicalPath(home, path);
  if (!library || !name) return undefined;
  const state = libraryMutations.getStore();
  if (state?.root === library.root && state.changes.has(name)) {
    const bytes = state.changes.get(name);
    if (bytes === null)
      throw new CoreError(
        "NOT_FOUND",
        `File removed in this transaction: ${name}`,
      );
    return bytes;
  }
  return library.readFile(
    name,
    state?.root === library.root
      ? (state.head ?? undefined)
      : libraryReadSnapshot.getStore()?.root === library.root
        ? (libraryReadSnapshot.getStore()!.revision ?? undefined)
        : undefined,
  );
}

interface PathIndex {
  list: readonly string[];
  files: ReadonlySet<string>;
  directories: ReadonlySet<string>;
  objects: ReadonlyMap<string, string>;
}
const emptyIndex: PathIndex = {
  list: [],
  files: new Set(),
  directories: new Set(),
  objects: new Map(),
};
/** Trees of committed revisions never change; most path checks reuse one index. */
const pathIndexes = new Map<string, Promise<PathIndex>>();
function revisionIndex(library: GitLibrary, head: string | null) {
  if (!head) return Promise.resolve(emptyIndex);
  const key = `${library.root}\0${head}`;
  let index = pathIndexes.get(key);
  if (index) {
    pathIndexes.delete(key);
    pathIndexes.set(key, index);
    return index;
  }
  index = library.tree(head).then((entries) => {
    const objects = new Map(entries.map((entry) => [entry.path, entry.oid]));
    const list = entries
      .map((entry) => entry.path)
      .filter((path) => !/\/pages\/[^/]+\/nodes\//.test(path));
    const directories = new Set<string>();
    for (const path of list)
      for (
        let end = path.indexOf("/");
        end > 0;
        end = path.indexOf("/", end + 1)
      )
        directories.add(path.slice(0, end));
    return { list, files: new Set(list), directories, objects };
  });
  index.catch(() => pathIndexes.delete(key));
  pathIndexes.set(key, index);
  while (pathIndexes.size > 4)
    pathIndexes.delete(pathIndexes.keys().next().value!);
  return index;
}
async function currentPaths(home: string) {
  const library = versionedLibrary(home);
  if (!library) return undefined;
  const state = libraryMutations.getStore();
  const snapshot = libraryReadSnapshot.getStore();
  const head =
    state?.root === library.root
      ? state.head
      : snapshot?.root === library.root
        ? snapshot.revision
        : await library.head();
  return {
    index: await revisionIndex(library, head),
    changes: state?.root === library.root ? state.changes : undefined,
  };
}

/**
 * Stored object identity of a file while a read snapshot or mutation pins the
 * revision; undefined when unpinned or when the mutation staged a new version.
 */
export async function pinnedFileIdentity(
  home: string,
  path: string,
): Promise<string | undefined> {
  const library = versionedLibrary(home);
  if (!library) return undefined;
  const state = libraryMutations.getStore();
  const snapshot = libraryReadSnapshot.getStore();
  const pinned =
    state?.root === library.root
      ? { head: state.head, changes: state.changes }
      : snapshot?.root === library.root
        ? { head: snapshot.revision, changes: undefined }
        : undefined;
  const name = logicalPath(home, path);
  if (!pinned || !name || pinned.changes?.has(name)) return undefined;
  return (await revisionIndex(library, pinned.head)).objects.get(name);
}

export async function libraryPaths(
  home: string,
): Promise<string[] | undefined> {
  const current = await currentPaths(home);
  if (!current) return undefined;
  if (!current.changes?.size) return [...current.index.list];
  const paths = new Set(current.index.list);
  for (const [path, bytes] of current.changes) {
    if (bytes === null) paths.delete(path);
    else paths.add(path);
  }
  return [...paths];
}

export async function listLibraryDirectory(
  home: string,
  path: string,
): Promise<string[] | undefined> {
  const library = versionedLibrary(home);
  if (!library) return undefined;
  const local = relative(library.workspace, path).split(sep).join("/");
  if (
    local.startsWith("../") ||
    !/^(projects|packages|assets|publications)(\/|$)/.test(local)
  )
    return undefined;
  const prefix = `${local}/`;
  return [
    ...new Set(
      (await libraryPaths(home))!
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length).split("/")[0]),
    ),
  ];
}

export async function libraryFileInfo(
  home: string,
  path: string,
): Promise<{ file: boolean; directory: boolean } | undefined> {
  const name = logicalPath(home, path);
  if (!name) return undefined;
  const { index, changes } = (await currentPaths(home))!;
  const staged = changes?.get(name);
  if (staged !== undefined ? staged !== null : index.files.has(name))
    return { file: true, directory: false };
  const prefix = `${name}/`;
  let directory = false;
  if (changes?.size) {
    for (const [path, bytes] of changes)
      if (bytes !== null && path.startsWith(prefix)) directory = true;
    // Staged deletions may remove every committed file below this directory.
    if (!directory && index.directories.has(name))
      directory = index.list.some(
        (path) => path.startsWith(prefix) && changes.get(path) !== null,
      );
  } else directory = index.directories.has(name);
  if (directory || dirname(path) === workspaceRoot(home))
    return { file: false, directory: true };
  return undefined;
}
