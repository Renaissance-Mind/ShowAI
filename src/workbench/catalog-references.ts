import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LibraryOperations } from "../core/library-operations";
import { workspaceRoot } from "../core/library-runtime";
import type { ReferenceEdge } from "../core/library-index";
import type { FileStore } from "../core/store";

/** One page that shows a package revision, with the blocks that do. */
export interface CatalogPageReference {
  projectId: string;
  projectName: string;
  pageId: string;
  title: string;
  blockIds: string[];
  revisions: { version?: string; integrity?: string }[];
}
/** Another package revision that depends on the target. */
export interface CatalogPackageReference {
  kind: "component" | "template";
  id: string;
  /** The package's display name, when its revision file was read. */
  name?: string;
  version?: string;
  scope: "project" | "global" | "published";
  projectId?: string;
  projectName?: string;
  /** The target revisions this package depends on. */
  revisions: { version?: string; integrity?: string }[];
}
export interface CatalogReferences {
  pages: CatalogPageReference[];
  packages: CatalogPackageReference[];
}

const PAGE = /^projects\/([^/]+)\/pages\/([^/]+)(?:\.json|\/reader\.json)$/;
const PACKAGE =
  /^(?:projects\/([^/]+)\/)?packages\/(published\/)?(components|templates)\/([^/]+)(?:\/([^/]+))?/;

/** Groups index edges per page and per depending package, named for people. */
export function groupCatalogReferences(
  edges: ReferenceEdge[],
  names: {
    project: (projectId: string) => string | undefined;
    page: (projectId: string, pageId: string) => string | undefined;
    /** Name of the package revision at a library path such as `packages/templates/x/1.0.0`. */
    package?: (path: string) => string | undefined;
  },
): CatalogReferences {
  const pages = new Map<string, CatalogPageReference>();
  const packages = new Map<string, CatalogPackageReference>();
  const addRevision = (
    revisions: { version?: string; integrity?: string }[],
    edge: ReferenceEdge,
  ) => {
    if (
      !revisions.some(
        (item) =>
          item.version === edge.version && item.integrity === edge.integrity,
      )
    )
      revisions.push({
        ...(edge.version ? { version: edge.version } : {}),
        ...(edge.integrity ? { integrity: edge.integrity } : {}),
      });
  };
  for (const edge of edges) {
    const page = PAGE.exec(edge.source);
    if (page) {
      const [, projectId, pageId] = page;
      const key = `${projectId}/${pageId}`;
      const entry = pages.get(key) ?? {
        projectId,
        projectName: names.project(projectId) ?? projectId,
        pageId,
        title: names.page(projectId, pageId) ?? pageId,
        blockIds: [],
        revisions: [],
      };
      if (edge.blockId && !entry.blockIds.includes(edge.blockId))
        entry.blockIds.push(edge.blockId);
      addRevision(entry.revisions, edge);
      pages.set(key, entry);
      continue;
    }
    const pkg = PACKAGE.exec(edge.source);
    if (!pkg) continue;
    const [, projectId, published, folder, id, version] = pkg;
    const key = `${projectId ?? ""}/${published ?? ""}${folder}/${id}/${version ?? ""}`;
    const name = names.package?.(pkg[0]);
    const entry = packages.get(key) ?? {
      kind: folder === "components" ? "component" : "template",
      id,
      ...(name ? { name } : {}),
      ...(version ? { version } : {}),
      scope: projectId ? "project" : published ? "published" : "global",
      ...(projectId
        ? { projectId, projectName: names.project(projectId) ?? projectId }
        : {}),
      revisions: [],
    };
    addRevision(entry.revisions, edge);
    packages.set(key, entry);
  }
  const byName = (left: string, right: string) => left.localeCompare(right);
  return {
    pages: [...pages.values()].sort(
      (left, right) =>
        byName(left.projectName, right.projectName) ||
        byName(left.title, right.title),
    ),
    packages: [...packages.values()].sort(
      (left, right) =>
        byName(left.id, right.id) ||
        byName(left.version ?? "", right.version ?? ""),
    ),
  };
}

/** Where a package revision is used across the whole library. */
export async function catalogReferences(
  store: FileStore,
  input: {
    kind: "component" | "template";
    id: string;
    version?: string;
    integrity?: string;
  },
): Promise<CatalogReferences> {
  const edges = await new LibraryOperations(store.root).references(
    input.kind,
    input.id,
    { version: input.version, integrity: input.integrity },
  );
  const projectIds = new Set<string>();
  for (const edge of edges) {
    const owner = /^projects\/([^/]+)\//.exec(edge.source)?.[1];
    if (owner) projectIds.add(owner);
  }
  const projects = new Map<string, string>(),
    titles = new Map<string, string>(),
    packageNames = new Map<string, string>();
  for (const edge of edges) {
    const pkg = PACKAGE.exec(edge.source);
    if (!pkg?.[5] || packageNames.has(pkg[0])) continue;
    const file = pkg[3] === "components" ? "compiled.json" : "template.json";
    const record = JSON.parse(
      await readFile(join(workspaceRoot(store.root), pkg[0], file), "utf8"),
    ) as { name?: unknown };
    if (typeof record.name === "string") packageNames.set(pkg[0], record.name);
  }
  for (const project of await store.listProjects({
    includeArchived: true,
    projectIds: [...projectIds],
  })) {
    projects.set(project.id, project.name);
    for (const page of await store.listPages(project.id, {
      includeArchived: true,
    }))
      titles.set(`${project.id}/${page.id}`, page.title);
  }
  return groupCatalogReferences(edges, {
    project: (id) => projects.get(id),
    page: (projectId, pageId) => titles.get(`${projectId}/${pageId}`),
    package: (path) => packageNames.get(path),
  });
}
