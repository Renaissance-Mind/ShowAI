import { constants } from "node:fs";
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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseArtifact, serializeArtifact } from "../portable/validation.mjs";
import {
  applyOperations,
  diffDocuments,
  documentHash,
  indexBlocks,
  normalizeDocument,
} from "./diff";
import { CoreError } from "./model";
import type {
  ApplyPageInput,
  PageDiff,
  PageRecord,
  PageSummary,
  ProjectBinding,
  ProjectMetadata,
  ProjectSummary,
  ShowDocument,
} from "./model";

export { CoreError } from "./model";
export type {
  ApplyPageInput,
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
  if (project.binding) validateBinding(project.binding);
  if (project.bindings !== undefined) {
    if (!Array.isArray(project.bindings))
      throw new CoreError("INVALID_DATA", "Project bindings must be an array.");
    project.bindings.forEach(validateBinding);
  }
  return project;
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
    return join(this.root, "projects", assertId(projectId));
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

  private async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const directory = join(this.root, ".locks");
    await this.ensureDirectory(directory);
    const lockName =
      key.length < 180 ? key : createHash("sha256").update(key).digest("hex");
    const lock = join(directory, `${lockName}.lock`);
    const owner = { pid: process.pid, token: randomUUID() };
    const deadline = Date.now() + 5000;
    while (true) {
      await this.safePath(lock);
      try {
        await mkdir(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if (!errno(error, "EEXIST")) throw error;
        // Only a verified dead process permits recovering a lock after a crash.
        let stale = false;
        try {
          const existing = JSON.parse(
            await readFile(join(lock, "owner.json"), "utf8"),
          ) as { pid?: number };
          if (Number.isInteger(existing.pid) && existing.pid! > 0) {
            try {
              process.kill(existing.pid!, 0);
            } catch (probe) {
              if (errno(probe, "ESRCH")) stale = true;
              else if (!errno(probe, "EPERM")) throw probe;
            }
          }
        } catch (probe) {
          if (!errno(probe, "ENOENT") && !(probe instanceof SyntaxError))
            throw probe;
        }
        if (stale) {
          // Serialise recovery too: a second observer must not remove a new writer's lock.
          const recovery = `${lock}.recovery`;
          let acquired = false;
          try {
            await mkdir(recovery, { mode: 0o700 });
            acquired = true;
          } catch (probe) {
            if (!errno(probe, "EEXIST")) throw probe;
          }
          if (acquired) {
            try {
              let existing: { pid?: number } | undefined;
              try {
                existing = JSON.parse(
                  await readFile(join(lock, "owner.json"), "utf8"),
                ) as { pid?: number };
              } catch (probe) {
                if (!errno(probe, "ENOENT") && !(probe instanceof SyntaxError))
                  throw probe;
              }
              if (Number.isInteger(existing?.pid) && existing!.pid! > 0) {
                let stillDead = false;
                try {
                  process.kill(existing!.pid!, 0);
                } catch (probe) {
                  if (errno(probe, "ESRCH")) stillDead = true;
                  else if (!errno(probe, "EPERM")) throw probe;
                }
                if (stillDead) await rm(lock, { recursive: true, force: true });
              }
            } finally {
              await rm(recovery, { recursive: true, force: true });
            }
          }
          if (Date.now() >= deadline)
            throw new CoreError(
              "LOCKED",
              `Could not recover the writer lock for ${key}.`,
            );
          await new Promise((done) => setTimeout(done, 20));
          continue;
        }
        if (Date.now() >= deadline)
          throw new CoreError(
            "LOCKED",
            `Another writer holds ${key}. Retry after it finishes.`,
          );
        await new Promise((done) => setTimeout(done, 20));
      }
    }
    try {
      await this.atomicWrite(join(lock, "owner.json"), JSON.stringify(owner));
      return await action();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }

  private async readProject(projectId: string): Promise<ProjectMetadata> {
    return validateProject(
      await this.readJson(join(this.projectPath(projectId), "project.json")),
      projectId,
    );
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const path = join(this.root, "projects");
    await this.ensureDirectory(path);
    const projects: ProjectSummary[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new CoreError(
          "INVALID_PATH",
          `Project directory cannot be a symbolic link: ${entry.name}`,
        );
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const project = await this.readProject(entry.name);
      const pages = await this.listPages(project.id);
      projects.push({
        ...project,
        updatedAt: pages.reduce(
          (latest, page) => (page.updatedAt > latest ? page.updatedAt : latest),
          project.updatedAt,
        ),
        pageCount: pages.length,
      });
    }
    return projects.sort((left, right) =>
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
        const existing = (await this.listProjects()).find((project) =>
          (project.bindings ?? (project.binding ? [project.binding] : [])).some(
            (item) =>
              item.harness === binding.harness &&
              item.sessionId === binding.sessionId,
          ),
        );
        if (existing) return existing;
      }
      const now = new Date().toISOString();
      const project: ProjectMetadata = {
        format: "showai-project",
        version: 1,
        id: randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        ...(binding ? { binding, bindings: [binding] } : {}),
      };
      await this.atomicWrite(
        join(this.projectPath(project.id), "project.json"),
        JSON.stringify(project, null, 2),
      );
      await this.ensureDirectory(join(this.projectPath(project.id), "pages"));
      return { ...project, pageCount: 0 };
    });
  }

  async updateProject(
    projectId: string,
    input: { name: string },
  ): Promise<ProjectSummary> {
    assertId(projectId);
    return this.withLock(`project-${projectId}`, async () => {
      const current = await this.readProject(projectId);
      const project = {
        ...current,
        name: validateName(input.name),
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
  }

  async bindProject(
    projectId: string,
    input: ProjectBinding,
  ): Promise<ProjectSummary> {
    const binding = validateBinding(input);
    assertId(projectId);
    return this.withLock("projects", async () => {
      const projects = await this.listProjects();
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

  private async readRecord(
    projectId: string,
    pageId: string,
  ): Promise<PageRecord> {
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
    return { document, hash: documentHash(document), path };
  }

  async listPages(projectId: string): Promise<PageSummary[]> {
    await this.readProject(projectId);
    const path = join(this.projectPath(projectId), "pages");
    await this.ensureDirectory(path);
    const pages: PageSummary[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new CoreError(
          "INVALID_PATH",
          `Page cannot be a symbolic link: ${entry.name}`,
        );
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".json") ||
        entry.name.startsWith(".")
      )
        continue;
      const record = await this.readRecord(projectId, entry.name.slice(0, -5));
      pages.push({
        id: record.document.id,
        title: record.document.title,
        updatedAt: record.document.updatedAt,
        icon: record.document.icon,
        hash: record.hash,
        blockCount: indexBlocks(record.document).size,
      });
    }
    return pages.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  private async checkpoint(
    projectId: string,
    record: PageRecord,
  ): Promise<void> {
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
    if (options.checkpoint !== false) await this.checkpoint(projectId, record);
    return record;
  }

  async createPage(
    projectId: string,
    input: { title?: string; document?: ShowDocument } = {},
  ): Promise<PageRecord> {
    await this.readProject(projectId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const document = normalizeDocument(
      input.document
        ? {
            ...input.document,
            id,
            ...(input.title !== undefined ? { title: input.title } : {}),
            createdAt: now,
            updatedAt: now,
          }
        : {
            id,
            title: input.title ?? "未命名页面",
            icon: "",
            cover: "none",
            parentId: null,
            favorite: false,
            archived: false,
            createdAt: now,
            updatedAt: now,
            content: { type: "doc", content: [{ type: "paragraph" }] },
            comments: [],
          },
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
  }

  private async commit(
    projectId: string,
    pageId: string,
    current: PageRecord,
    input: ShowDocument,
  ): Promise<PageRecord> {
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
    await this.atomicWrite(record.path, serializeArtifact(document));
    return record;
  }

  async savePage(
    projectId: string,
    pageId: string,
    document: ShowDocument,
    baseHash: string,
  ): Promise<PageRecord> {
    assertHash(baseHash);
    this.pagePath(projectId, pageId);
    await this.readProject(projectId);
    return this.withLock(`page-${projectId}-${pageId}`, async () => {
      const current = await this.readRecord(projectId, pageId);
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
