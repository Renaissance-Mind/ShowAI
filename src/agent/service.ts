import { placeTemplate } from "../surface/document.mjs";
import { upgradeResource } from "../surface/containers.mjs";
import { FileStore } from "../core/store";
import { applyOperations } from "../core/diff";
import { CoreError } from "../core/model";
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
}) => ({
  id: project.id,
  name: project.name,
  pageCount: project.pageCount,
  ...(project.binding ? { binding: project.binding } : {}),
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
        "Specify --project explicitly. ShowAI does not use a global active project. Run showai guide workspace.",
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
  async currentProject(binding: ProjectBinding) {
    const projects = await this.store.listProjects();
    const project = projects.find(
      (project) =>
        (!this.projectId || project.id === this.projectId) &&
        (project.bindings ?? (project.binding ? [project.binding] : [])).some(
          (item) =>
            item.harness === binding.harness &&
            item.sessionId === binding.sessionId,
        ),
    );
    return {
      bound: !!project,
      project: project ? projectSummary(project) : null,
      next: project
        ? `showai pages list --project ${shellToken(project.id)} --json`
        : "showai guide workspace --json",
    };
  }
  async createProject(name: string, binding?: ProjectBinding) {
    if (this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        "A project-bound connection cannot create or switch projects.",
      );
    return projectSummary(await this.store.createProject({ name, binding }));
  }
  async bindProject(projectId: string, binding: ProjectBinding) {
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
    const next = Object.fromEntries(
      ["guide", "schema", "examples", "dependencies", "source"].map((view) => [
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
        usage: {
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
  async importComponent(directory: string, projectId: string) {
    const project = this.requireProject(projectId);
    await this.store.listPages(project);
    return summarizeCatalog(
      "component",
      await importComponent(this.store.root, directory, project),
      project,
    );
  }
  async saveComponent(projectId: string, source: ComponentSource) {
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
  async applyTemplate(
    projectId: string,
    templateId: string,
    title?: string,
    options: {
      scope?: CatalogScope;
      version?: string;
      integrity?: string;
      pageId?: string;
      baseHash?: string;
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
      );
    }
    return this.store.createPage(project, {
      document: upgradeResource(document),
    });
  }
  async saveTemplate(
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

  async promote(projectId: string, ref: PackageRevisionRef, target: "global") {
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
  async fork(
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
  async resolveMerge(
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
  async verifyPublication(projectId: string, manifestUrl: string) {
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
  async createPage(
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
  async readPage(projectId: string, pageId: string) {
    return this.store.readPage(this.requireProject(projectId), pageId);
  }
  async savePage(
    projectId: string,
    pageId: string,
    document: ShowDocument,
    baseHash: string,
    components?: CompiledComponent[],
    remoteComponents?: PublishedComponentLocator[],
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
    );
  }
  async applyPage(projectId: string, pageId: string, input: ApplyPageInput) {
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
    return this.store.savePage(project, pageId, document, input.baseHash);
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
}

export function errorResult(error: unknown) {
  const code = error instanceof CoreError ? error.code : "ERROR";
  const message = error instanceof Error ? error.message : String(error);
  return {
    code,
    message,
    ...(error instanceof CoreError && error.currentHash
      ? { currentHash: error.currentHash }
      : {}),
  };
}
