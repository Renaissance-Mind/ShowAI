import { join } from "node:path";
import { listBuiltinComponents, listComponents, listTemplates } from "./catalog";
import { listPublications } from "./publication";
import { IndexClient } from "./index-client";
import { changeContext, libraryMutations } from "./history-context";
import {
  libraryPaths,
  logicalPath,
  mutateLibrary,
  versionedLibrary,
  workspaceRoot,
  writeLibraryFiles,
} from "./library-runtime";
import { CoreError } from "./model";
import { FileStore } from "./store";

export type RemovableScope = "project" | "global" | "published";
export interface CatalogRemovalInput {
  kind: "component" | "template";
  id: string;
  /** Without a version every revision of the package in this scope goes. */
  version?: string;
  scope?: RemovableScope;
  /** Required for the project scope. */
  projectId?: string;
}
export interface RemovedRevision {
  kind: "component" | "template";
  id: string;
  version: string;
  integrity: string;
  scope: RemovableScope;
  projectId?: string;
}
/** Where the revisions are still used; removal waits until every list is empty. */
export interface CatalogUses {
  pages: {
    projectId: string;
    pageId: string;
    title?: string;
    archived?: boolean;
    blockIds: string[];
    versions: string[];
  }[];
  packages: { kind: string; id: string; version?: string; source: string }[];
  publications: { releaseId: string; manifestUrl: string }[];
}

const PAGE = /^projects\/([^/]+)\/pages\/([^/]+)\.json$/;
const PACKAGE =
  /^(?:projects\/[^/]+\/)?packages\/(?:published\/)?(components|templates)\/([^/]+)(?:\/([^/]+))?/;

function packageDirectory(
  home: string,
  kind: "component" | "template",
  scope: RemovableScope,
  projectId?: string,
) {
  const folder = kind === "component" ? "components" : "templates";
  const root = workspaceRoot(home);
  if (scope === "published") return join(root, "packages", "published", folder);
  if (scope === "global") return join(root, "packages", folder);
  return join(root, "projects", projectId!, "packages", folder);
}

async function revisions(
  home: string,
  input: Required<Pick<CatalogRemovalInput, "kind" | "id">> &
    CatalogRemovalInput & { scope: RemovableScope },
): Promise<RemovedRevision[]> {
  const options = { scope: input.scope };
  const listed =
    input.kind === "component"
      ? await listComponents(home, input.projectId, options)
      : await listTemplates(home, input.projectId, options);
  return listed
    .filter(
      (item) =>
        item.id === input.id &&
        item.scope === input.scope &&
        (!input.version || item.version === input.version),
    )
    .map((item) => ({
      kind: input.kind,
      id: item.id,
      version: item.version,
      integrity: item.integrity,
      scope: input.scope,
      ...(input.scope === "project" ? { projectId: input.projectId } : {}),
    }));
}

/**
 * Pages, other packages and verified publications that use these revisions.
 * A project revision is only reachable from its own project; global and
 * published ones from every project.
 */
export async function catalogUses(
  home: string,
  removed: RemovedRevision[],
): Promise<CatalogUses> {
  const uses: CatalogUses = { pages: [], packages: [], publications: [] };
  if (!removed.length) return uses;
  const [first] = removed;
  const matches = (version?: string, integrity?: string) =>
    removed.some(
      (revision) =>
        revision.version === version &&
        (!integrity || revision.integrity === integrity),
    );
  // The package's own files reference their own dependencies, not uses of it.
  const own = (source: string) => {
    const match = PACKAGE.exec(source);
    return (
      !!match &&
      match[1] === `${first.kind}s` &&
      match[2] === first.id &&
      (!match[3] || matches(match[3]))
    );
  };
  const edges = (
    await new IndexClient(home).references(first.kind, first.id, {
      ...(first.scope === "project" ? { projectId: first.projectId } : {}),
    })
  ).filter((edge) => matches(edge.version, edge.integrity) && !own(edge.source));
  const pages = new Map<string, CatalogUses["pages"][number]>();
  for (const edge of edges) {
    const page = PAGE.exec(edge.source);
    if (!page) {
      const pkg = PACKAGE.exec(edge.source);
      if (!uses.packages.some((item) => item.source === edge.source))
        uses.packages.push({
          kind: pkg?.[1] === "templates" ? "template" : "component",
          id: pkg?.[2] ?? edge.source,
          ...(pkg?.[3] ? { version: pkg[3] } : {}),
          source: edge.source,
        });
      continue;
    }
    const key = `${page[1]}/${page[2]}`;
    const entry = pages.get(key) ?? {
      projectId: page[1],
      pageId: page[2],
      blockIds: [],
      versions: [],
    };
    if (edge.blockId && !entry.blockIds.includes(edge.blockId))
      entry.blockIds.push(edge.blockId);
    if (edge.version && !entry.versions.includes(edge.version))
      entry.versions.push(edge.version);
    pages.set(key, entry);
  }
  // Titles and archived state tell the person which pages to change; deleted
  // pages still count because restoring them would bring the use back.
  const store = new FileStore(home);
  for (const projectId of new Set([...pages.values()].map((p) => p.projectId)))
    for (const summary of await store.listPages(projectId)) {
      const entry = pages.get(`${projectId}/${summary.id}`);
      if (!entry) continue;
      entry.title = summary.title;
      if (summary.archived) entry.archived = true;
    }
  uses.pages = [...pages.values()];
  for (const receipt of await listPublications(home))
    if (
      receipt.components.some((locator) =>
        [locator.ref, locator.bundleRef].some(
          (ref) =>
            ref.kind === first.kind &&
            ref.id === first.id &&
            matches(ref.version, ref.integrity),
        ),
      )
    )
      uses.publications.push({
        releaseId: receipt.releaseId,
        manifestUrl: receipt.manifestUrl,
      });
  return uses;
}

/**
 * Remove a component or template revision, or every revision of the package
 * in one scope. Built-in entries cannot be removed, and nothing is removed
 * while a page, package or publication still uses one of the revisions.
 */
export async function removeCatalogPackage(
  home: string,
  input: CatalogRemovalInput,
): Promise<{ removed: RemovedRevision[] }> {
  const scope = input.scope ?? "project";
  if (!["component", "template"].includes(input.kind))
    throw new CoreError("INVALID_DATA", "kind must be component or template.");
  if ((scope as string) === "builtin")
    throw new CoreError(
      "INVALID_DATA",
      "Built-in components and templates are part of ShowAI and cannot be removed.",
    );
  if (!["project", "global", "published"].includes(scope))
    throw new CoreError(
      "INVALID_DATA",
      "scope must be project, global or published.",
    );
  if (scope === "project" && !input.projectId)
    throw new CoreError(
      "INVALID_DATA",
      "Removing a project revision requires projectId.",
    );
  const library = versionedLibrary(home);
  if (!library)
    throw new CoreError(
      "INVALID_DATA",
      "This library needs a one-time import into the versioned format.",
    );
  // The use check reads the library index, which waits for the library lock.
  if (libraryMutations.getStore()?.root === library.root)
    throw new Error("Catalog removal runs its own library transaction.");
  const target = { ...input, scope };
  const found = await revisions(home, target);
  if (!found.length) {
    const builtin =
      input.kind === "component"
        ? listBuiltinComponents({ includeLegacy: true }).some(
            (item) => item.kind === input.id,
          )
        : (await listTemplates(home, undefined, { scope: "builtin" })).some(
            (item) => item.id === input.id,
          );
    throw new CoreError(
      builtin ? "INVALID_DATA" : "NOT_FOUND",
      builtin
        ? "Built-in components and templates are part of ShowAI and cannot be removed."
        : `No ${scope} ${input.kind} ${input.id}${input.version ? `@${input.version}` : ""} to remove.`,
    );
  }
  const checkedAt = await library.head();
  const uses = await catalogUses(home, found);
  if (uses.pages.length || uses.packages.length || uses.publications.length) {
    const error = new CoreError(
      "IN_USE",
      `${input.kind} ${input.id}${input.version ? `@${input.version}` : ""} is still used by ${[
        uses.pages.length && `${uses.pages.length} page(s)`,
        uses.packages.length && `${uses.packages.length} package revision(s)`,
        uses.publications.length &&
          `${uses.publications.length} publication(s)`,
      ]
        .filter(Boolean)
        .join(", ")}; nothing was removed.`,
    );
    error.details = { uses };
    throw error;
  }
  const base = packageDirectory(home, input.kind, scope, input.projectId);
  return mutateLibrary(
    home,
    async () => {
      // Uses were checked at one revision; a newer save could have added one.
      if (libraryMutations.getStore()?.head !== checkedAt)
        throw new CoreError(
          "CONFLICT",
          "The library changed while removal was checked. Run the removal again.",
        );
      const all = (await libraryPaths(home))!;
      const paths: string[] = [];
      for (const revision of found) {
        const prefix = `${logicalPath(home, join(base, revision.id, revision.version))!}/`;
        const files = all.filter((path) => path.startsWith(prefix));
        // Early templates were one file per id rather than a version folder.
        if (!files.length && input.kind === "template")
          files.push(logicalPath(home, join(base, `${revision.id}.json`))!);
        paths.push(...files);
      }
      await writeLibraryFiles(
        home,
        new Map(paths.map((path) => [path, null])),
      );
      return { removed: found };
    },
    {
      ...changeContext(),
      message:
        changeContext().message ??
        `Remove ${input.kind} ${input.id}${input.version ? `@${input.version}` : ""}`,
    },
  );
}
