import type {
  FolderMetadata,
  PageSummary,
  ProjectSummary,
} from "../../core/model";
import type { SearchResult } from "../../core/library-index";
import type { CatalogComponent } from "../../core/component-categories";
import type { CompiledComponent } from "../../contract/types";
import {
  commandProps,
  type ComponentCommand,
} from "../../contract/contributions";
import {
  componentSlashEntry,
  insertsAsBlock,
} from "../../components/slash-menu-model";
import {
  componentDisplayDescription,
  componentDisplayName,
} from "../../components/component-display";
import { parsePageLink } from "../../document/page-link.mjs";
import type { QuickJumpItem, QuickJumpSource } from "./registry";

/** An action the workbench already has, offered as a command. */
export interface WorkbenchCommand {
  id: string;
  title: string;
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<unknown>;
}

/** What the built-in sources read and do; the workbench supplies it. */
export interface QuickJumpContext {
  projects: readonly ProjectSummary[];
  pages: Readonly<Record<string, { pages: readonly PageSummary[] } | undefined>>;
  commands: readonly WorkbenchCommand[];
  /** The latest version of each catalog component, built-in and library. */
  components: readonly CatalogComponent[];
  /** An editable page or board is open and can take a component. */
  canInsert: boolean;
  labels: Record<
    "pages" | "folders" | "projects" | "content" | "commands" | "components",
    string
  >;
  /** Full-text matches from the library index. */
  searchContent: (query: string) => Promise<readonly SearchResult[]>;
  openPage: (target: {
    projectId: string;
    pageId: string;
    blockIds: string[];
  }) => void | Promise<unknown>;
  openDirectory: (
    projectId: string,
    folderId: string | null,
  ) => void | Promise<unknown>;
  /** Inserts the component, with props computed from its compiled package. */
  insert: (
    component: CatalogComponent,
    props?: (component: Pick<CompiledComponent, "defaultData" | "examples">) => Record<string, unknown>,
  ) => Promise<unknown>;
}

interface Located {
  projectId: string;
  /** Project name, then the folder chain. */
  path: string;
}

/** Folder paths are built once per project list; typing reuses them. */
const directoryCache = new WeakMap<
  readonly ProjectSummary[],
  Map<string, { project: ProjectSummary; folders: Map<string, string> }>
>();
function directories(projects: readonly ProjectSummary[]) {
  let value = directoryCache.get(projects);
  if (value) return value;
  value = new Map();
  for (const project of projects) {
    if (project.archived) continue;
    const byId = new Map<string, FolderMetadata>(
      (project.folders ?? []).map((folder) => [folder.id, folder]),
    );
    const paths = new Map<string, string>();
    const pathOf = (id: string, depth = 0): string | undefined => {
      const known = paths.get(id);
      if (known !== undefined) return known;
      const folder = byId.get(id);
      if (!folder || folder.archived || depth > 64) return undefined;
      const parent = folder.parentId
        ? pathOf(folder.parentId, depth + 1)
        : project.name;
      if (parent === undefined) return undefined;
      const path = `${parent} / ${folder.name}`;
      paths.set(id, path);
      return path;
    };
    for (const id of byId.keys()) pathOf(id);
    value.set(project.id, { project, folders: paths });
  }
  directoryCache.set(projects, value);
  return value;
}

function locate(
  projects: readonly ProjectSummary[],
  projectId: string,
  parentId: string | null,
): Located | undefined {
  const entry = directories(projects).get(projectId);
  if (!entry) return undefined;
  if (!parentId) return { projectId, path: entry.project.name };
  const path = entry.folders.get(parentId);
  return path === undefined ? undefined : { projectId, path };
}

type PageData = { projectId: string; pageId: string; blockId?: string };

const pageItems = new WeakMap<
  QuickJumpContext["pages"],
  { projects: readonly ProjectSummary[]; items: QuickJumpItem<PageData>[] }
>();

export const pagesSource: QuickJumpSource<QuickJumpContext, PageData> = {
  id: "pages",
  label: (context) => context.labels.pages,
  limit: 8,
  emptyLimit: 8,
  search: (_query, context) => {
    const cached = pageItems.get(context.pages);
    if (cached && cached.projects === context.projects) return cached.items;
    const items: QuickJumpItem<PageData>[] = [];
    for (const project of context.projects) {
      if (project.archived) continue;
      for (const page of context.pages[project.id]?.pages ?? []) {
        if (page.archived) continue;
        const location = locate(context.projects, project.id, page.parentId);
        if (!location) continue;
        items.push({
          key: `${project.id}/${page.id}`,
          identity: `page:${project.id}/${page.id}`,
          title: page.title,
          path: location.path,
          updatedAt: page.updatedAt,
          icon: "page",
          ...(page.icon ? { emoji: page.icon } : {}),
          data: { projectId: project.id, pageId: page.id },
        });
      }
    }
    pageItems.set(context.pages, { projects: context.projects, items });
    return items;
  },
  run: (item, context) =>
    context.openPage({
      projectId: item.data.projectId,
      pageId: item.data.pageId,
      blockIds: [],
    }),
};

type DirectoryData = { projectId: string; folderId: string | null };

export const foldersSource: QuickJumpSource<QuickJumpContext, DirectoryData> = {
  id: "folders",
  label: (context) => context.labels.folders,
  search: (_query, context) =>
    context.projects.flatMap((project) =>
      project.archived
        ? []
        : (project.folders ?? []).flatMap((folder) => {
            const location = locate(
              context.projects,
              project.id,
              folder.parentId,
            );
            return location && !folder.archived
              ? [
                  {
                    key: `${project.id}/${folder.id}`,
                    title: folder.name,
                    path: location.path,
                    updatedAt: folder.updatedAt,
                    icon: "folder" as const,
                    ...(folder.icon ? { emoji: folder.icon } : {}),
                    data: { projectId: project.id, folderId: folder.id },
                  },
                ]
              : [];
          }),
    ),
  run: (item, context) =>
    context.openDirectory(item.data.projectId, item.data.folderId),
};

export const projectsSource: QuickJumpSource<QuickJumpContext, DirectoryData> =
  {
    id: "projects",
    label: (context) => context.labels.projects,
    search: (_query, context) =>
      context.projects
        .filter((project) => !project.archived)
        .map((project) => ({
          key: project.id,
          title: project.name,
          updatedAt: project.updatedAt,
          icon: "project" as const,
          ...(project.icon ? { emoji: project.icon } : {}),
          data: { projectId: project.id, folderId: null },
        })),
    run: (item, context) =>
      context.openDirectory(item.data.projectId, item.data.folderId),
  };

/** Page text matches from the library index, after every title match. */
export const contentSource: QuickJumpSource<QuickJumpContext, PageData> = {
  id: "content",
  label: (context) => context.labels.content,
  matched: true,
  search: async (query, context) => {
    if (query.trim().length < 2) return [];
    const results = await context.searchContent(query.trim());
    const items: QuickJumpItem<PageData>[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      const match = result.path.match(
        /^projects\/([^/]+)\/pages\/([^/]+)\.json$/,
      );
      if (!match) continue;
      const [, projectId, pageId] = match;
      const page = context.pages[projectId]?.pages.find(
        (entry) => entry.id === pageId,
      );
      if (!page || page.archived) continue;
      const key = `${projectId}/${pageId}/${result.blockId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const location = locate(context.projects, projectId, page.parentId);
      if (!location) continue;
      items.push({
        key,
        identity: `page:${projectId}/${pageId}`,
        title: page.title,
        path: location.path,
        icon: "content",
        ...(page.icon ? { emoji: page.icon } : {}),
        data: {
          projectId,
          pageId,
          ...(result.blockId ? { blockId: result.blockId } : {}),
        },
      });
    }
    return items;
  },
  run: (item, context) =>
    context.openPage({
      projectId: item.data.projectId,
      pageId: item.data.pageId,
      blockIds: item.data.blockId ? [item.data.blockId] : [],
    }),
};

export const commandsSource: QuickJumpSource<
  QuickJumpContext,
  WorkbenchCommand
> = {
  id: "commands",
  label: (context) => context.labels.commands,
  limit: 8,
  search: (_query, context) =>
    context.commands.map((command) => ({
      key: command.id,
      title: command.title,
      ...(command.keywords ? { keywords: command.keywords } : {}),
      ...(command.shortcut ? { shortcut: command.shortcut } : {}),
      ...(command.disabled ? { disabled: true } : {}),
      icon: "command" as const,
      data: command,
    })),
  run: (item) => item.data.run(),
};

type ComponentData = {
  component: CatalogComponent;
  /** Absent for the insertion every component offers. */
  command?: ComponentCommand;
};

/**
 * Every catalog component placed as a block offers to insert itself, and every
 * component adds the commands its contract declares in contributes.commands
 * (insert commands only when it is placed as a block). Built-in and library
 * components take the same path.
 */
export function componentCommandItems(
  components: readonly CatalogComponent[],
  canInsert: boolean,
  group: string,
): QuickJumpItem<ComponentData>[] {
  const items: QuickJumpItem<ComponentData>[] = [];
  for (const component of components) {
    const block = insertsAsBlock(component);
    const entry = componentSlashEntry(component, group, {
      name: componentDisplayName,
      description: componentDisplayDescription,
    });
    if (canInsert && block)
      items.push({
        key: entry.id,
        title: entry.title,
        keywords: entry.keywords,
        icon: "component",
        data: { component },
      });
    for (const command of component.contributes?.commands ?? []) {
      if ("insert" in command.run && !(canInsert && block)) continue;
      items.push({
        key: `${entry.id}:${command.id}`,
        title: command.title,
        keywords: [...(command.keywords ?? []), entry.title].join(" "),
        icon: "insert" in command.run ? "component" : "page",
        data: { component, command },
      });
    }
  }
  return items;
}

const componentItems = new WeakMap<
  readonly CatalogComponent[],
  Map<string, QuickJumpItem<ComponentData>[]>
>();

export const componentsSource: QuickJumpSource<
  QuickJumpContext,
  ComponentData
> = {
  id: "components",
  label: (context) => context.labels.components,
  search: (_query, context) => {
    let byMode = componentItems.get(context.components);
    if (!byMode) componentItems.set(context.components, (byMode = new Map()));
    const key = `${context.canInsert}:${context.labels.components}`;
    let items = byMode.get(key);
    if (!items)
      byMode.set(
        key,
        (items = componentCommandItems(
          context.components,
          context.canInsert,
          context.labels.components,
        )),
      );
    return items;
  },
  run: (item, context) => {
    const { component, command } = item.data;
    if (!command) return context.insert(component);
    if ("goTo" in command.run) {
      const target = parsePageLink(command.run.goTo);
      if (!target) throw new Error(`Command '${command.id}' has no valid page link.`);
      return context.openPage(target);
    }
    return context.insert(component, (resolved) =>
      commandProps(command, resolved),
    );
  },
};

/** The built-in sources, in the order their groups appear when they tie. */
export const builtinSources = [
  pagesSource,
  foldersSource,
  projectsSource,
  commandsSource,
  componentsSource,
  contentSource,
] as const;
