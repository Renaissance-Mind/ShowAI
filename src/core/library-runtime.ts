import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GitLibrary } from "./git-library";
import {
  changeContext,
  libraryMutations,
  legacyMutations,
} from "./history-context";
import { withLibraryLock } from "./library-lock";
import { CoreError } from "./model";
import type { ChangeContext, FileChanges } from "./history-model";

export function versionedLibrary(home: string): GitLibrary | undefined {
  const root = resolve(home);
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
  if (
    result.entry &&
    result.value &&
    typeof result.value === "object" &&
    "document" in result.value &&
    "path" in result.value &&
    typeof result.value.path === "string"
  ) {
    const path = logicalPath(home, result.value.path);
    if (path)
      Object.assign(result.value, {
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
    state?.root === library.root ? (state.head ?? undefined) : undefined,
  );
}

export async function libraryPaths(
  home: string,
): Promise<string[] | undefined> {
  const library = versionedLibrary(home);
  if (!library) return undefined;
  const state = libraryMutations.getStore();
  const head = state?.root === library.root ? state.head : await library.head();
  const paths = new Set(
    head
      ? (await library.tree(head))
          .map((entry) => entry.path)
          .filter((path) => !/\/pages\/[^/]+\/nodes\//.test(path))
      : [],
  );
  if (state?.root === library.root)
    for (const [path, bytes] of state.changes) {
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
): Promise<{ file: boolean; directory: boolean; size: number } | undefined> {
  const name = logicalPath(home, path);
  if (!name) return undefined;
  const paths = (await libraryPaths(home))!;
  if (paths.includes(name))
    return {
      file: true,
      directory: false,
      size: (await readLibraryFile(home, path))!.length,
    };
  if (
    paths.some((entry) => entry.startsWith(name + "/")) ||
    dirname(path) === workspaceRoot(home)
  )
    return { file: false, directory: true, size: 0 };
  return undefined;
}
