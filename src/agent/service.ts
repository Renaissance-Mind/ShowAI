import { placeTemplate } from "../surface/document.mjs";
import { upgradeResource } from "../surface/containers.mjs";
import { FileStore } from "../core/store";
import { applyOperations, canonicalJson } from "../core/diff";
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
  LibraryOperations,
  type HistoryQuery,
} from "../core/library-operations";
import type { SearchOptions } from "../core/library-index";
import { CoreError } from "../core/model";
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
  compareCatalogVersions,
  catalogEntry,
  catalogPage,
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

  async catalogList(
    input: {
      projectId?: string;
      kind?: CatalogKind;
      scope?: CatalogScope | "all";
      query?: string;
      limit?: number;
      cursor?: string;
      versions?: "recommended" | "all";
    } = {},
  ) {
    const projectId = this.catalogProject(input.projectId);
    if (input.versions && !["recommended", "all"].includes(input.versions))
      throw new CoreError(
        "INVALID_DATA",
        "versions must be recommended or all.",
      );
    const scope = input.scope ?? "all";
    const componentScope = input.scope ?? (projectId ? "project" : "builtin");
    const query = input.query?.trim().toLocaleLowerCase();
    const matches = (item: object) =>
      !query || catalogSearchText(item).includes(query);
    const identity = (item: {
      kind: CatalogKind;
      scope: CatalogScope;
      id: string;
      version?: string;
      integrity?: string;
    }) =>
      `${item.kind}:${item.scope}:${item.id}:${item.version ?? ""}:${item.integrity ?? ""}`;
    const matching = new Set<string>();
    const documentationRevisions = new Map<string, string>();
    const summarize = (kind: CatalogKind, item: object) => {
      const summary = summarizeCatalog(kind, item, projectId);
      if (matches(item)) matching.add(identity(summary));
      documentationRevisions.set(
        identity(summary),
        createHash("sha256")
          .update(
            JSON.stringify(
              (item as { documentation?: unknown }).documentation ?? null,
            ),
          )
          .digest("hex"),
      );
      return summary;
    };
    const builtin =
      input.kind === "template" || !["all", "builtin"].includes(scope)
        ? []
        : listBuiltinComponents().map((item) => summarize("component", item));
    const components =
      input.kind === "template"
        ? []
        : (
            await listComponents(this.store.root, projectId, {
              scope: componentScope,
            })
          ).map((item) => summarize("component", item));
    const templates =
      input.kind === "component"
        ? []
        : (await listTemplates(this.store.root, projectId, { scope })).map(
            (item) => summarize("template", item),
          );
    const all = [
      ...new Map(
        [...builtin, ...components, ...templates].map((item) => [
          identity(item),
          item,
        ]),
      ).values(),
    ].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id) ||
        ["project", "global", "published", "builtin"].indexOf(a.scope) -
          ["project", "global", "published", "builtin"].indexOf(b.scope) ||
        compareCatalogVersions(b.version, a.version),
    );
    const recommended =
      input.versions === "all"
        ? all
        : all.filter(
            (item, index) =>
              item.kind !== "component" ||
              !all
                .slice(0, index)
                .some(
                  (previous) =>
                    previous.kind === item.kind &&
                    previous.id === item.id &&
                    previous.scope === item.scope,
                ),
          );
    const entries = recommended
      .filter((item) => matching.has(identity(item)))
      .map(catalogEntry);
    const revision = createHash("sha256")
      .update(
        JSON.stringify([
          projectId ?? null,
          entries,
          entries.map((item) => documentationRevisions.get(identity(item))),
        ]),
      )
      .digest("hex");
    const result = catalogPage(entries, {
      limit: input.limit,
      cursor: input.cursor,
      key: {
        projectId,
        kind: input.kind,
        scope: input.scope ?? "default",
        query,
        versions: input.versions ?? "recommended",
        revision,
      },
    });
    return {
      ...result,
      revision,
      complete: result.nextCursor === null && !input.cursor,
      versions: input.versions ?? "recommended",
      next: result.nextCursor
        ? [
            "showai catalog list",
            ...(projectId ? ["--project", shellToken(projectId)] : []),
            ...(input.kind ? ["--kind", input.kind] : []),
            ...(input.scope ? ["--scope", input.scope] : []),
            ...(input.versions ? ["--versions", input.versions] : []),
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

  async componentContext(projectId?: string, knownRevision?: string) {
    const catalog = await this.catalogList({ projectId, kind: "component" });
    if (knownRevision === catalog.revision)
      return {
        revision: catalog.revision,
        total: catalog.total,
        complete: true,
        unchanged: true,
        reusePreviousIndex: true,
      };
    return {
      ...catalog,
      workflows: {
        page: "Read the current page and template when relevant. Select from this complete index, then read catalog_describe view=guide for each chosen exact revision. Modify instance data/layout and verify before saving.",
        component:
          "Define the expression gap, inspect candidates with view=guide, then use view=development and only the required source files. Save documentation, schema, examples and source together as a new version; validate in a real page.",
      },
      refresh:
        "Compare revision after project/catalog changes. Reuse documentation only for the same exact version; historical page references remain authoritative. Explicit scope=global/published/all discovers shared resources.",
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
        "development",
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
    const documentation = component.documentation;
    if (view === "summary") return { ...summary, view, next };
    if (view === "development")
      return {
        ...summary,
        view,
        ...(documentation
          ? {
              reuse: documentation.reuse,
              development: documentation.development,
            }
          : {
              missing:
                "This historical component has no authored development contract. Inspect its exact source and dependencies; do not assume general reusability.",
            }),
        dependencies:
          "dependencies" in component ? (component.dependencies ?? []) : [],
        next,
      };
    if (view === "guide")
      return {
        ...summary,
        view,
        ...(documentation
          ? {
              reuse: documentation.reuse,
              guide: documentation.usage,
              schema,
              ...(JSON.stringify(component.examples[0] ?? {}).length <= 12000
                ? { example: component.examples[0] }
                : {
                    exampleReference: {
                      view: "examples",
                      index: 0,
                      name: component.examples[0]?.name,
                      reason:
                        "Complete data is large; request examples explicitly. It has not been truncated.",
                    },
                  }),
            }
          : {
              missing:
                "This historical component has no authored use contract. Schema/examples remain available; usage and reuse boundaries are unassessed.",
            }),
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
      ...(documentation ? { documentation } : {}),
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
        const baseline = await this.versioned().pageAt(
          project,
          pageId,
          input.baseRevision,
        );
        const document = await lockDocumentComponents(
          this.store.root,
          applyOperations(baseline.document, input.operations),
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
        if (preserved) return preserved;
      }
      throw new CoreError(
        "CONFLICT",
        "保存失败：同一设备上的页面已有新修改。请比较并处理后重新保存，或放弃修改。",
        { currentHash: current.hash, currentRevision: current.revision },
      );
    }
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
    revision?: string;
    importedSnapshot?: { importId: string; snapshotId: string };
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
    return this.versioned().describePath(path, revision);
  }
  importedSnapshots(projectId: string, pageId?: string) {
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
    this.requireProject(input.projectId);
    return this.mutation("Restore imported snapshot", [input], () =>
      this.versioned().restoreImportedSnapshot(input),
    );
  }
  history(input: HistoryQuery = {}) {
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
    return this.versioned().changes(before, after, input);
  }
  historicalPage(projectId: string, pageId: string, revision: string) {
    return this.versioned().pageAt(
      this.requireProject(projectId),
      pageId,
      revision,
    );
  }
  historicalHtml(projectId: string, pageId: string, revision: string) {
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
    ...(error instanceof CoreError && error.saveFailed
      ? {
          saveFailed: true,
          recovery: error.recovery,
          nextStep:
            "保存失败。重新读取当前资源并比较修改，解决冲突后用新的 baseHash/baseRevision 保存；或放弃本次修改。不得原样重复覆盖。",
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
  };
}
