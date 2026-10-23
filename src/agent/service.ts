import { CatalogService, type CatalogSelection } from "./catalog-service";
export type { CatalogSelection } from "./catalog-service";
import { blocksDocument } from "./page-authoring";
import { CapacityError } from "../portable/capacity.mjs";
import { PluginInstallError } from "../plugin/plugin-errors";
import { ReadBaselines } from "../core/read-baselines";
import { readBoard, type BoardReadInput } from "./board-reading";
import { EditorDrafts } from "../core/editor-drafts";
import { placeTemplate } from "../surface/document.mjs";
import { upgradeResource } from "../surface/containers.mjs";
import { FileStore } from "../core/store";
import { canonicalJson } from "../core/diff";
import { createHash } from "node:crypto";
import { mutateLibrary } from "../core/library-runtime";
import {
  changeContext,
  withChangeContext,
  legacyMutations,
  libraryMutations,
} from "../core/history-context";
import { openLibrary } from "../core/open-library";
import {
  agentAuthored,
  agentLabel,
  markAgentCreated,
} from "../core/agent-created";
import {
  LibraryOperations,
  type HistoryQuery,
} from "../core/library-operations";
import type { SearchOptions } from "../core/library-index";
import { CoreError } from "../core/model";
import {
  readTemplateDirectory,
  writeTemplateDirectory,
} from "../core/template-bundle-files";
import { type TemplateStage } from "../portable/template-bundle.mjs";
import {
  templateContext as readTemplateContext,
  templateGuide as readTemplateGuide,
  type TemplateSelection,
} from "./template-workflow";
import { preserveRemoteSave } from "../core/remote-save-conflict";
import { projectDirectory } from "../core/project-directory";
import type {
  ApplyPageInput,
  ProjectBinding,
  ShowDocument,
} from "../core/model";
import type {
  CatalogScope,
  CompiledComponent,
  ComponentSource,
  EditablePackage,
  PackageMergeInput,
  PackageRevisionRef,
  SaveTemplateInput,
} from "../components/custom/types";
import { exportPage, type ExportFormat } from "./exporter";
import {
  importCompiledComponents,
  lockDocumentComponents,
  getTemplate,
  importComponent,
  instantiateTemplateRecord,
  saveComponent,
  saveTemplate,
  promotePackage,
  forkPackage,
  previewPackageMerge,
  savePackageMerge,
} from "../core/catalog";
import {
  preparePublication,
  verifyPublication,
  listPublications,
  loadRemoteComponents,
  type PublishedComponentLocator,
} from "../core/publication";
import { pageOf, shellToken, summarizeCatalog } from "./disclosure";

import { getGuide } from "./guides";
import { DatasetService } from "./dataset-service";
import {
  readPageView,
  type PageReadOptions,
  type PageReadResult,
  type StructuredRead,
} from "./page-reading";

const projectSummary = (project: {
  id: string;
  name: string;
  pageCount: number;
  binding?: ProjectBinding;
  sourceDirectory?: string;
  icon?: string;
  pinned?: boolean;
  archived?: boolean;
}) => ({
  id: project.id,
  name: project.name,
  pageCount: project.pageCount,
  icon: project.icon,
  pinned: !!project.pinned,
  archived: !!project.archived,
  ...(project.binding ? { binding: project.binding } : {}),
  ...(project.sourceDirectory
    ? { sourceDirectory: project.sourceDirectory }
    : {}),
});

function rebindImportedComponents(
  document: ShowDocument,
  components: CompiledComponent[],
): ShowDocument {
  if (!components.length) return document;
  const copy = structuredClone(document);
  const packages = new Map(
    components.map((component) => [
      `${component.id}@${component.version}`,
      component,
    ]),
  );
  const visit = (node: typeof copy.content) => {
    if (node.type === "widget" && node.attrs?.kind === "custom") {
      const data = node.attrs.data;
      const component = packages.get(`${data?.componentId}@${data?.version}`);
      if (component) {
        if (data.integrity && data.integrity !== component.integrity)
          throw new CoreError(
            "INVALID_DATA",
            "The imported component does not match the page's pinned integrity.",
          );
        node.attrs.data = {
          ...data,
          scope: "project",
          integrity: component.integrity,
        };
      }
    }
    node.content?.forEach(visit);
  };
  visit(copy.content);
  return copy;
}

/** CLI and MCP share operations; project-bound connections cannot mutate shared libraries. */
/**
 * Build a new Page from catalog components without a nested document tree:
 * each block goes through the same component.insert path as page_apply.
 * The store assigns the real id, title and timestamps on creation.
 */

export class AgentService extends CatalogService {
  declare readonly store: FileStore;
  readonly datasets: DatasetService;
  constructor(options: { root?: string; projectId?: string } = {}) {
    super(new FileStore(options.root), options.projectId);
    this.datasets = new DatasetService(this.store);
  }

  guide(topic?: string) {
    return getGuide(topic);
  }

  datasetList(projectId: string) {
    return this.datasets.list(this.requireProject(projectId));
  }
  datasetRead(
    projectId: string,
    datasetId: string,
    options: { path?: unknown } = {},
  ) {
    return this.datasets.read(
      this.requireProject(projectId),
      datasetId,
      options,
    );
  }
  datasetReferences(projectId: string, datasetId: string) {
    return this.datasets.references(this.requireProject(projectId), datasetId);
  }
  datasetCreate(
    projectId: string,
    input: Parameters<DatasetService["create"]>[1],
  ) {
    return this.mutation("Create dataset", [projectId, input], () =>
      this.datasets.create(this.requireProject(projectId), input),
    );
  }
  datasetApply(
    projectId: string,
    datasetId: string,
    input: Parameters<DatasetService["apply"]>[2],
  ) {
    return this.mutation(
      "Apply dataset changes",
      [projectId, datasetId, input],
      () =>
        this.datasets.apply(this.requireProject(projectId), datasetId, input),
    );
  }
  datasetLink(projectId: string, input: Parameters<DatasetService["link"]>[1]) {
    return this.mutation("Link dataset file", [projectId, input], () =>
      this.datasets.link(this.requireProject(projectId), input),
    );
  }
  datasetEmbed(projectId: string, datasetId: string, baseHash?: string) {
    return this.mutation(
      "Copy dataset into library",
      [projectId, datasetId, baseHash],
      () =>
        this.datasets.embed(
          this.requireProject(projectId),
          datasetId,
          baseHash,
        ),
    );
  }
  datasetDelete(projectId: string, datasetId: string, baseHash: string) {
    return this.mutation(
      "Delete dataset",
      [projectId, datasetId, baseHash],
      () =>
        this.datasets.remove(
          this.requireProject(projectId),
          datasetId,
          baseHash,
        ),
    );
  }

  private requireSharedWrite(operation: string) {
    if (this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        `${operation} changes a shared library and is unavailable on a project-bound connection. Use an explicit CLI or desktop action.`,
      );
  }
  private assertReference(ref: PackageRevisionRef) {
    if (
      !ref ||
      !["component", "template"].includes(ref.kind) ||
      !ref.id ||
      !ref.version ||
      !ref.integrity
    )
      throw new CoreError(
        "INVALID_DATA",
        "An exact package ref needs kind, id, version and integrity. Obtain it from catalog list/describe.",
      );
    if (this.projectId && ref.projectId && ref.projectId !== this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        "A project-bound connection cannot use another project's revision for a catalog mutation.",
      );
  }
  async listProjects(includeArchived = false) {
    const projects = await this.store.listProjects({ includeArchived });
    return projects
      .filter((project) => !this.projectId || project.id === this.projectId)
      .map(projectSummary);
  }
  private async currentProjectImpl(
    input: { projectId?: string; sourceDirectory?: string } = {},
  ) {
    const explicit = input.projectId ?? this.projectId;
    const directory = explicit
      ? undefined
      : await projectDirectory(input.sourceDirectory);
    const resolved = explicit
      ? {
          project: (await this.store.listProjects()).find(
            (project) => project.id === this.requireProject(explicit),
          ),
          created: false,
        }
      : await this.store.resolveDirectoryProject(directory!);
    const project = resolved.project;
    if (!project)
      throw new CoreError("NOT_FOUND", `Project not found: ${explicit}`);
    return {
      bound: true,
      created: resolved.created,
      resolution: explicit ? "explicit" : "directory",
      home: this.store.root,
      ...(directory ? { sourceDirectory: directory } : {}),
      project: projectSummary(project),
      componentCatalog: await this.componentContext(project.id),
      next: `showai pages list --project ${shellToken(project.id)} --json`,
    };
  }
  private async createProjectImpl(
    name: string,
    binding?: ProjectBinding,
    icon?: string,
  ) {
    if (this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        "A project-bound connection cannot create or switch projects.",
      );
    return projectSummary(
      await this.store.createProject({ name, binding, icon }),
    );
  }
  private async bindProjectImpl(projectId: string, binding: ProjectBinding) {
    return projectSummary(
      await this.store.bindProject(this.requireProject(projectId), binding),
    );
  }

  async templateContext(
    projectId: string,
    selections: TemplateSelection[] = [],
    knownHash?: string,
    componentOffset?: number,
    componentLimit?: number,
    knownSystemHash?: string,
  ) {
    const project = this.requireProject(projectId);
    await this.store.readProject(project);
    return readTemplateContext(
      this.store.root,
      project,
      selections,
      knownHash,
      componentOffset,
      componentLimit,
      knownSystemHash,
    );
  }
  async templateGuide(
    projectId: string,
    stage: TemplateStage,
    selections: TemplateSelection[] = [],
    knownHash?: string,
    file?: string,
    templateId?: string,
  ) {
    const project = this.requireProject(projectId);
    await this.store.readProject(project);
    return readTemplateGuide(
      this.store.root,
      project,
      stage,
      selections,
      knownHash,
      file,
      templateId,
    );
  }
  async importTemplate(projectId: string, directory: string) {
    return this.saveTemplate(projectId, undefined, {
      bundle: await readTemplateDirectory(directory),
    });
  }
  async exportTemplate(
    projectId: string,
    id: string,
    directory: string,
    options: CatalogSelection = {},
  ) {
    const project = this.requireProject(projectId);
    await this.store.readProject(project);
    const { assertExportDestination } = await import("./exporter");
    await assertExportDestination(this.store.root, project, directory);
    const template = await getTemplate(this.store.root, id, project, options);
    if (!template.bundle)
      throw new Error(
        "This legacy template has no folder bundle. Read its source or migrate it before directory export.",
      );
    return {
      ...(await writeTemplateDirectory(directory, template.bundle)),
      ref: {
        kind: "template",
        id: template.id,
        version: template.version,
        integrity: template.integrity,
        scope: template.scope,
      },
    };
  }
  private async importComponentImpl(directory: string, projectId: string) {
    const project = this.requireProject(projectId);
    await this.store.listPages(project);
    return summarizeCatalog(
      "component",
      await importComponent(this.store.root, directory, project),
      project,
    );
  }
  private async saveComponentImpl(projectId: string, source: ComponentSource) {
    const project = this.requireProject(projectId);
    await this.store.listPages(project);
    source.parents?.forEach((ref) => this.assertReference(ref));
    if (source.mergeBase) this.assertReference(source.mergeBase);
    return summarizeCatalog(
      "component",
      await saveComponent(this.store.root, source, project),
      project,
    );
  }
  private async applyTemplateImpl(
    projectId: string,
    templateId: string,
    title?: string,
    options: {
      scope?: CatalogScope;
      version?: string;
      integrity?: string;
      pageId?: string;
      baseHash?: string;
      baseRevision?: string;
      parentId?: string;
      templates?: TemplateSelection[];
    } = {},
  ) {
    const project = this.requireProject(projectId);
    const template = await getTemplate(
      this.store.root,
      templateId,
      project,
      options,
    );
    const document = await instantiateTemplateRecord(
      this.store.root,
      template,
      project,
    );
    const active = await this.templateContext(project, [
      ...(options.templates ?? []),
      {
        id: template.id,
        version: template.version,
        integrity: template.integrity,
        scope: template.scope,
      },
    ]);
    const { format, system, templates } = active.context;
    document.templateContext = { format, system, templates };
    if (title !== undefined) document.title = title;
    if (options.pageId) {
      if (!options.baseHash)
        throw new Error(
          "Inserting a template requires the destination page base hash.",
        );
      const target = await this.store.readPage(project, options.pageId);
      const previous = target.document.templateContext?.templates ?? [];
      const combined = await this.templateContext(project, [
        ...previous,
        ...templates,
      ]);
      const inserted = placeTemplate(
        target.document,
        document,
        options.parentId,
      );
      inserted.templateContext = {
        format: 1,
        system: combined.context.system,
        templates: combined.context.templates,
      };
      return this.store.savePage(
        project,
        options.pageId,
        inserted,
        options.baseHash,
        options.baseRevision,
      );
    }
    return this.store.createPage(project, {
      document: upgradeResource(document),
    });
  }
  private async saveTemplateImpl(
    projectId: string,
    pageId: string | undefined,
    input: SaveTemplateInput,
  ) {
    const project = this.requireProject(projectId);
    await this.store.listPages(project);
    if (pageId && (input.document || input.composition || input.bundle))
      throw new CoreError(
        "INVALID_DATA",
        "Choose --page or an input document/composition, not both.",
      );
    input.parents?.forEach((ref) => this.assertReference(ref));
    if (input.mergeBase) this.assertReference(input.mergeBase);
    input.composition?.forEach((part) => {
      if (
        part.type === "template" &&
        this.projectId &&
        part.ref.projectId &&
        part.ref.projectId !== this.projectId &&
        (!part.ref.scope || part.ref.scope === "project")
      )
        throw new CoreError(
          "INVALID_PATH",
          "A bound connection cannot compose another project's private template.",
        );
    });
    const document = pageId
      ? (await this.store.readPage(project, pageId)).document
      : input.document;
    const template = await saveTemplate(
      this.store.root,
      { ...input, ...(document ? { document } : {}) },
      project,
    );
    return summarizeCatalog("template", template, project);
  }

  private async promoteImpl(
    projectId: string,
    ref: PackageRevisionRef,
    target: "global",
  ) {
    this.requireSharedWrite("Global promotion");
    const project = this.requireProject(projectId);
    this.assertReference(ref);
    if (target !== "global")
      throw new CoreError(
        "INVALID_DATA",
        "Promotion requires an explicit --to global.",
      );
    const bundle = await promotePackage(this.store.root, ref, {
      projectId: project,
      target,
    });
    return {
      status: "promoted",
      ref: bundle.root,
      components: bundle.components.length,
      templates: bundle.templates.length,
      next: "showai guide publish --json",
    };
  }
  private async forkImpl(
    projectId: string,
    ref: PackageRevisionRef,
    options: { id?: string; version: string; name?: string },
  ) {
    const project = this.requireProject(projectId);
    this.assertReference(ref);
    const record = await forkPackage(this.store.root, ref, {
      ...options,
      projectId: project,
    });
    return summarizeCatalog(ref.kind, record, project);
  }
  async previewMerge(
    projectId: string,
    input: Omit<PackageMergeInput, "projectId">,
  ) {
    const project = this.requireProject(projectId);
    [input.base, input.ours, input.theirs].forEach((ref) =>
      this.assertReference(ref),
    );
    return previewPackageMerge(this.store.root, {
      ...input,
      projectId: project,
    });
  }
  private async resolveMergeImpl(
    projectId: string,
    input: Omit<PackageMergeInput, "projectId"> & {
      id?: string;
      version: string;
      resolved: EditablePackage;
    },
  ) {
    const project = this.requireProject(projectId);
    [input.base, input.ours, input.theirs].forEach((ref) =>
      this.assertReference(ref),
    );
    const record = await savePackageMerge(this.store.root, {
      ...input,
      projectId: project,
    });
    return summarizeCatalog(input.ours.kind, record, project);
  }
  async preparePublication(
    projectId: string,
    input: { refs: PackageRevisionRef[]; out: string },
  ) {
    const project = this.requireProject(projectId);
    input.refs.forEach((ref) => this.assertReference(ref));
    const prepared = await preparePublication(this.store.root, {
      ...input,
      projectId: project,
    });
    return {
      status: prepared.status,
      path: prepared.path,
      manifestPath: prepared.manifestPath,
      bytes: prepared.bytes,
      next: "Upload the prepared directory only when requested; then run showai publish verify --project PROJECT --url MANIFEST_URL.",
    };
  }
  private async verifyPublicationImpl(projectId: string, manifestUrl: string) {
    this.requireSharedWrite("Published-library registration");
    const project = this.requireProject(projectId);
    const verified = await verifyPublication(this.store.root, {
      manifestUrl,
      projectId: project,
    });
    return {
      status: verified.status,
      manifestUrl: verified.manifestUrl,
      manifestIntegrity: verified.manifestIntegrity,
      releaseId: verified.releaseId,
      verifiedAt: verified.verifiedAt,
      componentCount: verified.components.length,
      next: "showai guide export --json",
    };
  }
  async publications(input: { limit?: number; cursor?: string } = {}) {
    const entries = await listPublications(this.store.root);
    return pageOf(
      entries.map((entry) => ({
        releaseId: entry.releaseId,
        manifestUrl: entry.manifestUrl,
        manifestIntegrity: entry.manifestIntegrity,
        verifiedAt: entry.verifiedAt,
        componentCount: entry.components.length,
      })),
      input,
    );
  }

  async listPages(projectId: string) {
    return this.store.listPages(this.requireProject(projectId));
  }
  private async createPageImpl(
    projectId: string,
    input: {
      title?: string;
      kind?: "page" | "board";
      parentId?: string | null;
      document?: ShowDocument;
      /** Shallow alternative to document: catalog components in reading order. */
      blocks?: { kind: string; data: Record<string, unknown> }[];
      components?: CompiledComponent[];
      remoteComponents?: PublishedComponentLocator[];
    },
  ) {
    const project = this.requireProject(projectId);
    if (input.blocks?.length && input.document)
      throw new CoreError(
        "INVALID_DATA",
        "Pass either document or blocks when creating a page, not both.",
      );
    await this.store.listPages(project);
    const components = [
      ...(input.components ?? []),
      ...(input.remoteComponents?.length
        ? await loadRemoteComponents(input.remoteComponents)
        : []),
    ];
    if (components.length)
      await importCompiledComponents(this.store.root, components, project);
    const source = input.blocks?.length
      ? blocksDocument(input.blocks, input.title, input.kind)
      : input.document;
    const document = source
      ? await lockDocumentComponents(
          this.store.root,
          rebindImportedComponents(source, components),
          project,
        )
      : undefined;
    return this.store.createPage(project, { ...input, document });
  }
  async readBoard(
    projectId: string,
    pageId: string,
    options: BoardReadInput = {},
  ) {
    const project = this.requireProject(projectId);
    const record = await this.store.readPage(project, pageId);
    await new ReadBaselines(this.store.root).remember(project, record);
    return readBoard(this.store, project, pageId, options);
  }
  readPage(projectId: string, pageId: string): Promise<StructuredRead>;
  readPage(
    projectId: string,
    pageId: string,
    options: PageReadOptions,
  ): Promise<PageReadResult>;
  async readPage(
    projectId: string,
    pageId: string,
    options: PageReadOptions = {},
  ) {
    const project = this.requireProject(projectId);
    const record = await this.store.readPage(project, pageId);
    await new ReadBaselines(this.store.root).remember(project, record);
    return readPageView(this.store, project, pageId, options);
  }
  private async savePageImpl(
    projectId: string,
    pageId: string,
    document: ShowDocument,
    baseHash: string,
    components?: CompiledComponent[],
    remoteComponents?: PublishedComponentLocator[],
    baseRevision?: string,
  ) {
    const project = this.requireProject(projectId);
    const current = await this.store.readPage(project, pageId);
    const imported = [
      ...(components ?? []),
      ...(remoteComponents?.length
        ? await loadRemoteComponents(remoteComponents)
        : []),
    ];
    if (imported.length)
      await importCompiledComponents(this.store.root, imported, project);
    document = await lockDocumentComponents(
      this.store.root,
      rebindImportedComponents(document, imported),
      project,
    );
    this.datasets.assertBoundBlocks(document);
    if (
      current.hash !== baseHash ||
      (baseRevision && current.revision !== baseRevision)
    ) {
      const preserved = await preserveRemoteSave(
        this.store.root,
        project,
        current,
        document,
        baseHash,
        baseRevision,
      );
      if (preserved) return preserved;
      throw new CoreError(
        "CONFLICT",
        "保存失败：同一设备上的页面已有新修改。请比较并处理后重新保存，或放弃修改。",
        { currentHash: current.hash, currentRevision: current.revision },
      );
    }
    return this.store.savePage(
      this.requireProject(projectId),
      pageId,
      document,
      baseHash,
      baseRevision,
    );
  }
  private async applyPageImpl(
    projectId: string,
    pageId: string,
    input: ApplyPageInput,
  ) {
    const project = this.requireProject(projectId);
    const current = await this.store.readPage(project, pageId);
    if (current.hash !== input.baseHash) {
      if (input.baseRevision) {
        const baselineDocument =
          (await new EditorDrafts(this.store.root).baseline(
            project,
            pageId,
            input.baseRevision,
          )) ??
          (await new ReadBaselines(this.store.root).read(
            project,
            pageId,
            input.baseRevision,
          ));
        if (!baselineDocument)
          throw new CoreError(
            "CONFLICT",
            "页面已有新修改，当前内容和尝试的操作已保留。请重新读取并明确处理。",
          );
        const routed = await this.datasets.applyPageOperations(
          project,
          baselineDocument,
          input.operations,
          input.datasetBases,
        );
        const document = await lockDocumentComponents(
          this.store.root,
          routed.document,
          project,
        );
        const preserved = await preserveRemoteSave(
          this.store.root,
          project,
          current,
          document,
          input.baseHash,
          input.baseRevision,
        );
        if (preserved) {
          await routed.commit();
          return preserved;
        }
      }
      throw new CoreError(
        "CONFLICT",
        "保存失败：同一设备上的页面已有新修改。请比较并处理后重新保存，或放弃修改。",
        { currentHash: current.hash, currentRevision: current.revision },
      );
    }
    const routed = await this.datasets.applyPageOperations(
      project,
      current.document,
      input.operations,
      input.datasetBases,
    );
    const document = await lockDocumentComponents(
      this.store.root,
      routed.document,
      project,
    );
    this.datasets.assertBoundBlocks(document);
    const saved = await this.store.savePage(
      project,
      pageId,
      document,
      input.baseHash,
      input.baseRevision,
    );
    // The same library transaction commits the page and its dataset writes.
    await routed.commit();
    return saved;
  }
  async diffPage(projectId: string, pageId: string, sinceHash: string) {
    return this.store.diffPage(
      this.requireProject(projectId),
      pageId,
      sinceHash,
    );
  }
  async export(input: {
    projectId: string;
    pageId?: string;
    blockIds?: string[];
    format: ExportFormat;
    out: string;
    overwrite?: boolean;
    components?: "bundled" | "remote";
    presentation?: "spatial" | "reading";
    reader?: "bundled" | "cdn";
    revision?: string;
    importedSnapshot?: { importId: string; snapshotId: string };
    externalData?: "embed";
  }) {
    return exportPage({
      root: this.store.root,
      ...input,
      projectId: this.requireProject(input.projectId),
    });
  }
  private versioned() {
    return new LibraryOperations(this.store.root, this.projectId);
  }
  async historicalResource(path: string, revision: string) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    return this.versioned().describePath(path, revision);
  }
  importedSnapshots(projectId: string, pageId?: string) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    return this.versioned().importedSnapshots(
      this.requireProject(projectId),
      pageId,
    );
  }
  importedPage(
    projectId: string,
    pageId: string,
    ref: { importId: string; snapshotId: string },
  ) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    return this.versioned().importedPage(
      this.requireProject(projectId),
      pageId,
      ref,
    );
  }
  restoreImportedSnapshot(input: {
    projectId: string;
    pageId: string;
    importId: string;
    snapshotId: string;
    baseRevision: string | null;
  }) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    this.requireProject(input.projectId);
    return this.mutation("Restore imported snapshot", [input], () =>
      this.versioned().restoreImportedSnapshot(input),
    );
  }
  history(input: HistoryQuery = {}) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    return this.versioned().history(input);
  }
  search(input: SearchOptions) {
    return this.versioned().search(input);
  }
  compareHistory(
    before: string,
    after: string,
    input: { projectId?: string; pageId?: string } = {},
  ) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    return this.versioned().changes(before, after, input);
  }
  historicalPage(projectId: string, pageId: string, revision: string) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    return this.versioned().pageAt(
      this.requireProject(projectId),
      pageId,
      revision,
    );
  }
  historicalHtml(projectId: string, pageId: string, revision: string) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    return this.versioned().historicalHtml(
      this.requireProject(projectId),
      pageId,
      revision,
    );
  }
  importedHtml(
    projectId: string,
    pageId: string,
    ref: { importId: string; snapshotId: string },
  ) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    return this.versioned().importedHtml(
      this.requireProject(projectId),
      pageId,
      ref,
    );
  }
  restorePage(input: {
    projectId: string;
    pageId: string;
    revision: string;
    baseRevision: string;
  }) {
    throw new CoreError(
      "INVALID_DATA",
      "Content history and version restoration have been removed.",
    );
    this.requireProject(input.projectId);
    return withChangeContext(
      { ...changeContext(), restoredFrom: input.revision },
      () =>
        this.mutation("Restore page", [input], () =>
          this.versioned().restorePage(input),
        ),
    );
  }
  pageMergePreview(input: {
    projectId: string;
    pageId: string;
    baseRevision: string;
    document: ShowDocument;
  }) {
    this.requireProject(input.projectId);
    return this.versioned().previewMerge(input);
  }
  pageMergeSave(input: {
    projectId: string;
    pageId: string;
    baseRevision: string;
    currentRevision: string;
    document: ShowDocument;
  }) {
    this.requireProject(input.projectId);
    return withChangeContext(
      { ...changeContext(), mergedFrom: input.baseRevision },
      () =>
        this.mutation("Merge page", [input], () =>
          this.versioned().saveMerge(input),
        ),
    );
  }
  workspaceConflicts(projectId?: string) {
    return this.versioned().conflicts(projectId);
  }
  workspaceConflict(id: string) {
    return this.versioned().conflict(id);
  }
  recoverPackageConflict(input: {
    id: string;
    clientId: string;
    targetProjectId?: string;
  }) {
    if (input.targetProjectId) this.requireProject(input.targetProjectId);
    return this.versioned().recoverPackage(input);
  }
  resolveWorkspaceConflict(input: {
    id: string;
    resolution: "discard" | "import" | "merge";
    document?: ShowDocument;
  }) {
    return this.versioned().resolveConflict(input);
  }

  private async mutation<T>(
    name: string,
    args: unknown[],
    operation: () => Promise<T>,
  ): Promise<T> {
    if (
      legacyMutations.getStore() !== this.store.root &&
      libraryMutations.getStore()?.root !== this.store.root
    )
      await openLibrary(this.store.root);
    const context = changeContext();
    const requestFingerprint =
      context.requestFingerprint ??
      createHash("sha256")
        .update(
          canonicalJson({
            name,
            args,
            actor: context.actor,
            channel: context.channel,
            message: context.message,
            groupId: context.groupId,
          }),
        )
        .digest("hex");
    try {
      return await mutateLibrary(this.store.root, operation, {
        ...context,
        requestFingerprint,
        message: context.message ?? name,
      });
    } catch (error) {
      if (error instanceof CoreError && error.code === "CONFLICT") {
        error.saveFailed = true;
        error.recovery = { action: "read-compare-save" };
        if (["Edit page", "Apply page changes"].includes(name)) {
          error.recovery.projectId =
            typeof args[0] === "string" ? args[0] : undefined;
          error.recovery.pageId =
            typeof args[1] === "string" ? args[1] : undefined;
          const input = args[2];
          error.recovery.baseRevision =
            input &&
            typeof input === "object" &&
            "baseRevision" in input &&
            typeof input.baseRevision === "string"
              ? input.baseRevision
              : typeof args[6] === "string"
                ? args[6]
                : undefined;
        }
      }
      throw error;
    }
  }
  async currentProject(
    ...args: Parameters<AgentService["currentProjectImpl"]>
  ): ReturnType<AgentService["currentProjectImpl"]> {
    return this.mutation("Resolve directory project", args, () =>
      this.currentProjectImpl(...args),
    );
  }
  async createProject(
    ...args: Parameters<AgentService["createProjectImpl"]>
  ): ReturnType<AgentService["createProjectImpl"]> {
    return this.mutation("Create project", args, () =>
      this.createProjectImpl(...args),
    );
  }
  async bindProject(
    ...args: Parameters<AgentService["bindProjectImpl"]>
  ): ReturnType<AgentService["bindProjectImpl"]> {
    return this.mutation("Bind project session", args, () =>
      this.bindProjectImpl(...args),
    );
  }
  async importComponent(
    ...args: Parameters<AgentService["importComponentImpl"]>
  ): ReturnType<AgentService["importComponentImpl"]> {
    return this.mutation("Import component", args, () =>
      this.importComponentImpl(...args),
    );
  }
  async saveComponent(
    ...args: Parameters<AgentService["saveComponentImpl"]>
  ): ReturnType<AgentService["saveComponentImpl"]> {
    return this.mutation("Save component version", args, () =>
      this.saveComponentImpl(...args),
    );
  }
  async applyTemplate(
    ...args: Parameters<AgentService["applyTemplateImpl"]>
  ): ReturnType<AgentService["applyTemplateImpl"]> {
    return this.mutation("Apply template", args, () =>
      this.applyTemplateImpl(...args),
    );
  }
  async saveTemplate(
    ...args: Parameters<AgentService["saveTemplateImpl"]>
  ): ReturnType<AgentService["saveTemplateImpl"]> {
    return this.mutation("Save template version", args, () =>
      this.saveTemplateImpl(...args),
    );
  }
  async promote(
    ...args: Parameters<AgentService["promoteImpl"]>
  ): ReturnType<AgentService["promoteImpl"]> {
    return this.mutation("Register global package", args, () =>
      this.promoteImpl(...args),
    );
  }
  async fork(
    ...args: Parameters<AgentService["forkImpl"]>
  ): ReturnType<AgentService["forkImpl"]> {
    return this.mutation("Fork package", args, () => this.forkImpl(...args));
  }
  async resolveMerge(
    ...args: Parameters<AgentService["resolveMergeImpl"]>
  ): ReturnType<AgentService["resolveMergeImpl"]> {
    return this.mutation("Merge package changes", args, () =>
      this.resolveMergeImpl(...args),
    );
  }
  async verifyPublication(
    ...args: Parameters<AgentService["verifyPublicationImpl"]>
  ): ReturnType<AgentService["verifyPublicationImpl"]> {
    return this.mutation("Verify publication", args, () =>
      this.verifyPublicationImpl(...args),
    );
  }
  async createPage(
    ...args: Parameters<AgentService["createPageImpl"]>
  ): ReturnType<AgentService["createPageImpl"]> {
    return this.mutation("Create page", args, async () => {
      const created = await this.createPageImpl(...args);
      // Marked inside the mutation so the workbench sees it with the change
      // notification; a rolled-back page leaves a mark nothing lists.
      const context = changeContext();
      if (agentAuthored(context))
        await markAgentCreated(
          this.store.root,
          this.requireProject(args[0]),
          created.document.id,
          { label: agentLabel(context), at: new Date().toISOString() },
        );
      return created;
    });
  }
  async savePage(
    ...args: Parameters<AgentService["savePageImpl"]>
  ): ReturnType<AgentService["savePageImpl"]> {
    return this.mutation("Edit page", args, () => this.savePageImpl(...args));
  }
  async applyPage(
    ...args: Parameters<AgentService["applyPageImpl"]>
  ): ReturnType<AgentService["applyPageImpl"]> {
    return this.mutation("Apply page changes", args, () =>
      this.applyPageImpl(...args),
    );
  }
}

/**
 * What an Agent does next for common codes (tool names, not CLI flags) and one
 * sentence it can relay to the person. Agent-facing text is English; the Agent
 * relays it in the person's language.
 */
const AGENT_GUIDANCE: Record<string, { nextStep: string; userMessage: string }> =
  {
    CONFLICT: {
      nextStep:
        "Re-read the current version (page_read, dataset_read or the matching read tool), apply your change to it and retry with the new baseHash/baseRevision. Never resend the unchanged request.",
      userMessage:
        "The content changed after it was read, so ShowAI did not overwrite it. Nothing was lost.",
    },
    NOT_FOUND: {
      nextStep:
        "List what exists (projects_list, pages_list or library_search) and retry with an ID from that result.",
      userMessage:
        "ShowAI could not find that project or page in the connected library.",
    },
    INVALID_DATA: {
      nextStep:
        "Correct the input described in message and call the same tool again; read guide for the expected format.",
      userMessage:
        "ShowAI rejected part of the request as invalid. Nothing was saved.",
    },
    INVALID_PATH: {
      nextStep:
        "Use an absolute path on this machine, or an ID returned by ShowAI tools, and call again.",
      userMessage: "ShowAI could not use the given file or folder path.",
    },
    LOCKED: {
      nextStep:
        "Another ShowAI operation holds the library. Wait a few seconds and retry the same call once.",
      userMessage:
        "ShowAI is finishing another operation on this library. Nothing was changed.",
    },
    SNAPSHOT_EXPIRED: {
      nextStep: "Read the page again to get a new snapshotId, then continue.",
      userMessage: "The page view ShowAI returned earlier has expired.",
    },
    MISSING_BASELINE: {
      nextStep:
        "Read the current version with page_read and compare it directly; the earlier baseline is no longer kept.",
      userMessage:
        "ShowAI no longer keeps the earlier version needed for this comparison.",
    },
    SOURCE_UNAVAILABLE: {
      nextStep:
        "Ask the user to make the linked file available on this device, or work with the stored copy.",
      userMessage:
        "A file linked to this data cannot be read on this device. The stored copy is unchanged.",
    },
    CONFIRMATION_REQUIRED: {
      nextStep:
        "Ask the user to decide as described in details, then call again with their decision.",
      userMessage: "ShowAI needs your decision before it continues.",
    },
    CAPACITY_EXCEEDED: {
      nextStep:
        "Reduce the content below the limit in message (split the page, link large files instead of embedding) and retry.",
      userMessage:
        "The content is larger than ShowAI allows for one save. Nothing was saved.",
    },
  };
const UNRECOVERABLE_GUIDANCE = {
  nextStep:
    "Tell the user which step failed with this code and message. Point them to showai_capabilities support (ShowAI Settings → About & feedback → Copy diagnostics, or reportUrl). Do not file a report for them or relay tokens or local paths.",
  userMessage: "ShowAI could not complete this step.",
};

export function errorResult(error: unknown) {
  const code =
    error instanceof CoreError ||
    error instanceof CapacityError ||
    error instanceof PluginInstallError
      ? error.code
      : "ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const system = systemErrorFacts(error);
  const guidance =
    error instanceof PluginInstallError
      ? undefined
      : (AGENT_GUIDANCE[code] ?? (code === "ERROR" ? UNRECOVERABLE_GUIDANCE : undefined));
  return {
    code,
    message,
    ...system,
    ...(guidance ?? {}),
    ...(error instanceof PluginInstallError && error.details
      ? { details: error.details }
      : {}),
    ...(error instanceof CapacityError
      ? {
          kind: error.kind,
          actualBytes: error.actualBytes,
          limitBytes: error.limitBytes,
        }
      : {}),
    ...(error instanceof CoreError && error.saveFailed
      ? {
          saveFailed: true,
          recovery: error.recovery,
          nextStep:
            "The save failed. Re-read the current resource, compare it with your change, resolve the conflict and save with the new baseHash/baseRevision, or abandon this change. Never resend the same overwrite.",
        }
      : {}),
    ...(error instanceof CoreError && error.conflictId
      ? { conflictId: error.conflictId }
      : {}),
    ...(error instanceof CoreError && error.currentRevision
      ? { currentRevision: error.currentRevision }
      : {}),
    ...(error instanceof CoreError && error.currentHash
      ? { currentHash: error.currentHash }
      : {}),
    ...(error instanceof CoreError && error.details
      ? { details: error.details }
      : {}),
    // Built-in Agent failures carry their classification across IPC.
    ...(error instanceof Error &&
    "problem" in error &&
    error.problem &&
    typeof error.problem === "object"
      ? { problem: error.problem }
      : {}),
  };
}

/**
 * Node system errors (ENOSPC, EACCES, EROFS, ENOENT…) keep their errno code,
 * syscall and path so the workbench can explain them; also read one wrapped
 * `cause`, which is how library writes rethrow file errors.
 */
function systemErrorFacts(
  error: unknown,
): { errno?: string; syscall?: string; path?: string } {
  for (const candidate of [
    error,
    error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined,
  ]) {
    if (!candidate || typeof candidate !== "object") continue;
    const { code, syscall, path } = candidate as Record<string, unknown>;
    if (typeof code !== "string" || !/^E[A-Z0-9]+$/.test(code)) continue;
    return {
      errno: code,
      ...(typeof syscall === "string" ? { syscall } : {}),
      ...(typeof path === "string" ? { path } : {}),
    };
  }
  return {};
}
