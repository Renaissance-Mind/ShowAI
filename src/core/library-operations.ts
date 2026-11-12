import { ReadBaselines } from "./read-baselines";
import { EditorDrafts } from "./editor-drafts";
import { IndexClient } from "./index-client";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CoreError, type PageRecord, type ShowDocument } from "./model";
import { FileStore, assertId } from "./store";
import { ContentLibrary as GitLibrary } from "./content-library";
import { type PageReferenceOptions, type SearchOptions } from "./library-index";
import {
  versionedLibrary,
  mutateLibrary,
  writeLibraryFiles,
} from "./library-runtime";
import { changeContext, withChangeContext } from "./history-context";
import { documentHash, diffDocuments, normalizeDocument } from "./diff";
import { previewPageMerge } from "./page-merge";
import { WorkspaceProtection } from "./workspace-conflicts";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import { collectCustomComponentRefs } from "../contract/contract";
import { validatePackageBundle, lockDocumentComponents } from "./catalog";
import type {
  CompiledComponent,
  PackageRevisionRef,
  TemplateRecord,
} from "../contract/types";
import type { LibraryImportReport } from "./library-import";
import { isCurrentSyncPath } from "../sync/protocol";
import {
  scanWorkspaceResources,
  recoverExternalPackage,
} from "./package-recovery";
import {
  readArchivedReader,
  readerBindingPath,
  type ReaderBinding,
} from "./archived-reader";
import { injectArtifactIntoHtml } from "../portable/validation.mjs";

export interface HistoryQuery {
  projectId?: string;
  pageId?: string;
  path?: string;
  harness?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  query?: string;
  limit?: number;
  before?: string;
}
export interface HistoricalPage extends PageRecord {
  components: CompiledComponent[];
  sourceRevision: string;
  reader?: ReaderBinding;
}
function revision(value: string): string {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value))
    throw new CoreError(
      "INVALID_DATA",
      "A committed revision identifier is required.",
    );
  return value;
}

/** A package revision's stored record and the files under its root. */
interface LocatedPackage {
  root: string;
  kind: "components" | "templates";
  record: CompiledComponent | TemplateRecord;
  sourceFiles: Map<string, Buffer>;
}
interface DependencyContext {
  sourceRevision: string;
  tree: { path: string; oid: string }[];
  paths: Set<string>;
  packages: Map<string, Promise<LocatedPackage>>;
  validated: Set<string>;
}

/** Shared versioned operations for CLI, MCP and both workbench hosts. */
export class LibraryOperations {
  readonly library: GitLibrary;
  readonly store: FileStore;
  readonly index: IndexClient;
  constructor(
    readonly home: string,
    readonly boundProject?: string,
  ) {
    const library = versionedLibrary(home);
    if (!library)
      throw new CoreError(
        "INVALID_DATA",
        "This library needs a one-time import into the versioned format.",
      );
    this.library = library;
    this.store = new FileStore(home);
    this.index = new IndexClient(home);
  }
  private project(value?: string): string | undefined {
    const selected = value ?? this.boundProject;
    if (this.boundProject && selected !== this.boundProject)
      throw new CoreError(
        "INVALID_PATH",
        "This connection cannot access another project's history.",
      );
    return selected ? assertId(selected) : undefined;
  }
  private pagePath(projectId: string, pageId: string): string {
    const project = this.project(projectId)!;
    return `projects/${project}/pages/${assertId(pageId)}.json`;
  }
  private path(value: string): string {
    if (
      !value ||
      value.includes("\\") ||
      value.split("/").some((part) => !part || part === "." || part === "..") ||
      !/^(projects\/|packages\/|publications\/|sidebar\.json$)/.test(value)
    )
      throw new CoreError("INVALID_PATH", "Invalid versioned resource path.");
    if (
      this.boundProject &&
      !value.startsWith(`projects/${this.boundProject}/`)
    )
      throw new CoreError(
        "INVALID_PATH",
        "This connection cannot read shared or foreign history paths.",
      );
    return value;
  }
  history(input: HistoryQuery = {}) {
    const projectId = this.project(input.projectId);
    if (input.pageId && !projectId)
      throw new CoreError("INVALID_DATA", "Page history requires projectId.");
    const path = input.pageId
      ? this.pagePath(projectId!, input.pageId)
      : input.path
        ? this.path(input.path)
        : undefined;
    return this.index.history({ ...input, projectId, path });
  }
  search(input: SearchOptions) {
    return this.index.search({
      ...input,
      projectId: this.project(input.projectId),
    });
  }
  references(
    kind: string,
    id: string,
    input: { projectId?: string; version?: string; integrity?: string } = {},
  ) {
    return this.index.references(kind, id, {
      ...input,
      projectId: this.project(input.projectId),
    });
  }
  /** Backlinks (to) and outgoing references (from) of a page; a bound connection sees its own project only. */
  pageReferences(
    projectId: string,
    pageId: string,
    input: Omit<PageReferenceOptions, "scope"> = {},
  ) {
    const project = this.project(projectId)!;
    return this.index.pageReferences(project, assertId(pageId), {
      ...input,
      ...(this.boundProject ? { scope: this.boundProject } : {}),
    });
  }
  async changes(
    before: string,
    after: string,
    input: { projectId?: string; pageId?: string } = {},
  ) {
    revision(before);
    revision(after);
    const projectId = this.project(input.projectId);
    if (input.pageId) {
      if (!projectId)
        throw new CoreError(
          "INVALID_DATA",
          "Page comparison requires projectId.",
        );
      const path = this.pagePath(projectId, input.pageId);
      const left = await this.library.readFile(path, before),
        right = await this.library.readFile(path, after);
      const a = normalizeDocument(
          parseArtifact(JSON.parse(left.toString())).document,
        ),
        b = normalizeDocument(
          parseArtifact(JSON.parse(right.toString())).document,
        );
      return {
        before,
        after,
        projectId,
        pageId: input.pageId,
        changes: diffDocuments(a, b),
        beforeHash: documentHash(a),
        afterHash: documentHash(b),
      };
    }
    const paths = (await this.library.changedPaths(before, after)).filter(
      (path) =>
        !path.startsWith("assets/") &&
        (!projectId || path.startsWith(`projects/${projectId}/`)),
    );
    return { before, after, paths };
  }

  /**
   * Revision state one dependency resolution reads, shareable by several
   * resolutions at the same revision: its tree, each package revision found
   * with its files, and the bundles already validated.
   */
  private async dependencyContext(
    sourceRevision: string,
  ): Promise<DependencyContext> {
    const tree = await this.library.tree(sourceRevision);
    return {
      sourceRevision,
      tree,
      paths: new Set(tree.map((entry) => entry.path)),
      packages: new Map(),
      validated: new Set(),
    };
  }

  private async dependencies(
    document: ShowDocument,
    projectId: string,
    sourceRevision: string,
    extraRefs: PackageRevisionRef[] = [],
    shared?: DependencyContext,
  ): Promise<{ components: CompiledComponent[]; files: Map<string, Buffer> }> {
    const context =
      shared?.sourceRevision === sourceRevision
        ? shared
        : await this.dependencyContext(sourceRevision);
    const { tree, paths } = context;
    const components: CompiledComponent[] = [],
      templates: TemplateRecord[] = [],
      files = new Map<string, Buffer>(),
      visited = new Set<string>();
    /** The stored revision a reference names and the files under its root. */
    const locate = async (ref: PackageRevisionRef): Promise<LocatedPackage> => {
      const kind = ref.kind === "component" ? "components" : "templates",
        filename = ref.kind === "component" ? "compiled.json" : "template.json";
      const historical = `projects/${projectId}/packages/historical/${kind}/${ref.integrity}`;
      const roots = [
        historical,
        `projects/${projectId}/packages/${kind}/${ref.id}/${ref.version}`,
        `packages/${kind}/${ref.id}/${ref.version}`,
        `packages/published/${kind}/${ref.id}/${ref.version}`,
      ];
      let found:
        | { root: string; record: CompiledComponent | TemplateRecord }
        | undefined;
      for (const root of roots)
        if (paths.has(`${root}/${filename}`)) {
          const record = JSON.parse(
            (
              await this.library.readFile(`${root}/${filename}`, sourceRevision)
            ).toString(),
          ) as CompiledComponent | TemplateRecord;
          if (
            record.id === ref.id &&
            record.version === ref.version &&
            record.integrity === ref.integrity
          ) {
            found = { root, record };
            break;
          }
        }
      if (!found)
        throw new CoreError(
          "NOT_FOUND",
          `Historical dependency is missing: ${ref.id}@${ref.version} (${ref.integrity}).`,
        );
      const owned = tree
        .filter((entry) => entry.path.startsWith(found!.root + "/"))
        .map((entry) => entry.path);
      const sourceFiles = await this.library.readFiles(owned, sourceRevision);
      return { ...found, kind, sourceFiles };
    };
    const walk = async (
      ref: PackageRevisionRef,
      depth: number,
    ): Promise<void> => {
      if (depth > 16 || visited.size > 1000)
        throw new CoreError(
          "INVALID_DATA",
          "Historical dependency closure is too large or deep.",
        );
      const key = `${ref.kind}:${ref.id}@${ref.version}:${ref.integrity}`;
      if (visited.has(key)) return;
      visited.add(key);
      // Where a reference resolves depends only on it and this project.
      const located = `${projectId}\0${key}`;
      let resolution = context.packages.get(located);
      if (!resolution) {
        resolution = locate(ref);
        context.packages.set(located, resolution);
      }
      const found = await resolution;
      for (const dependency of found.record.dependencies ?? [])
        await walk(dependency, depth + 1);
      // Exact immutable identities can coexist with same-name current versions.
      const target = `projects/${projectId}/packages/historical/${found.kind}/${ref.integrity}`;
      for (const [path, bytes] of found.sourceFiles)
        files.set(`${target}/${path.slice(found.root.length + 1)}`, bytes);
      if (ref.kind === "component")
        components.push(found.record as CompiledComponent);
      else templates.push(found.record as TemplateRecord);
    };
    const refs = collectCustomComponentRefs(document).map(
      (ref): PackageRevisionRef => ({
        kind: "component",
        id: ref.componentId,
        version: ref.version!,
        integrity: ref.integrity!,
        ...(ref.scope ? { scope: ref.scope } : {}),
      }),
    );
    refs.push(...extraRefs);
    for (const ref of refs) await walk(ref, 0);
    const included = JSON.stringify([
      components.map((item) => `${item.id}@${item.version}:${item.integrity}`),
      templates.map((item) => `${item.id}@${item.version}:${item.integrity}`),
    ]);
    for (const root of refs) {
      // The same root over the same stored records validates the same way.
      const bundle = JSON.stringify([projectId, root, included]);
      if (context.validated.has(bundle)) continue;
      validatePackageBundle({
        format: "showai-catalog-bundle",
        version: 1,
        root,
        components: components.map((component) => ({ component })),
        templates,
      });
      context.validated.add(bundle);
    }
    return { components, files };
  }

  /** Current project content and its precise shared dependencies; history stays local. */
  async projectFiles(
    projectId: string,
    sourceRevision: string,
  ): Promise<Map<string, Buffer>> {
    const project = this.project(projectId)!;
    // Pages share one tree and resolve each package revision once.
    const context = await this.dependencyContext(sourceRevision);
    const paths = context.tree
      .map((entry) => entry.path)
      .filter(
        (path) =>
          path.startsWith(`projects/${project}/`) &&
          !/\/pages\/[^/]+\/nodes\//.test(path) &&
          !path.includes("/.sync/") &&
          isCurrentSyncPath(path),
      );
    const files = await this.library.readFiles(paths, sourceRevision);
    for (const [path, bytes] of [...files]) {
      if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)) {
        const document = parseArtifact(JSON.parse(bytes.toString())).document;
        const closure = await this.dependencies(
          document,
          project,
          sourceRevision,
          [],
          context,
        );
        for (const [name, content] of closure.files) files.set(name, content);
      }
      if (/\/(?:compiled|template)\.json$/.test(path)) {
        const record = JSON.parse(bytes.toString()) as
          CompiledComponent | TemplateRecord;
        if (record.dependencies?.length) {
          const document = {
            content: {
              type: "surface",
              attrs: { id: "sync-dependencies", kind: "page" },
              content: [],
            },
          } as unknown as ShowDocument;
          const closure = await this.dependencies(
            document,
            project,
            sourceRevision,
            record.dependencies,
            context,
          );
          for (const [name, content] of closure.files) files.set(name, content);
        }
      }
    }
    const metadataPath = `projects/${project}/project.json`;
    const metadata = JSON.parse(files.get(metadataPath)!.toString());
    // Host paths and Agent directory bindings remain device-local.
    delete metadata.sourceDirectory;
    delete metadata.binding;
    delete metadata.bindings;
    files.set(
      metadataPath,
      Buffer.from(JSON.stringify(metadata, null, 2) + "\n"),
    );
    return files;
  }

  async pageAt(
    projectId: string,
    pageId: string,
    sourceRevision: string,
  ): Promise<HistoricalPage> {
    const path = this.pagePath(projectId, pageId);
    revision(sourceRevision);
    const artifact = parseArtifact(
      JSON.parse(
        (await this.library.readFile(path, sourceRevision)).toString(),
      ),
    );
    const document = normalizeDocument(artifact.document),
      closure = await this.dependencies(document, projectId, sourceRevision);
    const reader = await this.readerAt(path, sourceRevision);
    return {
      document,
      hash: documentHash(document),
      path: join(this.library.workspace, path),
      revision:
        (await this.library.resourceRevision(path, sourceRevision)) ??
        sourceRevision,
      sourceRevision,
      components: closure.components,
      ...(reader ? { reader: reader.ref } : {}),
    };
  }
  private async readerAt(path: string, sourceRevision: string) {
    const refPath = readerBindingPath(path);
    const bytes = await this.library
      .readFile(refPath, sourceRevision)
      .catch((error) => {
        if (error instanceof CoreError && error.code === "NOT_FOUND")
          return null;
        throw error;
      });
    if (!bytes) return null;
    return readArchivedReader(path, (name) =>
      name === refPath
        ? Promise.resolve(bytes)
        : this.library.readFile(name, sourceRevision),
    );
  }
  async historicalHtml(
    projectId: string,
    pageId: string,
    sourceRevision: string,
  ) {
    const page = await this.pageAt(projectId, pageId, sourceRevision),
      reader = await this.readerAt(
        this.pagePath(projectId, pageId),
        sourceRevision,
      );
    if (!reader)
      throw new CoreError(
        "NOT_FOUND",
        "This version predates reader capture. Its content is retained, but its original reader is unavailable.",
      );
    return {
      html: injectArtifactIntoHtml(reader.html, page.document, page.components),
      reader: reader.ref,
      revision: sourceRevision,
    };
  }

  async restorePage(input: {
    projectId: string;
    pageId: string;
    revision: string;
    baseRevision: string | null;
    importedSnapshot?: { importId: string; snapshotId: string };
  }): Promise<PageRecord> {
    const path = this.pagePath(input.projectId, input.pageId),
      historical = input.importedSnapshot
        ? await this.importedPage(
            input.projectId,
            input.pageId,
            input.importedSnapshot,
          )
        : await this.pageAt(input.projectId, input.pageId, input.revision);
    const closure = await this.dependencies(
      historical.document,
      input.projectId,
      historical.sourceRevision,
    );
    const reader = await this.readerAt(
      historical.path.startsWith(this.library.workspace)
        ? historical.path
            .slice(this.library.workspace.length + 1)
            .split("\\")
            .join("/")
        : path,
      historical.sourceRevision,
    );
    if (reader) {
      for (const [name, bytes] of reader.files)
        if (name.startsWith("runtimes/")) closure.files.set(name, bytes);
      closure.files.set(
        readerBindingPath(path),
        Buffer.from(JSON.stringify(reader.ref)),
      );
    }
    const context = {
      ...changeContext(),
      restoredFrom: input.importedSnapshot
        ? (historical.revision ?? historical.sourceRevision)
        : historical.sourceRevision,
      restoredSnapshot: input.importedSnapshot,
      message: changeContext().message ?? "Restore page version",
    };
    return withChangeContext(context, () =>
      mutateLibrary(
        this.home,
        async () => {
          await writeLibraryFiles(this.home, closure.files);
          const document = await lockDocumentComponents(
            this.home,
            historical.document,
            input.projectId,
          );
          const existing = await this.library.resourceRevision(path);
          if (existing !== input.baseRevision)
            throw new CoreError(
              "CONFLICT",
              "The page changed before restoration.",
              { currentRevision: existing ?? undefined },
            );
          const restored = {
            ...document,
            archived: false,
            updatedAt: new Date().toISOString(),
          };
          await writeLibraryFiles(
            this.home,
            new Map([[path, Buffer.from(serializeArtifact(restored))]]),
            new Map([[path, input.baseRevision]]),
          );
          return {
            document: restored,
            hash: documentHash(restored),
            path: join(this.library.workspace, path),
          };
        },
        context,
      ),
    );
  }

  async importedSnapshots(projectId: string, pageId?: string) {
    this.project(projectId);
    assertId(projectId);
    if (pageId) assertId(pageId);
    return this.library.readSnapshot(async (head) => {
      if (!head) return [];
      const manifests = (await this.library.tree(head)).filter(
        (entry) =>
          /^imports\/[a-f0-9-]{36}\/manifest\.json$/.test(entry.path) ||
          (entry.path.startsWith(`projects/${projectId}/history/imports/`) &&
            entry.path.endsWith("/manifest.json")),
      );
      const result = [];
      for (const entry of manifests) {
        const descriptor = JSON.parse(
          (await this.library.readFile(entry.path, head)).toString("utf8"),
        ) as Omit<LibraryImportReport, "revision">;
        if (
          descriptor.format !== "showai-library-import" ||
          descriptor.version !== 1 ||
          !Array.isArray(descriptor.snapshots)
        )
          throw new CoreError(
            "INVALID_DATA",
            "Invalid imported snapshot manifest.",
          );
        const sourceRevision = await this.library.resourceRevision(
          entry.path,
          head,
        );
        for (const snapshot of descriptor.snapshots)
          if (
            snapshot.projectId === projectId &&
            (!pageId || snapshot.pageId === pageId)
          )
            result.push({
              ...snapshot,
              importId: descriptor.id,
              importedAt: descriptor.preparedAt,
              sourceRevision: sourceRevision!,
            });
      }
      return result;
    });
  }
  async importedPage(
    projectId: string,
    pageId: string,
    ref: { importId: string; snapshotId: string },
  ): Promise<HistoricalPage> {
    const snapshot = (await this.importedSnapshots(projectId, pageId)).find(
      (item) => item.importId === ref.importId && item.id === ref.snapshotId,
    );
    if (!snapshot)
      throw new CoreError(
        "NOT_FOUND",
        "Imported page snapshot not found in this project.",
      );
    if (snapshot.issue || !snapshot.path)
      throw new CoreError(
        "INVALID_DATA",
        `This old snapshot is retained as original bytes but cannot be rendered: ${snapshot.issue ?? "missing content"}`,
      );
    const traditional = `imports/${ref.importId}/snapshots/${ref.snapshotId}.json`,
      scoped = `projects/${projectId}/history/imports/${ref.importId}/snapshots/${ref.snapshotId}.json`;
    const path = snapshot.path;
    if (
      (path !== traditional && path !== scoped) ||
      !/^[a-f0-9]{64}$/.test(ref.snapshotId)
    )
      throw new CoreError("INVALID_DATA", "Invalid imported snapshot path.");
    // Imported snapshots are immutable files in the current state; the import
    // revision itself is superseded by later saves and no longer readable.
    return this.library.readSnapshot(async (current) => {
      if (!current)
        throw new CoreError("NOT_FOUND", "The content library is empty.");
      const document = normalizeDocument(
        parseArtifact(
          JSON.parse(
            (await this.library.readFile(path, current)).toString("utf8"),
          ),
        ).document,
      );
      if (
        document.id !== pageId ||
        documentHash(document) !== snapshot.contentHash
      )
        throw new CoreError(
          "INVALID_DATA",
          "Imported page content differs from its manifest.",
        );
      const closure = await this.dependencies(document, projectId, current);
      const reader = await this.readerAt(path, current);
      return {
        document,
        components: closure.components,
        hash: documentHash(document),
        path: join(this.library.workspace, path),
        revision: snapshot.sourceRevision,
        sourceRevision: current,
        ...(reader ? { reader: reader.ref } : {}),
      };
    });
  }
  async importedHtml(
    projectId: string,
    pageId: string,
    ref: { importId: string; snapshotId: string },
  ) {
    const page = await this.importedPage(projectId, pageId, ref),
      reader = await this.readerAt(
        page.path
          .slice(this.library.workspace.length + 1)
          .split(/[\\/]/)
          .join("/"),
        page.sourceRevision,
      );
    if (!reader)
      throw new CoreError(
        "NOT_FOUND",
        "The imported snapshot reader is unavailable.",
      );
    return {
      html: injectArtifactIntoHtml(reader.html, page.document, page.components),
      reader: reader.ref,
      revision: page.sourceRevision,
    };
  }
  async restoreImportedSnapshot(input: {
    projectId: string;
    pageId: string;
    importId: string;
    snapshotId: string;
    baseRevision: string | null;
  }) {
    const snapshot = await this.importedPage(
      input.projectId,
      input.pageId,
      input,
    );
    return this.restorePage({
      ...input,
      revision: snapshot.sourceRevision,
      importedSnapshot: {
        importId: input.importId,
        snapshotId: input.snapshotId,
      },
    });
  }

  async previewMerge(input: {
    projectId: string;
    pageId: string;
    baseRevision: string;
    document: ShowDocument;
  }) {
    const current = await this.store.readPage(
      this.project(input.projectId)!,
      input.pageId,
    );
    const baseline =
      current.revision === input.baseRevision
        ? current.document
        : ((await new EditorDrafts(this.home).baseline(
            input.projectId,
            input.pageId,
            input.baseRevision,
          )) ??
          (await new ReadBaselines(this.home).read(
            input.projectId,
            input.pageId,
            input.baseRevision,
          )));
    if (!baseline)
      throw new CoreError(
        "CONFLICT",
        "合并基线不可用。当前内容和尝试稿均已保留，请逐项比较后保存。",
      );
    const draft = validateDocument(input.document);
    return {
      ...previewPageMerge(baseline, draft, current.document),
      baseDocument: baseline,
      currentDocument: current.document,
      baseRevision: input.baseRevision,
      currentRevision: current.revision,
      currentHash: current.hash,
    };
  }
  async saveMerge(input: {
    projectId: string;
    pageId: string;
    baseRevision: string;
    currentRevision: string;
    document: ShowDocument;
  }) {
    const context = {
      ...changeContext(),
      mergedFrom: input.baseRevision,
      message: changeContext().message ?? "Merge page changes",
    };
    return withChangeContext(context, () =>
      mutateLibrary(
        this.home,
        async () => {
          const current = await this.store.readPage(
            this.project(input.projectId)!,
            input.pageId,
          );
          if (current.revision !== input.currentRevision)
            throw new CoreError(
              "CONFLICT",
              "The page changed after the merge preview.",
              { currentRevision: current.revision },
            );
          const document = await lockDocumentComponents(
            this.home,
            validateDocument(input.document),
            input.projectId,
          );
          return this.store.savePage(
            input.projectId,
            input.pageId,
            document,
            current.hash,
            input.currentRevision,
          );
        },
        context,
      ),
    );
  }
  /** External edits recorded so far; saves record them before writing a file. */
  async conflicts(projectId?: string) {
    const project = this.project(projectId);
    return (await new WorkspaceProtection(this.library).list()).filter(
      (item) =>
        item.state === "unresolved" &&
        (!project || item.path.startsWith(`projects/${project}/`)),
    );
  }
  /** Compares one project's pages and packages with the workspace on request. */
  async scanConflicts(projectId: string) {
    await scanWorkspaceResources(this.library, this.project(projectId)!);
    return this.conflicts(projectId);
  }
  recoverPackage(input: {
    id: string;
    clientId: string;
    targetProjectId?: string;
  }) {
    if (input.targetProjectId) this.project(input.targetProjectId);
    return recoverExternalPackage(this.library, {
      ...input,
      boundProject: this.boundProject,
    });
  }
  async conflict(id: string) {
    const item = await new WorkspaceProtection(this.library).input(id);
    this.path(item.conflict.path);
    return this.library.readSnapshot(async (revision) => {
      const tree = revision ? await this.library.tree(revision) : [];
      const current =
        revision && tree.some((entry) => entry.path === item.conflict.path)
          ? await this.library.readFile(item.conflict.path, revision)
          : null;
      const baseline = item.conflict.baseRevision
        ? await this.library
            .readFile(item.conflict.path, item.conflict.baseRevision)
            .catch((error) => {
              if (error instanceof CoreError && error.code === "NOT_FOUND")
                return null;
              throw error;
            })
        : null;
      return {
        ...item.conflict,
        currentRevision: revision,
        current: current?.toString("utf8") ?? null,
        baseline: baseline?.toString("utf8") ?? null,
        external: item.bytes?.toString("utf8") ?? null,
      };
    });
  }
  async resolveConflict(input: {
    id: string;
    resolution: "discard" | "import" | "merge";
    document?: ShowDocument;
  }) {
    const detail = await this.conflict(input.id),
      match = detail.path.match(/^projects\/([^/]+)\/pages\/([^/]+)\.json$/);
    if (input.resolution !== "discard" && !match)
      throw new CoreError(
        "INVALID_DATA",
        "External package edits must be recovered as an editable package draft, then saved as a new version.",
      );
    const context = {
      ...changeContext(),
      message: changeContext().message ?? "Resolve external file conflict",
    };
    const resolved = await this.library.resolveWorkspaceConflict(
      input.id,
      input.resolution,
      context,
      async (bytes) => {
        const current = await this.store.readPage(
          this.project(match![1])!,
          match![2],
        );
        if (!bytes && !input.document)
          throw new CoreError(
            "INVALID_DATA",
            "An external deletion requires an explicit resolution document.",
          );
        const document =
          input.document ??
          normalizeDocument(
            parseArtifact(JSON.parse(bytes!.toString("utf8"))).document,
          );
        return this.store.savePage(
          match![1],
          match![2],
          await lockDocumentComponents(
            this.home,
            validateDocument(document),
            match![1],
          ),
          current.hash,
          current.revision,
        );
      },
    );
    if (match) return this.store.readPage(match[1], match[2]);
    return resolved.conflict;
  }
  async describePath(path: string, sourceRevision: string) {
    this.path(path);
    revision(sourceRevision);
    const bytes = await this.library.readFile(path, sourceRevision);
    return {
      path,
      revision: sourceRevision,
      content: bytes.toString("utf8"),
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  }
}
