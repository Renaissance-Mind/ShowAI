import type { CompiledComponent } from "../components/custom/types";
import { applyOperations } from "../core/diff";
import { FileStore } from "../core/store";
import { CoreError } from "../core/model";
import type {
  ApplyPageInput,
  ProjectBinding,
  ShowDocument,
} from "../core/model";
import { exportPage, type ExportFormat } from "./exporter";
import {
  getComponent,
  describeBuiltinComponent,
  listBuiltinComponents,
  importCompiledComponents,
  resolveDocumentComponents,
  getTemplate,
  importComponent,
  instantiateTemplate,
  listComponents,
  listTemplates,
  saveTemplate,
} from "../core/catalog";

function withoutComponentRuntime<T extends object>(
  component: T,
): Omit<T, "html" | "inline"> {
  const {
    html: _html,
    inline: _inline,
    ...metadata
  } = component as T & { html?: unknown; inline?: unknown };
  return metadata;
}

/** CLI, MCP and the desktop bridge use the same filesystem operations. */
export class AgentService {
  readonly store: FileStore;
  readonly projectId?: string;

  constructor(options: { root?: string; projectId?: string } = {}) {
    this.store = new FileStore(options.root);
    this.projectId = options.projectId;
  }

  requireProject(projectId?: string): string {
    if (!projectId)
      throw new CoreError(
        "INVALID_DATA",
        "Specify --project explicitly. ShowAI does not use a global active project.",
      );
    if (this.projectId && projectId !== this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        `This connection is bound to project ${this.projectId}.`,
      );
    return projectId;
  }

  async listProjects() {
    const projects = await this.store.listProjects();
    return this.projectId
      ? projects.filter((project) => project.id === this.projectId)
      : projects;
  }

  async createProject(name: string, binding?: ProjectBinding) {
    if (this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        "A project-bound connection cannot create or switch projects. Create projects through the CLI before connecting.",
      );
    return this.store.createProject({ name, binding });
  }

  async bindProject(projectId: string, binding: ProjectBinding) {
    return this.store.bindProject(this.requireProject(projectId), binding);
  }

  private catalogProject(projectId?: string): string | undefined {
    const selected = projectId ?? this.projectId;
    return selected ? this.requireProject(selected) : undefined;
  }

  async catalogList(
    input: {
      projectId?: string;
      kind?: "component" | "template";
      query?: string;
    } = {},
  ) {
    const projectId = this.catalogProject(input.projectId);
    const builtin =
      input.kind === "template"
        ? []
        : listBuiltinComponents().map((item) => ({
            ...item,
            id: item.kind,
            scope: "builtin",
            catalogKind: "component",
          }));
    const components =
      input.kind === "template"
        ? []
        : (await listComponents(this.store.root, projectId)).map((item) => ({
            ...withoutComponentRuntime(item),
            catalogKind: "component",
          }));
    const templates =
      input.kind === "component"
        ? []
        : (await listTemplates(this.store.root, projectId)).map((item) => ({
            ...item,
            catalogKind: "template",
          }));
    const query = input.query?.toLocaleLowerCase();
    return [...builtin, ...components, ...templates].filter(
      (item) =>
        !query || JSON.stringify(item).toLocaleLowerCase().includes(query),
    );
  }

  async catalogDescribe(
    id: string,
    input: {
      projectId?: string;
      kind?: "component" | "template";
      version?: string;
    } = {},
  ) {
    const projectId = this.catalogProject(input.projectId);
    if (input.kind === "template")
      return getTemplate(this.store.root, id, projectId);
    if (listBuiltinComponents().some((item) => item.kind === id))
      return { ...describeBuiltinComponent(id), id, scope: "builtin" };
    const component = await getComponent(
      this.store.root,
      id,
      input.version,
      projectId,
    );
    return withoutComponentRuntime(component);
  }

  async importComponent(directory: string, projectId?: string) {
    const component = await importComponent(
      this.store.root,
      directory,
      this.catalogProject(projectId),
    );
    return withoutComponentRuntime(component);
  }

  async applyTemplate(projectId: string, templateId: string, title?: string) {
    const project = this.requireProject(projectId);
    const template = await getTemplate(this.store.root, templateId, project);
    const document = instantiateTemplate(template.document);
    if (title !== undefined) document.title = title;
    return this.store.createPage(project, { document });
  }

  async saveTemplate(
    projectId: string,
    pageId: string,
    input: { id?: string; name: string; description: string },
  ) {
    const project = this.requireProject(projectId);
    const { document } = await this.store.readPage(project, pageId);
    return saveTemplate(this.store.root, { ...input, document }, project);
  }

  async listPages(projectId: string) {
    return this.store.listPages(this.requireProject(projectId));
  }
  async createPage(
    projectId: string,
    input: {
      title?: string;
      document?: ShowDocument;
      components?: CompiledComponent[];
    },
  ) {
    const project = this.requireProject(projectId);
    await this.store.listPages(project);
    if (input.components?.length)
      await importCompiledComponents(
        this.store.root,
        input.components,
        project,
      );
    if (input.document)
      await resolveDocumentComponents(this.store.root, input.document, project);
    return this.store.createPage(project, input);
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
  ) {
    const project = this.requireProject(projectId);
    const current = await this.store.readPage(project, pageId);
    if (current.hash !== baseHash)
      throw new CoreError(
        "CONFLICT",
        "The page has newer changes. Read the diff before saving.",
        { currentHash: current.hash },
      );
    if (components?.length)
      await importCompiledComponents(this.store.root, components, project);
    await resolveDocumentComponents(this.store.root, document, project);
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
    await resolveDocumentComponents(
      this.store.root,
      applyOperations(current.document, input.operations),
      project,
    );
    return this.store.applyPage(project, pageId, input);
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
    format: ExportFormat;
    out: string;
    overwrite?: boolean;
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
