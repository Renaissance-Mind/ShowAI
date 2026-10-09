import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { ContentLibrary as GitLibrary } from "./content-library";
import { FileStore, assertId } from "./store";
import { CoreError } from "./model";
import { documentHash, normalizeDocument, canonicalJson } from "./diff";
import { upgradeResource } from "../surface/containers.mjs";
import { parseArtifact, serializeArtifact } from "../portable/validation.mjs";
import {
  importCompiledComponents,
  lockDocumentComponents,
  listComponents,
  listTemplates,
  readComponentSource,
  resolveDocumentComponents,
} from "./catalog";
import {
  atomicLibraryFile,
  readLibraryBytes,
  safeLibraryPath,
} from "./library-files";
import { withLibraryLock } from "./library-lock";
import { versionedLibrary } from "./library-runtime";
import { LibraryIndex } from "./library-index";
import { changeContext } from "./history-context";
import { stageReader } from "./archived-reader";
import type { LibraryManifest, FileChanges } from "./history-model";

const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const isId = (id: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const contentRoots = ["projects", "packages", "publications", "sidebar.json"];
const draftRoots = [
  "local/editor-drafts",
  "local/draft-assets",
  "local/discarded-drafts",
];

export interface LegacyFile {
  path: string;
  bytes: number;
  sha256: string;
  /** Observed filesystem time; neither a verified edit time nor a history order. */
  observedModifiedAt: string;
  kind: "content" | "snapshot" | "auxiliary" | "draft";
}
export interface ImportedSnapshot {
  id: string;
  projectId: string;
  pageId: string;
  originalPath: string;
  originalHash: string;
  path?: string;
  contentHash?: string;
  issue?: string;
  actor: "unknown";
  editTime: null;
  order: null;
}
export interface ImportedPage {
  projectId: string;
  pageId: string;
  originalHash: string;
  contentHash: string;
}
export interface LibraryImportReport {
  format: "showai-library-import";
  version: 1;
  id: string;
  source: string;
  destination: string;
  preparedAt: string;
  sourceFingerprint: string;
  sourceDirectories: string[];
  files: LegacyFile[];
  pages: ImportedPage[];
  snapshots: ImportedSnapshot[];
  issues: string[];
  libraryId: string;
  revision: string;
  projects: number;
  components: number;
  templates: number;
}
interface ImportInstallation {
  format: "showai-import-installation";
  version: 1;
  id: string;
  state: "prepared" | "installing" | "active" | "superseded";
  retainedInstallation?: "retained-installation";
  retentionComplete?: boolean;
  report: LibraryImportReport;
  manifest: LibraryManifest;
}

/** A content inventory never reads or imports application launch configuration. */
async function inventory(root: string) {
  const files: LegacyFile[] = [],
    directories: string[] = [],
    data = new Map<string, Buffer>();
  await safeLibraryPath(root, root);
  async function visit(path: string, draft: boolean) {
    const absolute = join(root, path);
    await safeLibraryPath(root, absolute);
    const stat = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stat) return;
    if (stat.isDirectory()) {
      directories.push(path);
      for (const name of (await readdir(absolute)).sort()) {
        if (/[\x00-\x1f\\]/.test(name))
          throw new CoreError(
            "INVALID_PATH",
            `Unsupported legacy filename: ${path}`,
          );
        await visit(`${path}/${name}`, draft);
      }
    } else if (stat.isFile()) {
      const bytes = await readLibraryBytes(root, absolute);
      if (!bytes)
        throw new CoreError(
          "CONFLICT",
          `The source disappeared during import: ${path}`,
        );
      const kind = draft
        ? "draft"
        : /\/snapshots\//.test(path)
          ? "snapshot"
          : /\/exports\//.test(path)
            ? "auxiliary"
            : "content";
      data.set(path, bytes);
      files.push({
        path,
        bytes: bytes.length,
        sha256: hash(bytes),
        observedModifiedAt: stat.mtime.toISOString(),
        kind,
      });
    } else
      throw new CoreError(
        "INVALID_PATH",
        `Unsupported legacy filesystem entry: ${path}`,
      );
  }
  for (const path of contentRoots) await visit(path, false);
  for (const path of draftRoots) await visit(path, true);
  files.sort((a, b) => a.path.localeCompare(b.path));
  directories.sort();
  return {
    files,
    directories,
    data,
    fingerprint: hash(
      canonicalJson({
        files: files.map(({ path, sha256, bytes }) => ({
          path,
          sha256,
          bytes,
        })),
        directories,
      }),
    ),
  };
}
function overlapping(left: string, right: string) {
  const local = relative(left, right);
  return (
    local === "" ||
    (!isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`))
  );
}
async function locked<T>(roots: string[], action: () => Promise<T>) {
  const ordered = [...new Set(roots)].sort();
  const enter = (index: number): Promise<T> =>
    index === ordered.length
      ? action()
      : withLibraryLock(ordered[index], () =>
          withLibraryLock(ordered[index], () => enter(index + 1), "drafts"),
        );
  return enter(0);
}
function canonicalContent(path: string) {
  return (
    path === "sidebar.json" ||
    path.startsWith("packages/") ||
    path.startsWith("publications/") ||
    /^projects\/[^/]+\/(?:project\.json$|pages\/[^/]+\.json$|packages\/)/.test(
      path,
    )
  );
}
function migratedDocument(bytes: Buffer, projectId: string, pageId: string) {
  assertId(projectId);
  assertId(pageId);
  const artifact = parseArtifact(JSON.parse(bytes.toString("utf8")));
  if (artifact.document.id !== pageId)
    throw new CoreError(
      "INVALID_DATA",
      `Page identity differs from its filename: ${pageId}`,
    );
  return {
    artifact,
    document: normalizeDocument(
      upgradeResource(normalizeDocument(artifact.document)),
    ),
  };
}

/** Prepare, verify, then publish the format marker last. Original files remain untouched. */
export class LibraryImport {
  readonly root: string;
  constructor(destination: string) {
    this.root = resolve(destination);
  }
  private directory(id: string) {
    if (!isId(id))
      throw new CoreError("INVALID_PATH", "Invalid import identity.");
    return join(this.root, "local", "imports", id);
  }
  private async installation(id: string): Promise<ImportInstallation> {
    const bytes = await readLibraryBytes(
      this.root,
      join(this.directory(id), "installation.json"),
    );
    if (!bytes)
      throw new CoreError("NOT_FOUND", "Prepared library import not found.");
    const value = JSON.parse(bytes.toString("utf8")) as ImportInstallation;
    if (
      value.format !== "showai-import-installation" ||
      value.version !== 1 ||
      value.id !== id ||
      value.report.id !== id ||
      value.report.destination !== this.root ||
      !["prepared", "installing", "active", "superseded"].includes(
        value.state,
      ) ||
      value.manifest.id !== value.report.libraryId ||
      !/^[a-f0-9]{64}$/.test(value.report.sourceFingerprint) ||
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.report.revision) ||
      !isAbsolute(value.report.source)
    )
      throw new CoreError(
        "INVALID_DATA",
        "Invalid library import installation record.",
      );
    return value;
  }
  private save(value: ImportInstallation) {
    return atomicLibraryFile(
      this.root,
      join(this.directory(value.id), "installation.json"),
      Buffer.from(JSON.stringify(value, null, 2)),
    );
  }
  private async retainInactiveInstallation(currentId: string) {
    const present = async (path: string) =>
      lstat(path).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
    for (const report of await this.list()) {
      if (report.id === currentId) continue;
      const previous = await this.installation(report.id);
      if (previous.state !== "installing" && previous.state !== "superseded")
        continue;
      if (previous.retentionComplete) continue;
      const repository = new GitLibrary(this.root),
        retained = join(this.directory(report.id), "retained-installation");
      if (previous.state === "installing") {
        if (
          !(await present(repository.repository)) ||
          (await repository.head()) !== report.revision
        )
          continue;
        const stored = JSON.parse(
          (
            await repository.readFile(
              `imports/${report.id}/manifest.json`,
              report.revision,
            )
          ).toString("utf8"),
        );
        const { revision: _revision, ...originalReport } = report;
        if (canonicalJson(stored) !== canonicalJson(originalReport))
          throw new CoreError(
            "INVALID_DATA",
            "Inactive installation ownership differs from its import report.",
          );
        previous.state = "superseded";
        previous.retainedInstallation = "retained-installation";
        await this.save(previous);
      }
      if (previous.retainedInstallation !== "retained-installation")
        throw new CoreError(
          "INVALID_DATA",
          "Superseded installation has no retained location.",
        );
      await safeLibraryPath(this.root, retained);
      await mkdir(retained, { recursive: true });
      const owningRepository = (await present(repository.repository))
        ? repository
        : new GitLibrary(retained);
      if ((await owningRepository.head()) !== report.revision)
        throw new CoreError(
          "CONFLICT",
          "The incomplete installation has newer content; all repositories were retained.",
        );
      for (const name of ["history", "repository.git", "workspace"]) {
        const source = join(this.root, name),
          destination = join(retained, name);
        await safeLibraryPath(this.root, source);
        await safeLibraryPath(this.root, destination);
        const from = await present(source),
          to = await present(destination);
        if (from && to)
          throw new CoreError(
            "CONFLICT",
            "Both incomplete installation copies exist; no files were overwritten.",
          );
        if (from) await rename(source, destination);
      }
      previous.retentionComplete = true;
      await this.save(previous);
    }
  }
  async list(): Promise<LibraryImportReport[]> {
    const names = await readdir(join(this.root, "local", "imports")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const result: LibraryImportReport[] = [];
    for (const name of names) {
      if (!isId(name)) continue;
      const source = await readLibraryBytes(
        this.root,
        join(this.directory(name), "installation.json"),
      );
      if (source) result.push((await this.installation(name)).report);
    }
    return result.sort((a, b) => b.preparedAt.localeCompare(a.preparedAt));
  }
  async original(id: string, path: string): Promise<Buffer> {
    const report = (await this.installation(id)).report;
    const entry = report.files.find((file) => file.path === path);
    if (!entry)
      throw new CoreError("NOT_FOUND", "Original import file not found.");
    if (
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0
    )
      throw new CoreError(
        "INVALID_DATA",
        "Invalid original import file identity.",
      );
    let gzip = await readLibraryBytes(
      this.root,
      join(this.directory(id), "originals", `${entry.sha256}.gz`),
    );
    if (!gzip) {
      const plan = await this.installation(id);
      const prepared = new GitLibrary(
        join(this.directory(id), plan.retainedInstallation ?? "library"),
      );
      const staged = await lstat(prepared.repository).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      gzip = await (staged ? prepared : new GitLibrary(this.root)).readFile(
        `imports/${id}/originals/${entry.sha256}.gz`,
        report.revision,
      );
    }
    const bytes = gunzipSync(gzip, {
      maxOutputLength: Math.max(entry.bytes, 1),
    });
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
      throw new CoreError("INVALID_DATA", "Original import bytes are corrupt.");
    return bytes;
  }
  async prepare(source: string): Promise<LibraryImportReport> {
    source = resolve(source);
    if (
      source !== this.root &&
      (overlapping(source, this.root) || overlapping(this.root, source))
    )
      throw new CoreError(
        "INVALID_PATH",
        "Source and destination must be separate directories, or the same library for in-place activation.",
      );
    await safeLibraryPath(source, source);
    await safeLibraryPath(this.root, this.root);
    return locked([source, this.root], async () => {
      if (versionedLibrary(source))
        throw new CoreError(
          "CONFLICT",
          "The source is already a versioned library.",
        );
      if (versionedLibrary(this.root))
        throw new CoreError(
          "CONFLICT",
          "Import into an empty destination or activate a prepared import.",
        );
      const observed = await inventory(source);
      for (const previous of await this.list()) {
        const state = await this.installation(previous.id);
        if (
          previous.source === source &&
          previous.sourceFingerprint === observed.fingerprint &&
          state.state === "prepared"
        ) {
          const prepared = new GitLibrary(
            join(this.directory(previous.id), "library"),
          );
          await prepared.verify();
          if ((await prepared.head()) === previous.revision) return previous;
        }
      }
      if (source !== this.root && (await inventory(this.root)).files.length)
        throw new CoreError(
          "CONFLICT",
          "The destination already contains a file library. Its content was retained.",
        );
      const id = randomUUID(),
        directory = this.directory(id),
        stage = join(directory, "library"),
        library = new GitLibrary(stage);
      const manifest = await library.initialize();
      // Exact raw bytes are retained independently of normalized page objects.
      for (const file of observed.files) {
        const path = join(directory, "originals", `${file.sha256}.gz`);
        if (!(await readLibraryBytes(this.root, path)))
          await atomicLibraryFile(
            this.root,
            path,
            gzipSync(observed.data.get(file.path)!, { level: 6 }),
          );
      }
      const pages: ImportedPage[] = [],
        snapshots: ImportedSnapshot[] = [],
        issues: string[] = [];
      const changes: FileChanges = new Map();
      for (const file of observed.files)
        changes.set(
          `imports/${id}/originals/${file.sha256}.gz`,
          gzipSync(observed.data.get(file.path)!, { level: 6 }),
        );
      const incoming = new Map<string, ReturnType<typeof migratedDocument>>();
      for (const file of observed.files) {
        const current = file.path.match(
          /^projects\/([^/]+)\/pages\/([^/]+)\.json$/,
        );
        if (current) {
          incoming.set(
            file.path,
            migratedDocument(
              observed.data.get(file.path)!,
              current[1],
              current[2],
            ),
          );
          continue;
        }
        if (canonicalContent(file.path))
          changes.set(file.path, observed.data.get(file.path)!);
      }
      const preparedAt = new Date().toISOString();
      let projects = 0,
        components = 0,
        templates = 0;
      const result = await library.transaction(
        {
          ...changeContext(),
          operationId: `legacy-import:${id}`,
          message: "导入旧内容库；旧修改时间和来源未知",
        },
        async () => {
          await library.stageFiles(changes);
          for (const [path, value] of incoming) {
            const match = path.match(
              /^projects\/([^/]+)\/pages\/([^/]+)\.json$/,
            )!;
            if (value.artifact.components?.length)
              await importCompiledComponents(
                stage,
                value.artifact.components,
                match[1],
              );
            const document = await lockDocumentComponents(
              stage,
              value.document,
              match[1],
            );
            const pageFiles = new Map<string, Buffer | null>([
              [path, Buffer.from(serializeArtifact(document))],
            ]);
            await stageReader(pageFiles, path, document, "import-time");
            await library.stageFiles(pageFiles);
            pages.push({
              projectId: match[1],
              pageId: match[2],
              originalHash: hash(observed.data.get(path)!),
              contentHash: documentHash(document),
            });
          }
          const store = new FileStore(stage),
            projectList = await store.listProjects();
          projects = projectList.length;
          // Validate raw package integrity and all current page dependency closures.
          for (const projectId of [
            undefined,
            ...projectList.map((item) => item.id),
          ]) {
            const scope = projectId ? "project" : "global";
            const compiled = await listComponents(stage, projectId, { scope });
            components += compiled.length;
            for (const component of compiled) {
              const prefix = `${projectId ? `projects/${projectId}/` : ""}packages/components/${component.id}/${component.version}/`;
              if (
                component.entry &&
                observed.data.has(`${prefix}manifest.json`) &&
                observed.data.has(`${prefix}props.schema.json`)
              )
                await readComponentSource(
                  stage,
                  component.id,
                  component.version,
                  projectId,
                  { scope, integrity: component.integrity },
                );
            }
            templates += (await listTemplates(stage, projectId, { scope }))
              .length;
          }
          components += (
            await listComponents(stage, undefined, { scope: "published" })
          ).length;
          templates += (
            await listTemplates(stage, undefined, { scope: "published" })
          ).length;
          for (const item of pages) {
            const record = await store.readPage(item.projectId, item.pageId, {
              checkpoint: false,
            });
            await resolveDocumentComponents(
              stage,
              record.document,
              item.projectId,
            );
            if (documentHash(record.document) !== item.contentHash)
              throw new CoreError(
                "INVALID_DATA",
                "Imported page verification differs.",
              );
          }
          await store.readSidebar();
          for (const file of observed.files.filter(
            (item) => item.kind === "snapshot",
          )) {
            const match = file.path.match(
              /^projects\/([^/]+)\/snapshots\/([^/]+)\/([a-f0-9]{64})\.json$/,
            );
            if (!match) {
              issues.push(
                `Unrecognized legacy snapshot retained: ${file.path}`,
              );
              continue;
            }
            const snapshot: ImportedSnapshot = {
              id: hash(file.path),
              projectId: match[1],
              pageId: match[2],
              originalHash: match[3],
              originalPath: file.path,
              actor: "unknown",
              editTime: null,
              order: null,
            };
            try {
              const { artifact, document } = migratedDocument(
                observed.data.get(file.path)!,
                match[1],
                match[2],
              );
              if (documentHash(artifact.document) !== match[3])
                throw new CoreError(
                  "INVALID_DATA",
                  "Snapshot content differs from its legacy hash.",
                );
              const locked = await lockDocumentComponents(
                stage,
                document,
                match[1],
              );
              await resolveDocumentComponents(stage, locked, match[1]);
              snapshot.path = `imports/${id}/snapshots/${snapshot.id}.json`;
              snapshot.contentHash = documentHash(locked);
              const snapshotFiles = new Map<string, Buffer | null>([
                [snapshot.path, Buffer.from(serializeArtifact(locked))],
              ]);
              await stageReader(
                snapshotFiles,
                snapshot.path,
                locked,
                "import-time",
              );
              await library.stageFiles(snapshotFiles);
            } catch (error) {
              if (
                !(error instanceof Error) ||
                error instanceof TypeError ||
                error instanceof ReferenceError
              )
                throw error;
              snapshot.issue = error.message;
              issues.push(`${file.path}: ${error.message}`);
            }
            snapshots.push(snapshot);
          }
          const descriptor = {
            format: "showai-library-import",
            version: 1,
            id,
            source,
            destination: this.root,
            preparedAt,
            sourceFingerprint: observed.fingerprint,
            sourceDirectories: observed.directories,
            files: observed.files,
            pages,
            snapshots,
            issues,
            libraryId: manifest.id,
            projects,
            components,
            templates,
          };
          await library.stageFiles(
            new Map([
              [
                `imports/${id}/manifest.json`,
                Buffer.from(JSON.stringify(descriptor, null, 2)),
              ],
            ]),
          );
        },
      );
      if (!result.entry)
        throw new CoreError(
          "INVALID_DATA",
          "Library import did not create a revision.",
        );
      await library.verify();
      await new LibraryIndex(stage).synchronize(true);
      if ((await inventory(source)).fingerprint !== observed.fingerprint)
        throw new CoreError(
          "CONFLICT",
          "The source changed during import. Original and prepared bytes were retained; prepare again from the current source.",
        );
      const report: LibraryImportReport = {
        format: "showai-library-import",
        version: 1,
        id,
        source,
        destination: this.root,
        preparedAt,
        sourceFingerprint: observed.fingerprint,
        sourceDirectories: observed.directories,
        files: observed.files,
        pages,
        snapshots,
        issues,
        libraryId: manifest.id,
        revision: result.entry.revision,
        projects,
        components,
        templates,
      };
      await this.save({
        format: "showai-import-installation",
        version: 1,
        id,
        state: "prepared",
        report,
        manifest,
      });
      return report;
    });
  }
  async activate(id: string): Promise<LibraryImportReport> {
    const initial = await this.installation(id);
    return locked([initial.report.source, this.root], async () => {
      const plan = await this.installation(id),
        marker = versionedLibrary(this.root);
      if (marker) {
        if ((await marker.manifest()).id !== plan.manifest.id)
          throw new CoreError(
            "CONFLICT",
            "A different versioned library is already active.",
          );
        await marker.verify();
        return plan.report;
      }
      if (plan.state === "superseded")
        throw new CoreError(
          "CONFLICT",
          "This interrupted import was retained and superseded. Prepare a fresh import to activate current source content.",
        );
      if (
        (await inventory(plan.report.source)).fingerprint !==
        plan.report.sourceFingerprint
      )
        throw new CoreError(
          "CONFLICT",
          "Source content changed after preparation. Prepare a fresh import before activating; all previous inputs remain retained.",
        );
      const stage = join(this.directory(id), "library");
      await this.retainInactiveInstallation(id);
      plan.state = "installing";
      await this.save(plan);
      const preparedManifest = JSON.parse(
        await readFile(join(stage, "library.json"), "utf8"),
      ) as LibraryManifest;
      for (const name of [
        preparedManifest.storage === "sqlite" ? "history" : "repository.git",
        "workspace",
      ]) {
        const source = join(stage, name),
          destination = join(this.root, name);
        await safeLibraryPath(this.root, source);
        await safeLibraryPath(this.root, destination);
        const from = await lstat(source).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        const to = await lstat(destination).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (from && to)
          throw new CoreError(
            "CONFLICT",
            `Activation destination already exists: ${name}. Existing data was retained.`,
          );
        if (from) await rename(source, destination);
        else if (!to)
          throw new CoreError(
            "NOT_FOUND",
            `Prepared import is missing ${name}.`,
          );
      }
      const library = new GitLibrary(this.root);
      if ((await library.head()) !== plan.report.revision)
        throw new CoreError(
          "INVALID_DATA",
          "Prepared repository revision differs from the import report.",
        );
      await library.verify();
      const descriptor = JSON.parse(
        (
          await library.readFile(
            `imports/${id}/manifest.json`,
            plan.report.revision,
          )
        ).toString("utf8"),
      );
      const { revision: _revision, ...reported } = plan.report;
      if (canonicalJson(descriptor) !== canonicalJson(reported))
        throw new CoreError(
          "INVALID_DATA",
          "The import report differs from its committed manifest.",
        );
      for (const file of plan.report.files.filter(
        (item) => item.kind === "draft",
      )) {
        const destination = join(this.root, file.path),
          existing = await readLibraryBytes(this.root, destination);
        if (existing && hash(existing) !== file.sha256)
          throw new CoreError(
            "CONFLICT",
            "A newer local editor draft exists; activation retained both versions.",
          );
        if (!existing)
          await atomicLibraryFile(
            this.root,
            destination,
            await this.original(id, file.path),
          );
      }
      // Publication is atomic. All canonical source files remain at their original locations.
      await atomicLibraryFile(
        this.root,
        join(this.root, "library.json"),
        Buffer.from(JSON.stringify(plan.manifest, null, 2) + "\n"),
      );
      plan.state = "active";
      await this.save(plan);
      return plan.report;
    });
  }
}
