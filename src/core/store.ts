import { artifactVersion } from "../surface/document.mjs";
import { createResource, upgradeResource } from "../surface/containers.mjs";
import { constants } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";
import { parseArtifact, serializeArtifact } from "../portable/validation.mjs";
import {
  applyOperations,
  diffDocuments,
  documentHash,
  indexBlocks,
  normalizeDocument,
} from "./diff";
import { CoreError } from "./model";
import { libraryMutations, legacyMutations } from "./history-context";
import { withLibraryLock } from "./library-lock";
const projectionReads = new AsyncLocalStorage<string>();
import { pageSummaries } from "./page-summaries";
import { WorkspaceProtection } from "./workspace-conflicts";
import {
  workspaceRoot,
  versionedLibrary,
  logicalPath,
  readLibraryFile,
  writeLibraryFiles,
  listLibraryDirectory,
  mutateLibrary,
  withLibrarySnapshot,
  libraryReadSnapshot,
} from "./library-runtime";
import type {
  ApplyPageInput,
  FolderMetadata,
  PageDiff,
  PageRecord,
  PageSummary,
  ProjectBinding,
  ProjectMetadata,
  ProjectSummary,
  SidebarOrganization,
  ShowDocument,
} from "./model";

export { CoreError } from "./model";
export type {
  ApplyPageInput,
  FolderMetadata,
  PageDiff,
  PageRecord,
  PageSummary,
  ProjectBinding,
  ProjectMetadata,
  ProjectSummary,
} from "./model";

function errno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function assertId(id: string): string {
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) ||
    /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(id)
  ) {
    throw new CoreError(
      "INVALID_PATH",
      "Identifiers must contain only letters, numbers, hyphens, and underscores.",
    );
  }
  return id;
}

function assertHash(hash: string): void {
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
    throw new CoreError(
      "INVALID_DATA",
      "Expected a 64-character SHA-256 content hash.",
    );
}

function validateBinding(binding: ProjectBinding): ProjectBinding {
  if (
    !binding ||
    typeof binding.harness !== "string" ||
    !binding.harness.trim() ||
    binding.harness.length > 100 ||
    typeof binding.sessionId !== "string" ||
    !binding.sessionId.trim() ||
    binding.sessionId.length > 1000 ||
    (binding.sourceDirectory !== undefined &&
      typeof binding.sourceDirectory !== "string")
  ) {
    throw new CoreError(
      "INVALID_DATA",
      "A project binding requires a harness and sessionId.",
    );
  }
  return {
    harness: binding.harness,
    sessionId: binding.sessionId,
    ...(binding.sourceDirectory !== undefined
      ? { sourceDirectory: binding.sourceDirectory }
      : {}),
  };
}

function validateName(name: string): string {
  if (typeof name !== "string" || !name.trim() || name.length > 1000)
    throw new CoreError(
      "INVALID_DATA",
      "Project name must contain 1–1000 characters.",
    );
  return name.trim();
}

function validateProject(value: unknown, expectedId: string): ProjectMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CoreError("INVALID_DATA", "Invalid project metadata.");
  const project = value as ProjectMetadata;
  if (
    project.format !== "showai-project" ||
    project.version !== 1 ||
    project.id !== expectedId ||
    !Number.isFinite(Date.parse(project.createdAt)) ||
    !Number.isFinite(Date.parse(project.updatedAt))
  )
    throw new CoreError(
      "INVALID_DATA",
      `Invalid project metadata: ${expectedId}.`,
    );
  validateName(project.name);
  if (
    project.sourceDirectory !== undefined &&
    (typeof project.sourceDirectory !== "string" ||
      !isAbsolute(project.sourceDirectory))
  )
    throw new CoreError(
      "INVALID_DATA",
      "Project sourceDirectory must be an absolute directory.",
    );
  if (project.binding) validateBinding(project.binding);
  if (project.bindings !== undefined) {
    if (!Array.isArray(project.bindings))
      throw new CoreError("INVALID_DATA", "Project bindings must be an array.");
    project.bindings.forEach(validateBinding);
  }
  for (const key of ["pinned", "archived"] as const) {
    if (project[key] !== undefined && typeof project[key] !== "boolean")
      throw new CoreError("INVALID_DATA", `Project ${key} must be boolean.`);
  }
  const folders = project.folders ?? [];
  if (!Array.isArray(folders) || folders.length > 10000)
    throw new CoreError(
      "INVALID_DATA",
      "Project folders must be an array of at most 10000 entries.",
    );
  const ids = new Set<string>();
  for (const folder of folders) {
    if (!folder || typeof folder !== "object")
      throw new CoreError("INVALID_DATA", "Invalid folder metadata.");
    assertId(folder.id);
    validateName(folder.name);
    if (ids.has(folder.id))
      throw new CoreError("INVALID_DATA", `Duplicate folder id: ${folder.id}`);
    ids.add(folder.id);
    if (folder.parentId !== null) assertId(folder.parentId);
    if (
      typeof folder.pinned !== "boolean" ||
      typeof folder.archived !== "boolean" ||
      !Number.isFinite(Date.parse(folder.createdAt)) ||
      !Number.isFinite(Date.parse(folder.updatedAt))
    )
      throw new CoreError(
        "INVALID_DATA",
        `Invalid folder metadata: ${folder.id}`,
      );
  }
  const map = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    const visited = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId !== null) {
      const parent = map.get(parentId);
      if (!parent || visited.has(parentId) || visited.size >= 64)
        throw new CoreError(
          "INVALID_DATA",
          "Folder hierarchy has a missing parent, cycle, or more than 64 levels.",
        );
      visited.add(parentId);
      parentId = parent.parentId;
    }
  }
  return {
    ...project,
    pinned: project.pinned ?? false,
    archived: project.archived ?? false,
    folders,
  };
}

function folderVisible(folders: FolderMetadata[], id: string): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let folder = byId.get(id);
  if (!folder) return false;
  while (folder) {
    if (folder.archived) return false;
    folder = folder.parentId === null ? undefined : byId.get(folder.parentId);
  }
  return true;
}

function requireActiveFolder(
  project: ProjectMetadata,
  parentId: string | null,
): void {
  if (project.archived)
    throw new CoreError("INVALID_DATA", "This project is archived.");
  if (parentId === null) return;
  assertId(parentId);
  if (!folderVisible(project.folders ?? [], parentId))
    throw new CoreError(
      "NOT_FOUND",
      "The destination folder is missing or archived.",
    );
}

/** Canonical files, immutable checkpoints, and cooperating writers; no background service. */
export class FileStore {
  readonly root: string;

  constructor(root?: string) {
    this.root = resolve(
      root ?? process.env.SHOWAI_HOME ?? join(homedir(), ".showai"),
    );
  }

  projectPath(projectId: string): string {
    return join(workspaceRoot(this.root), "projects", assertId(projectId));
  }

  pagePath(projectId: string, pageId: string): string {
    return join(
      this.projectPath(projectId),
      "pages",
      `${assertId(pageId)}.json`,
    );
  }

  private async safePath(path: string): Promise<void> {
    const local = relative(this.root, path);
    if (local.startsWith(`..${sep}`) || local === ".." || isAbsolute(local))
      throw new CoreError(
        "INVALID_PATH",
        "Path leaves the ShowAI data directory.",
      );
    const paths = [this.root];
    for (const part of local.split(sep).filter(Boolean))
      paths.push(join(paths.at(-1)!, part));
    for (const item of paths) {
      let info;
      try {
        info = await lstat(item);
      } catch (error) {
        if (errno(error, "ENOENT")) continue;
        throw error;
      }
      if (info.isSymbolicLink())
        throw new CoreError(
          "INVALID_PATH",
          `Symbolic links are not supported in the data store: ${item}`,
        );
      if (item !== path && !info.isDirectory())
        throw new CoreError("INVALID_PATH", `Expected a directory: ${item}`);
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    await this.safePath(path);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await this.safePath(path);
  }

  private async readJson(path: string): Promise<unknown> {
    await this.safePath(path);
    const managed = await readLibraryFile(this.root, path);
    if (managed !== undefined) return JSON.parse(managed.toString("utf8"));
    let file;
    try {
      file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if (errno(error, "ENOENT"))
        throw new CoreError("NOT_FOUND", `File not found: ${path}`);
      throw error;
    }
    try {
      if ((await file.stat()).size > 12 * 1024 * 1024)
        throw new CoreError(
          "INVALID_DATA",
          "Stored JSON exceeds the 12 MB limit.",
        );
      const source = await file.readFile("utf8");
      try {
        return JSON.parse(source);
      } catch {
        throw new CoreError("INVALID_DATA", `Invalid JSON: ${path}`);
      }
    } finally {
      await file.close();
    }
  }

  private async atomicWrite(path: string, source: string): Promise<void> {
    const managed = logicalPath(this.root, path);
    if (managed) {
      await writeLibraryFiles(
        this.root,
        new Map([[managed, Buffer.from(source)]]),
      );
      return;
    }
    await this.ensureDirectory(dirname(path));
    await this.safePath(path);
    const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(source, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await this.safePath(path);
      await rename(temporary, path);
      if (process.platform !== "win32") {
        const parent = await open(dirname(path), "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async withLock<T>(
    _key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return mutateLibrary(this.root, action);
  }

  private async contentNames(
    path: string,
    kind: "directory" | "json",
  ): Promise<string[]> {
    const managed = await listLibraryDirectory(this.root, path);
    if (managed)
      return managed.filter(
        (name) =>
          !name.startsWith(".") &&
          (kind === "directory" || name.endsWith(".json")),
      );
    await this.ensureDirectory(path);
    const names: string[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new CoreError(
          "INVALID_PATH",
          `Content entry cannot be a symbolic link: ${entry.name}`,
        );
      if (entry.name.startsWith(".")) continue;
      if (
        kind === "directory"
          ? entry.isDirectory()
          : entry.isFile() && entry.name.endsWith(".json")
      )
        names.push(entry.name);
    }
    return names;
  }

  async readProject(projectId: string): Promise<ProjectMetadata> {
    return validateProject(
      await this.readJson(join(this.projectPath(projectId), "project.json")),
      projectId,
    );
  }

  async readSidebar(): Promise<SidebarOrganization> {
    let value;
    try {
      value = await this.readJson(
        join(workspaceRoot(this.root), "sidebar.json"),
      );
    } catch (error) {
      if (error instanceof CoreError && error.code === "NOT_FOUND")
        return { groups: [], projectGroups: {} };
      throw error;
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new CoreError("INVALID_DATA", "Invalid sidebar organization.");
    const sidebar = value as SidebarOrganization;
    if (
      !Array.isArray(sidebar.groups) ||
      sidebar.groups.length > 1000 ||
      !sidebar.projectGroups ||
      typeof sidebar.projectGroups !== "object" ||
      Array.isArray(sidebar.projectGroups)
    )
      throw new CoreError("INVALID_DATA", "Invalid sidebar organization.");
    const ids = new Set<string>();
    for (const group of sidebar.groups) {
      if (!group || typeof group !== "object")
        throw new CoreError("INVALID_DATA", "Invalid project group.");
      assertId(group.id);
      validateName(group.name);
      if (ids.has(group.id))
        throw new CoreError("INVALID_DATA", "Duplicate project group.");
      ids.add(group.id);
    }
    for (const [projectId, groupId] of Object.entries(sidebar.projectGroups)) {
      assertId(projectId);
      if (!ids.has(groupId))
        throw new CoreError("INVALID_DATA", "Project group is missing.");
    }
    return sidebar;
  }

  async createProjectGroup(name: string): Promise<SidebarOrganization> {
    const normalized = validateName(name);
    return this.withLock("sidebar", async () => {
      const sidebar = await this.readSidebar();
      if (sidebar.groups.length >= 1000)
        throw new CoreError("INVALID_DATA", "Too many project groups.");
      sidebar.groups.push({ id: randomUUID(), name: normalized });
      await this.atomicWrite(
        join(workspaceRoot(this.root), "sidebar.json"),
        JSON.stringify(sidebar, null, 2),
      );
      return sidebar;
    });
  }

  async updateProjectGroup(
    groupId: string,
    name: string | null,
  ): Promise<SidebarOrganization> {
    assertId(groupId);
    const normalized = name === null ? null : validateName(name);
    return this.withLock("sidebar", async () => {
      const sidebar = await this.readSidebar();
      const group = sidebar.groups.find((item) => item.id === groupId);
      if (!group) throw new CoreError("NOT_FOUND", "Project group is missing.");
      if (normalized === null) {
        sidebar.groups = sidebar.groups.filter((item) => item.id !== groupId);
        sidebar.projectGroups = Object.fromEntries(
          Object.entries(sidebar.projectGroups).filter(
            ([, id]) => id !== groupId,
          ),
        );
      } else group.name = normalized;
      await this.atomicWrite(
        join(workspaceRoot(this.root), "sidebar.json"),
        JSON.stringify(sidebar, null, 2),
      );
      return sidebar;
    });
  }

  async moveProjectToGroup(
    projectId: string,
    groupId: string | null,
  ): Promise<SidebarOrganization> {
    const project = await this.readProject(projectId);
    if (project.archived)
      throw new CoreError("INVALID_DATA", "This project is archived.");
    if (groupId !== null) assertId(groupId);
    return this.withLock("sidebar", async () => {
      const sidebar = await this.readSidebar();
      if (groupId === null) delete sidebar.projectGroups[projectId];
      else {
        if (!sidebar.groups.some((group) => group.id === groupId))
          throw new CoreError("NOT_FOUND", "Project group is missing.");
        sidebar.projectGroups[projectId] = groupId;
      }
      await this.atomicWrite(
        join(workspaceRoot(this.root), "sidebar.json"),
        JSON.stringify(sidebar, null, 2),
      );
      return sidebar;
    });
  }

  async listProjects(
    options: { includeArchived?: boolean } = {},
  ): Promise<ProjectSummary[]> {
    if (
      !libraryReadSnapshot.getStore() &&
      !libraryMutations.getStore() &&
      versionedLibrary(this.root)
    )
      return withLibrarySnapshot(this.root, () => this.listProjects(options));
    const path = join(workspaceRoot(this.root), "projects");
    const names = await this.contentNames(path, "directory");
    const projects: ProjectSummary[] = [];
    for (const name of names) {
      const project = await this.readProject(name);
      if (project.archived && !options.includeArchived) continue;
      const pages = await this.listPages(project.id, {
        includeArchived: !!options.includeArchived,
      });
      projects.push({
        ...project,
        folders: options.includeArchived
          ? (project.folders ?? [])
          : (project.folders ?? []).filter((folder) =>
              folderVisible(project.folders ?? [], folder.id),
            ),
        updatedAt: pages.reduce(
          (latest, page) => (page.updatedAt > latest ? page.updatedAt : latest),
          project.updatedAt,
        ),
        pageCount: pages.length,
      });
    }
    return projects.sort(
      (left, right) =>
        Number(!!right.pinned) - Number(!!left.pinned) ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async createProject(input: {
    name: string;
    binding?: ProjectBinding;
  }): Promise<ProjectSummary> {
    const name = validateName(input.name);
    const binding = input.binding ? validateBinding(input.binding) : undefined;
    return this.withLock("projects", async () => {
      if (binding) {
        const existing = (
          await this.listProjects({ includeArchived: true })
        ).find((project) =>
          (project.bindings ?? (project.binding ? [project.binding] : [])).some(
            (item) =>
              item.harness === binding.harness &&
              item.sessionId === binding.sessionId,
          ),
        );
        if (existing) return existing;
      }
      return this.writeNewProject(name, binding);
    });
  }

  async resolveDirectoryProject(sourceDirectory: string): Promise<{
    project: ProjectSummary;
    created: boolean;
  }> {
    if (!isAbsolute(sourceDirectory))
      throw new CoreError(
        "INVALID_PATH",
        "Expected a canonical project directory.",
      );
    return this.withLock("projects", async () => {
      const matches = (
        await this.listProjects({ includeArchived: true })
      ).filter((project) => project.sourceDirectory === sourceDirectory);
      if (matches.length > 1)
        throw new CoreError(
          "CONFLICT",
          "Multiple ShowAI projects own this source directory. Specify --project.",
        );
      const project = matches[0];
      if (project?.archived)
        throw new CoreError(
          "CONFLICT",
          "The project for this directory is archived. Restore it or specify --project.",
        );
      if (project) return { project, created: false };
      return {
        project: await this.writeNewProject(
          basename(sourceDirectory) || sourceDirectory,
          undefined,
          sourceDirectory,
        ),
        created: true,
      };
    });
  }

  private async writeNewProject(
    name: string,
    binding?: ProjectBinding,
    sourceDirectory?: string,
  ): Promise<ProjectSummary> {
    const now = new Date().toISOString();
    const project: ProjectMetadata = {
      format: "showai-project",
      version: 1,
      id: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      archived: false,
      folders: [],
      ...(binding ? { binding, bindings: [binding] } : {}),
      ...(sourceDirectory ? { sourceDirectory } : {}),
    };
    if (versionedLibrary(this.root)) {
      await this.atomicWrite(
        join(this.projectPath(project.id), "project.json"),
        JSON.stringify(project, null, 2),
      );
      return { ...project, pageCount: 0 };
    }
    const destination = this.projectPath(project.id);
    const staging = join(dirname(destination), `.create-${project.id}`);
    const syncDirectory = async (path: string) => {
      if (process.platform === "win32") return;
      const directory = await open(path, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    };
    try {
      // Readers ignore the hidden staging directory. Publish a complete project
      // in one rename so filesystem watchers never observe a missing manifest.
      await this.atomicWrite(
        join(staging, "project.json"),
        JSON.stringify(project, null, 2),
      );
      await this.ensureDirectory(join(staging, "pages"));
      await syncDirectory(staging);
      await this.safePath(destination);
      await rename(staging, destination);
      await syncDirectory(dirname(destination));
      return { ...project, pageCount: 0 };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async updateProject(
    projectId: string,
    input: { name?: string; pinned?: boolean; archived?: boolean },
  ): Promise<ProjectSummary> {
    assertId(projectId);
    return this.withLock(`project-${projectId}`, async () => {
      const current = await this.readProject(projectId);
      for (const key of ["pinned", "archived"] as const)
        if (input[key] !== undefined && typeof input[key] !== "boolean")
          throw new CoreError("INVALID_DATA", `${key} must be boolean.`);
      const project = {
        ...current,
        ...(input.name !== undefined ? { name: validateName(input.name) } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
        updatedAt: new Date().toISOString(),
      };
      await this.atomicWrite(
        join(this.projectPath(projectId), "project.json"),
        JSON.stringify(project, null, 2),
      );
      return {
        ...project,
        pageCount: (await this.listPages(projectId, { includeArchived: false }))
          .length,
      };
    });
  }

  async bindProject(
    projectId: string,
    input: ProjectBinding,
  ): Promise<ProjectSummary> {
    const binding = validateBinding(input);
    assertId(projectId);
    return this.withLock("projects", async () => {
      const projects = await this.listProjects({ includeArchived: true });
      const other = projects.find(
        (project) =>
          project.id !== projectId &&
          (project.bindings ?? (project.binding ? [project.binding] : [])).some(
            (item) =>
              item.harness === binding.harness &&
              item.sessionId === binding.sessionId,
          ),
      );
      if (other)
        throw new CoreError(
          "CONFLICT",
          `This session is already bound to project ${other.id}.`,
        );
      return this.withLock(`project-${projectId}`, async () => {
        const current = await this.readProject(projectId);
        const bindings =
          current.bindings ?? (current.binding ? [current.binding] : []);
        const project: ProjectMetadata = {
          ...current,
          binding: current.binding ?? binding,
          bindings: [
            ...bindings.filter(
              (item) =>
                item.harness !== binding.harness ||
                item.sessionId !== binding.sessionId,
            ),
            binding,
          ],
          updatedAt: new Date().toISOString(),
        };
        await this.atomicWrite(
          join(this.projectPath(projectId), "project.json"),
          JSON.stringify(project, null, 2),
        );
        return {
          ...project,
          pageCount: (await this.listPages(projectId)).length,
        };
      });
    });
  }

  async listFolders(
    projectId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<FolderMetadata[]> {
    const project = await this.readProject(projectId);
    const folders = project.folders ?? [];
    if (project.archived && !options.includeArchived) return [];
    return folders
      .filter(
        (folder) =>
          options.includeArchived || folderVisible(folders, folder.id),
      )
      .sort(
        (left, right) =>
          Number(right.pinned) - Number(left.pinned) ||
          right.updatedAt.localeCompare(left.updatedAt),
      );
  }

  async createFolder(
    projectId: string,
    input: { name: string; parentId?: string | null },
  ): Promise<FolderMetadata> {
    assertId(projectId);
    const name = validateName(input.name);
    return this.withLock(`project-${projectId}`, async () => {
      const project = await this.readProject(projectId);
      requireActiveFolder(project, input.parentId ?? null);
      const now = new Date().toISOString();
      const folder: FolderMetadata = {
        id: randomUUID(),
        name,
        parentId: input.parentId ?? null,
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      const updated = validateProject(
        {
          ...project,
          folders: [...(project.folders ?? []), folder],
          updatedAt: now,
        },
        projectId,
      );
      await this.atomicWrite(
        join(this.projectPath(projectId), "project.json"),
        JSON.stringify(updated, null, 2),
      );
      return folder;
    });
  }

  async updateFolder(
    projectId: string,
    folderId: string,
    input: { name?: string; pinned?: boolean; archived?: boolean },
  ): Promise<FolderMetadata> {
    assertId(projectId);
    assertId(folderId);
    for (const key of ["pinned", "archived"] as const)
      if (input[key] !== undefined && typeof input[key] !== "boolean")
        throw new CoreError("INVALID_DATA", `${key} must be boolean.`);
    return this.withLock(`project-${projectId}`, async () => {
      const project = await this.readProject(projectId);
      const folder = project.folders?.find((item) => item.id === folderId);
      if (!folder) throw new CoreError("NOT_FOUND", "Folder not found.");
      const now = new Date().toISOString();
      const updated: FolderMetadata = {
        ...folder,
        ...(input.name !== undefined ? { name: validateName(input.name) } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
        updatedAt: now,
      };
      await this.atomicWrite(
        join(this.projectPath(projectId), "project.json"),
        JSON.stringify(
          {
            ...project,
            folders: project.folders!.map((item) =>
              item.id === folderId ? updated : item,
            ),
            updatedAt: now,
          },
          null,
          2,
        ),
      );
      return updated;
    });
  }

  async updatePageMetadata(
    projectId: string,
    pageId: string,
    fields: {
      title?: string;
      favorite?: boolean;
      parentId?: string | null;
      archived?: boolean;
    },
    baseHash: string,
    baseRevision?: string,
  ): Promise<PageRecord> {
    this.pagePath(projectId, pageId);
    if (
      !fields ||
      Object.keys(fields).some(
        (key) => !["title", "favorite", "parentId", "archived"].includes(key),
      )
    )
      throw new CoreError("INVALID_DATA", "Unsupported page metadata field.");
    return this.withLock(`project-${projectId}`, async () => {
      const project = await this.readProject(projectId);
      if (fields.parentId !== undefined)
        requireActiveFolder(project, fields.parentId);
      return this.applyPage(projectId, pageId, {
        baseHash,
        baseRevision,
        operations: [{ type: "page.set", fields }],
      });
    });
  }

  private async readRecord(
    projectId: string,
    pageId: string,
  ): Promise<PageRecord> {
    if (
      projectionReads.getStore() !== this.root &&
      libraryMutations.getStore()?.root !== this.root &&
      legacyMutations.getStore() !== this.root
    )
      return withLibraryLock(this.root, () =>
        projectionReads.run(this.root, () =>
          this.readRecord(projectId, pageId),
        ),
      );
    const path = this.pagePath(projectId, pageId);
    const value = await this.readJson(path);
    let document: ShowDocument;
    try {
      document = normalizeDocument(parseArtifact(value).document);
    } catch (error) {
      if (error instanceof CoreError) throw error;
      throw new CoreError(
        "INVALID_DATA",
        error instanceof Error ? error.message : "Invalid page artifact.",
      );
    }
    if (document.id !== pageId)
      throw new CoreError(
        "INVALID_DATA",
        `Page id does not match its filename: ${pageId}`,
      );
    const library = versionedLibrary(this.root);
    const state = libraryMutations.getStore();
    const revision = library
      ? await library.resourceRevision(
          logicalPath(this.root, path)!,
          state?.root === this.root ? (state.head ?? undefined) : undefined,
        )
      : undefined;
    const workspaceConflicts =
      library && state?.root !== this.root
        ? [
            ...(await new WorkspaceProtection(library).inspect(
              [logicalPath(this.root, path)!],
              await library.head(),
            )),
            ...(await new WorkspaceProtection(library).list(
              logicalPath(this.root, path)!,
            )),
          ].filter(
            (item, index, all) =>
              item.state === "unresolved" &&
              all.findIndex((candidate) => candidate.id === item.id) === index,
          )
        : [];
    return {
      document,
      hash: documentHash(document),
      path,
      ...(revision ? { revision } : {}),
      ...(workspaceConflicts.length ? { workspaceConflicts } : {}),
    };
  }

  async listPages(
    projectId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<PageSummary[]> {
    if (
      !libraryReadSnapshot.getStore() &&
      !libraryMutations.getStore() &&
      versionedLibrary(this.root)
    )
      return withLibrarySnapshot(this.root, () =>
        this.listPages(projectId, options),
      );
    const project = await this.readProject(projectId);
    if (project.archived && options.includeArchived === false) return [];
    const snapshot = libraryReadSnapshot.getStore();
    if (
      snapshot?.root === this.root &&
      snapshot.revision &&
      !libraryMutations.getStore()
    ) {
      const summaries = await pageSummaries(
        snapshot.library,
        snapshot.revision,
      );
      const prefix = `projects/${projectId}/pages/`;
      return Object.entries(summaries)
        .filter(([path]) => path.startsWith(prefix))
        .map(([, entry]) => ({ ...entry.summary }))
        .filter(
          (page) =>
            options.includeArchived !== false ||
            (!page.archived &&
              (page.parentId === null ||
                !project.folders?.some(
                  (folder) => folder.id === page.parentId,
                ) ||
                folderVisible(project.folders ?? [], page.parentId))),
        )
        .map((page) => ({
          ...page,
          parentId:
            options.includeArchived === false &&
            !project.folders?.some((folder) => folder.id === page.parentId)
              ? null
              : page.parentId,
        }))
        .sort(
          (a, b) =>
            Number(b.favorite) - Number(a.favorite) ||
            b.updatedAt.localeCompare(a.updatedAt),
        );
    }
    const folders = project.folders ?? [];
    const path = join(this.projectPath(projectId), "pages");
    const names = await this.contentNames(path, "json");
    const pages: PageSummary[] = [];
    for (const name of names) {
      const record = await this.readRecord(projectId, name.slice(0, -5));
      const parentId = record.document.parentId;
      const hasFolder =
        parentId !== null && folders.some((folder) => folder.id === parentId);
      if (
        options.includeArchived === false &&
        (record.document.archived ||
          (hasFolder && !folderVisible(folders, parentId!)))
      )
        continue;
      pages.push({
        id: record.document.id,
        title: record.document.title,
        updatedAt: record.document.updatedAt,
        icon: record.document.icon,
        hash: record.hash,
        ...(record.revision ? { revision: record.revision } : {}),
        blockCount: indexBlocks(record.document).size,
        parentId:
          options.includeArchived === false && !hasFolder ? null : parentId,
        favorite: record.document.favorite,
        archived: record.document.archived,
      });
    }
    return pages.sort(
      (left, right) =>
        Number(right.favorite) - Number(left.favorite) ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  private async checkpoint(
    projectId: string,
    record: PageRecord,
  ): Promise<void> {
    if (versionedLibrary(this.root)) return;
    const path = join(
      this.projectPath(projectId),
      "snapshots",
      record.document.id,
      `${record.hash}.json`,
    );
    await this.ensureDirectory(dirname(path));
    await this.safePath(path);
    // Atomically publish a fully written snapshot. Same-hash snapshots have identical semantic content.
    try {
      const existing = parseArtifact(await this.readJson(path)).document;
      if (documentHash(existing) !== record.hash)
        throw new CoreError(
          "INVALID_DATA",
          `Corrupt checkpoint: ${record.hash}`,
        );
      return;
    } catch (error) {
      if (!(error instanceof CoreError && error.code === "NOT_FOUND"))
        throw error;
    }
    await this.atomicWrite(path, serializeArtifact(record.document));
  }

  async readPage(
    projectId: string,
    pageId: string,
    options: { checkpoint?: boolean } = {},
  ): Promise<PageRecord> {
    await this.readProject(projectId);
    const record = await this.readRecord(projectId, pageId);
    if (options.checkpoint !== false && !versionedLibrary(this.root))
      await this.withLock("checkpoint", () =>
        this.checkpoint(projectId, record),
      );
    return record;
  }

  async createPage(
    projectId: string,
    input: {
      title?: string;
      kind?: "page" | "board";
      document?: ShowDocument;
      parentId?: string | null;
    } = {},
  ): Promise<PageRecord> {
    assertId(projectId);
    return this.withLock(`project-${projectId}`, async () => {
      const project = await this.readProject(projectId);
      requireActiveFolder(project, input.parentId ?? null);
      if (
        input.parentId === undefined &&
        input.document?.parentId &&
        project.folders?.some(
          (folder) => folder.id === input.document!.parentId,
        )
      )
        requireActiveFolder(project, input.document.parentId);
      const now = new Date().toISOString();
      const id = randomUUID();
      const document = normalizeDocument(
        input.document
          ? {
              ...(versionedLibrary(this.root)
                ? upgradeResource(input.document)
                : input.document),
              id,
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.parentId !== undefined
                ? { parentId: input.parentId }
                : {}),
              createdAt: now,
              updatedAt: now,
            }
          : createResource(
              {
                id,
                title: input.title ?? "未命名页面",
                icon: "",
                cover: "none",
                parentId: input.parentId ?? null,
                favorite: false,
                archived: false,
                createdAt: now,
                updatedAt: now,
                content: { type: "doc", content: [{ type: "paragraph" }] },
                comments: [],
              },
              input.kind ?? "page",
            ),
      );
      return this.withLock(`page-${projectId}-${id}`, async () => {
        const record = {
          document,
          hash: documentHash(document),
          path: this.pagePath(projectId, id),
        };
        await this.checkpoint(projectId, record);
        await this.atomicWrite(record.path, serializeArtifact(document));
        return record;
      });
    });
  }

  private async commit(
    projectId: string,
    pageId: string,
    current: PageRecord,
    input: ShowDocument,
  ): Promise<PageRecord> {
    if (artifactVersion(current.document) > artifactVersion(input))
      throw new CoreError(
        "INVALID_DATA",
        "A whiteboard cannot be overwritten with a legacy document. Import the legacy source as a separate page.",
      );
    const document = normalizeDocument(
      {
        ...input,
        id: pageId,
        createdAt: current.document.createdAt,
        updatedAt: new Date().toISOString(),
      },
      current.document,
    );
    const hash = documentHash(document);
    if (hash === current.hash) return current;
    const record = { document, hash, path: this.pagePath(projectId, pageId) };
    await this.checkpoint(projectId, current);
    await this.checkpoint(projectId, record);
    // Recheck after checkpoint I/O; cooperating writers hold this page's lock throughout.
    const latest = await this.readRecord(projectId, pageId);
    if (latest.hash !== current.hash)
      throw new CoreError(
        "CONFLICT",
        "The page changed while saving. Read the changes and retry.",
        { currentHash: latest.hash },
      );
    if (artifactVersion(current.document) < artifactVersion(document)) {
      const backup = join(
        this.projectPath(projectId),
        "migrations",
        pageId,
        `original-v${artifactVersion(current.document)}.json`,
      );
      await this.ensureDirectory(dirname(backup));
      await this.safePath(backup);
      const source = await readFile(current.path);
      const file = await open(backup, "wx").catch((error) => {
        if (errno(error, "EEXIST")) return null;
        throw error;
      });
      if (file) {
        try {
          await file.writeFile(source);
        } finally {
          await file.close();
        }
      }
      const checked = await this.readRecord(projectId, pageId);
      if (checked.hash !== current.hash)
        throw new CoreError(
          "CONFLICT",
          "The page changed while preserving its legacy source.",
          { currentHash: checked.hash },
        );
    }
    await this.atomicWrite(record.path, serializeArtifact(document));
    return record;
  }

  private checkPageRevision(current: PageRecord, provided?: string): void {
    if (!versionedLibrary(this.root)) return;
    const state = libraryMutations.getStore();
    if (!state || state.root !== this.root)
      throw new CoreError(
        "INVALID_DATA",
        "Page writes need a library transaction.",
      );
    const path = logicalPath(this.root, current.path)!;
    // A transaction can continue editing a page it has already staged. Its first
    // external baseline remains the condition for committing the complete operation.
    if (!provided && state.changes.has(path)) {
      state.expected.set(
        path,
        state.expected.get(path) ?? current.revision ?? null,
      );
      return;
    }
    if (!provided)
      throw new CoreError(
        "INVALID_DATA",
        "Versioned page writes require the baseRevision returned by reading the page.",
      );
    if (current.revision !== provided)
      throw new CoreError("CONFLICT", "The page has a newer revision.", {
        currentHash: current.hash,
        currentRevision: current.revision,
      });
    state.expected.set(path, provided);
  }

  async savePage(
    projectId: string,
    pageId: string,
    document: ShowDocument,
    baseHash: string,
    baseRevision?: string,
  ): Promise<PageRecord> {
    assertHash(baseHash);
    this.pagePath(projectId, pageId);
    await this.readProject(projectId);
    return this.withLock(`page-${projectId}-${pageId}`, async () => {
      const current = await this.readRecord(projectId, pageId);
      this.checkPageRevision(current, baseRevision);
      if (current.hash !== baseHash)
        throw new CoreError(
          "CONFLICT",
          "The page has newer changes. Read the diff before saving.",
          { currentHash: current.hash },
        );
      return this.commit(projectId, pageId, current, document);
    });
  }

  async applyPage(
    projectId: string,
    pageId: string,
    input: ApplyPageInput,
  ): Promise<PageRecord> {
    assertHash(input.baseHash);
    this.pagePath(projectId, pageId);
    await this.readProject(projectId);
    return this.withLock(`page-${projectId}-${pageId}`, async () => {
      const current = await this.readRecord(projectId, pageId);
      this.checkPageRevision(current, input.baseRevision);
      if (current.hash !== input.baseHash)
        throw new CoreError(
          "CONFLICT",
          "The page has newer changes. Read the diff before applying edits.",
          { currentHash: current.hash },
        );
      return this.commit(
        projectId,
        pageId,
        current,
        applyOperations(current.document, input.operations),
      );
    });
  }

  async diffPage(
    projectId: string,
    pageId: string,
    sinceHash: string,
  ): Promise<PageDiff> {
    const library = versionedLibrary(this.root);
    if (library) {
      if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sinceHash))
        throw new CoreError(
          "INVALID_DATA",
          "Versioned page diffs require a revision identifier.",
        );
      const current = await this.readPage(projectId, pageId);
      const baseline = normalizeDocument(
        parseArtifact(
          JSON.parse(
            (
              await library.readFile(
                logicalPath(this.root, current.path)!,
                sinceHash,
              )
            ).toString("utf8"),
          ),
        ).document,
      );
      const baseHash = documentHash(baseline);
      return {
        projectId,
        pageId,
        baseHash,
        currentHash: current.hash,
        baseRevision: sinceHash,
        currentRevision: current.revision,
        changed: baseHash !== current.hash,
        changes: diffDocuments(baseline, current.document),
      };
    }
    assertHash(sinceHash);
    const current = await this.readPage(projectId, pageId);
    const path = join(
      this.projectPath(projectId),
      "snapshots",
      assertId(pageId),
      `${sinceHash}.json`,
    );
    let baseline: ShowDocument;
    try {
      baseline = parseArtifact(await this.readJson(path)).document;
    } catch (error) {
      if (error instanceof CoreError && error.code === "NOT_FOUND")
        throw new CoreError(
          "MISSING_BASELINE",
          "The requested checkpoint is unavailable. Read the current page to establish a new baseline.",
          { currentHash: current.hash },
        );
      throw error;
    }
    if (baseline.id !== pageId || documentHash(baseline) !== sinceHash)
      throw new CoreError(
        "INVALID_DATA",
        "The checkpoint content does not match its identity or hash.",
      );
    const changes = diffDocuments(baseline, current.document);
    return {
      projectId,
      pageId,
      baseHash: sinceHash,
      currentHash: current.hash,
      changed: current.hash !== sinceHash,
      changes,
    };
  }
}
