import { placeTemplate } from "../surface/document.mjs";
import { upgradeResource } from "../surface/containers.mjs";
import { FileStore } from "../core/store";
import { applyOperations, canonicalJson } from "../core/diff";
import { createHash } from "node:crypto";
import { mutateLibrary } from "../core/library-runtime";
import { changeContext } from "../core/history-context";
import { CoreError } from "../core/model";
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
  TemplateRecord,
} from "../components/custom/types";
import { exportPage, type ExportFormat } from "./exporter";
import {
  getComponent,
  describeBuiltinComponent,
  listBuiltinComponents,
  importCompiledComponents,
  lockDocumentComponents,
  getTemplate,
  importComponent,
  instantiateTemplateRecord,
  listComponents,
  listTemplates,
  readComponentSource,
  readBuiltinComponentSource,
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
import {
  describeCommand,
  catalogSearchText,
  pageOf,
  shellToken,
  summarizeCatalog,
  type CatalogKind,
  type CatalogView,
} from "./disclosure";
import { getGuide } from "./guides";
import {
  readPageView,
  type PageReadOptions,
  type PageReadResult,
  type StructuredRead,
} from "./page-reading";

export interface CatalogSelection {
  projectId?: string;
  kind?: CatalogKind;
  scope?: CatalogScope | "all";
  version?: string;
  integrity?: string;
  view?: CatalogView;
  file?: string;
}
const projectSummary = (project: {
  id: string;
  name: string;
  pageCount: number;
  binding?: ProjectBinding;
  sourceDirectory?: string;
}) => ({
  id: project.id,
  name: project.name,
  pageCount: project.pageCount,
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
export class AgentService {
  readonly store: FileStore;
  readonly projectId?: string;
  constructor(options: { root?: string; projectId?: string } = {}) {
    this.store = new FileStore(options.root);
    this.projectId = options.projectId;
  }

  guide(topic?: string) {
    return getGuide(topic);
  }
  requireProject(projectId?: string): string {
    if (!projectId)
      throw new CoreError(
        "INVALID_DATA",
        "A resolved projectId is required. Resolve the host directory with projects current, or specify --project.",
      );
    if (this.projectId && projectId !== this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        `This connection is bound to project ${this.projectId}.`,
      );
    return projectId;
  }
  private catalogProject(projectId?: string) {
    const selected = projectId ?? this.projectId;
    return selected ? this.requireProject(selected) : undefined;
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
  async listProjects() {
    const projects = await this.store.listProjects();
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
      next: `showai pages list --project ${shellToken(project.id)} --json`,
    };
  }
  private async createProjectImpl(name: string, binding?: ProjectBinding) {
    if (this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        "A project-bound connection cannot create or switch projects.",
      );
    return projectSummary(await this.store.createProject({ name, binding }));
  }
  private async bindProjectImpl(projectId: string, binding: ProjectBinding) {
    return projectSummary(
      await this.store.bindProject(this.requireProject(projectId), binding),
    );
  }

  async catalogList(
    input: {
      projectId?: string;
      kind?: CatalogKind;
      scope?: CatalogScope | "all";
      query?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    const projectId = this.catalogProject(input.projectId);
    const scope = input.scope ?? "all";
    const query = input.query?.trim().toLocaleLowerCase();
    const matches = (item: object) =>
      !query || catalogSearchText(item).includes(query);
    const builtin =
      input.kind === "template" || !["all", "builtin"].includes(scope)
        ? []
        : listBuiltinComponents()
            .filter(matches)
            .map((item) => summarizeCatalog("component", item, projectId));
    const components =
      input.kind === "template"
        ? []
        : (await listComponents(this.store.root, projectId, { scope }))
            .filter(matches)
            .map((item) => summarizeCatalog("component", item, projectId));
    const templates =
      input.kind === "component"
        ? []
        : (await listTemplates(this.store.root, projectId, { scope }))
            .filter(matches)
            .map((item) => summarizeCatalog("template", item, projectId));
    const all = [
      ...new Map(
        [...builtin, ...components, ...templates].map((item) => [
          `${item.kind}:${item.scope}:${item.id}:${item.version ?? ""}:${item.integrity ?? ""}`,
          item,
        ]),
      ).values(),
    ].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id) ||
        ["project", "global", "published", "builtin"].indexOf(a.scope) -
          ["project", "global", "published", "builtin"].indexOf(b.scope) ||
        (b.version ?? "").localeCompare(a.version ?? "", undefined, {
          numeric: true,
        }),
    );
    const result = pageOf(all, {
      limit: input.limit,
      cursor: input.cursor,
      key: { projectId, kind: input.kind, scope, query },
    });
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        describe: describeCommand(item, projectId),
      })),
      next: result.nextCursor
        ? [
            "showai catalog list",
            ...(projectId ? ["--project", shellToken(projectId)] : []),
            ...(input.kind ? ["--kind", input.kind] : []),
            "--scope",
            scope,
            ...(input.query ? ["--query", shellToken(input.query)] : []),
            "--limit",
            String(result.limit),
            "--cursor",
            result.nextCursor,
            "--json",
          ].join(" ")
        : "showai guide catalog --json",
    };
  }

  async catalogDescribe(id: string, input: CatalogSelection = {}) {
    const projectId = this.catalogProject(input.projectId);
    const view = input.view ?? "summary";
    if (input.kind === "template") {
      const template = await getTemplate(this.store.root, id, projectId, {
        scope: input.scope,
        version: input.version,
        integrity: input.integrity,
      });
      const summary = summarizeCatalog("template", template, projectId);
      const next = Object.fromEntries(
        ["guide", "examples", "dependencies", "source"].map((view) => [
          view,
          describeCommand(summary, projectId, view as CatalogView),
        ]),
      );
      if (view === "summary") return { ...summary, view, next };
      if (view === "guide")
        return {
          ...summary,
          view,
          contentGuide: template.contentGuide,
          related: template.related,
          next,
        };
      if (view === "examples")
        return { ...summary, view, examples: template.examples, next };
      if (view === "dependencies")
        return {
          ...summary,
          view,
          dependencies: template.dependencies,
          parents: template.parents ?? [],
          mergeBase: template.mergeBase,
          next,
        };
      if (view === "schema")
        return {
          ...summary,
          view,
          schema: {
            input: "SaveTemplateInput",
            required: ["name", "description"],
            optional: [
              "id",
              "version",
              "scenarios",
              "contentGuide",
              "related",
              "examples",
              "document",
              "composition",
            ],
            composition: [
              { type: "content", content: "doc node" },
              {
                type: "template",
                ref: "exact package revision",
                title: "optional",
              },
            ],
          },
          next,
        };
      if (view === "source")
        return {
          ...summary,
          view,
          source: this.templateSource(template),
          next,
        };
      return {
        ...summary,
        view: "full",
        contentGuide: template.contentGuide,
        related: template.related,
        examples: template.examples,
        dependencies: template.dependencies,
        parents: template.parents ?? [],
        mergeBase: template.mergeBase,
        next,
      };
    }
    const builtinCandidate =
      [undefined, "all", "builtin"].includes(input.scope) &&
      listBuiltinComponents({ includeLegacy: true }).some(
        (item) => item.kind === id,
      );
    const installedMatch =
      builtinCandidate &&
      input.scope !== "builtin" &&
      (
        await listComponents(this.store.root, projectId, { scope: input.scope })
      ).some(
        (item) =>
          item.id === id &&
          (!input.version || item.version === input.version) &&
          (!input.integrity || item.integrity === input.integrity),
      );
    const builtin = builtinCandidate && !installedMatch;
    const component = builtin
      ? { ...describeBuiltinComponent(id), id, scope: "builtin" as const }
      : await getComponent(this.store.root, id, input.version, projectId, {
          scope: input.scope,
          integrity: input.integrity,
        });
    const summary = summarizeCatalog("component", component, projectId);
    const native = "insertion" in component ? component.insertion : undefined;
    const next = Object.fromEntries(
      [
        "guide",
        "schema",
        "examples",
        "dependencies",
        ...(native ? [] : ["source"]),
      ].map((view) => [
        view,
        describeCommand(summary, projectId, view as CatalogView),
      ]),
    );
    const schema =
      "propsSchema" in component ? component.propsSchema : component.schema;
    const parents = "parents" in component ? (component.parents ?? []) : [];
    if (view === "summary") return { ...summary, view, next };
    if (view === "guide")
      return {
        ...summary,
        view,
        usage: native
          ? {
              nodeType: native.nodeType,
              kind: id,
              reference: summary.ref,
              operation: {
                type: "component.insert",
                kind: id,
                data: component.defaultData,
              },
              steps: [
                "Read schema and examples for initial content.",
                "Insert this component with component.insert and the destination parentId, using the current page hash.",
                "Edit or nest its content directly, expand it, or save it as a template for reuse.",
              ],
            }
          : {
              nodeType: "widget",
              kind: builtin ? id : "custom",
              reference: summary.ref,
              node: {
                type: "widget",
                attrs: {
                  kind: builtin ? id : "custom",
                  data: builtin
                    ? {}
                    : {
                        componentId: id,
                        version: summary.version,
                        integrity: summary.integrity,
                        scope: summary.scope,
                        props: {},
                      },
                },
              },
              steps: [
                "Read schema for required props.",
                "Choose an example only when it matches the content.",
                "Insert a widget into the selected page using its current hash.",
              ],
            },
        next,
      };
    if (view === "schema") return { ...summary, view, schema, next };
    if (view === "examples")
      return {
        ...summary,
        view,
        defaultData: component.defaultData,
        examples: component.examples,
        next,
      };
    if (view === "dependencies")
      return {
        ...summary,
        view,
        dependencies:
          "dependencies" in component ? (component.dependencies ?? []) : [],
        parents,
        mergeBase: "mergeBase" in component ? component.mergeBase : undefined,
        next,
      };
    if (view === "source") {
      const source = builtin
        ? readBuiltinComponentSource(id)
        : await readComponentSource(
            this.store.root,
            id,
            input.version,
            projectId,
            { scope: input.scope, integrity: input.integrity },
          );
      if (input.file === "*") return { ...summary, view, source, next };
      if (input.file) {
        if (Object.hasOwn(source.files, input.file))
          return {
            ...summary,
            view,
            file: input.file,
            encoding: "utf8",
            content: source.files[input.file],
            next,
          };
        if (source.assets && Object.hasOwn(source.assets, input.file))
          return {
            ...summary,
            view,
            file: input.file,
            encoding: "base64",
            content: source.assets[input.file],
            next,
          };
        throw new CoreError(
          "NOT_FOUND",
          `Source file not found: ${input.file}`,
        );
      }
      return {
        ...summary,
        view,
        manifest: source.manifest,
        file: source.manifest.entry,
        source: source.source,
        files: Object.keys(source.files),
        assets: Object.keys(source.assets ?? {}),
        next: {
          ...next,
          allFiles: describeCommand(summary, projectId, "source").replace(
            " --json",
            " --file '*' --json",
          ),
        },
      };
    }
    return {
      ...summary,
      view: "full",
      schema,
      defaultData: component.defaultData,
      examples: component.examples,
      dependencies:
        "dependencies" in component ? (component.dependencies ?? []) : [],
      parents,
      mergeBase: "mergeBase" in component ? component.mergeBase : undefined,
      next,
    };
  }

  private templateSource(template: TemplateRecord): SaveTemplateInput {
    return {
      id: template.id,
      version: template.version,
      name: template.name,
      description: template.description,
      scenarios: template.scenarios,
      contentGuide: template.contentGuide,
      related: template.related,
      examples: template.examples,
      ...(template.composition?.length
        ? { composition: template.composition }
        : { document: template.document }),
      parents: template.parents,
      mergeBase: template.mergeBase,
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
    if (title !== undefined) document.title = title;
    if (options.pageId) {
      if (!options.baseHash)
        throw new Error(
          "Inserting a template requires the destination page base hash.",
        );
      const target = await this.store.readPage(project, options.pageId);
      return this.store.savePage(
        project,
        options.pageId,
        placeTemplate(target.document, document, options.parentId),
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
    if (pageId && (input.document || input.composition))
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
      document?: ShowDocument;
      components?: CompiledComponent[];
      remoteComponents?: PublishedComponentLocator[];
    },
  ) {
    const project = this.requireProject(projectId);
    await this.store.listPages(project);
    const components = [
      ...(input.components ?? []),
      ...(input.remoteComponents?.length
        ? await loadRemoteComponents(input.remoteComponents)
        : []),
    ];
    if (components.length)
      await importCompiledComponents(this.store.root, components, project);
    const document = input.document
      ? await lockDocumentComponents(
          this.store.root,
          rebindImportedComponents(input.document, components),
          project,
        )
      : undefined;
    return this.store.createPage(project, { ...input, document });
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
    return readPageView(
      this.store,
      this.requireProject(projectId),
      pageId,
      options,
    );
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
    if (current.hash !== baseHash)
      throw new CoreError(
        "CONFLICT",
        "The page has newer changes. Read the diff before saving.",
        { currentHash: current.hash },
      );
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
    if (current.hash !== input.baseHash)
      throw new CoreError(
        "CONFLICT",
        "The page has newer changes. Read the diff before applying edits.",
        { currentHash: current.hash },
      );
    const document = await lockDocumentComponents(
      this.store.root,
      applyOperations(current.document, input.operations),
      project,
    );
    return this.store.savePage(
      project,
      pageId,
      document,
      input.baseHash,
      input.baseRevision,
    );
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
  }) {
    return exportPage({
      root: this.store.root,
      ...input,
      projectId: this.requireProject(input.projectId),
    });
  }
  private mutation<T>(
    name: string,
    args: unknown[],
    operation: () => Promise<T>,
  ): Promise<T> {
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
    return mutateLibrary(this.store.root, operation, {
      ...context,
      requestFingerprint,
      message: context.message ?? name,
    });
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
    return this.mutation("Create page", args, () =>
      this.createPageImpl(...args),
    );
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

export function errorResult(error: unknown) {
  const code = error instanceof CoreError ? error.code : "ERROR";
  const message = error instanceof Error ? error.message : String(error);
  return {
    code,
    message,
    ...(error instanceof CoreError && error.conflictId
      ? { conflictId: error.conflictId }
      : {}),
    ...(error instanceof CoreError && error.currentRevision
      ? { currentRevision: error.currentRevision }
      : {}),
    ...(error instanceof CoreError && error.currentHash
      ? { currentHash: error.currentHash }
      : {}),
  };
}
