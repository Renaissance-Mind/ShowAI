import { z } from "zod";
import type {
  ComponentSource,
  EditablePackage,
  SaveTemplateInput,
} from "../../contract/types";
import { CoreError } from "../../core/model";
import type { CatalogRemovalInput } from "../../core/catalog-removal";
import { mutateLibrary } from "../../core/library-runtime";
import {
  listContributedImporters,
  removeContributedImporter,
  saveContributedImporter,
} from "../../core/importers/contributed";
import { CATALOG_VIEWS } from "../disclosure";
import {
  inspectComponentDirectory,
  writeComponentDirectory,
} from "../component-directory";
import { GUIDE_TOPICS } from "../guides";
import { getMcpGuide } from "../mcp-guides";
import {
  changeSchema,
  jsonObject,
  knownHash,
  refSchema,
  scopeSchema,
  templateSelection,
  type ToolDeclaration,
} from "./tool";

const revisionId = z.string().optional();
const revisionVersion = z.string();

/** The guide and the project's context, read first. */
export const contextTools: ToolDeclaration[] = [
  {
    name: "guide",
    access: "read",
    description: "Read a focused ShowAI guide; without topic, list the guides.",
    input: () => ({
      topic: z.enum(GUIDE_TOPICS).optional(),
      knownHash: knownHash(),
    }),
    run: ({ call }, { topic, knownHash }) =>
      call(async () => getMcpGuide(topic, knownHash)),
  },
  {
    name: "template_context",
    access: "read",
    description:
      "Read the selected templates whole for this task: README, every guide and the template component index, with exact refs. templates:[] records only the system workflow ref.",
    input: () => ({
      templates: z.array(templateSelection).max(8).optional(),
      knownHash: knownHash(),
      componentOffset: z.number().int().nonnegative().optional(),
      componentLimit: z.number().int().min(1).max(50).optional(),
    }),
    run: (
      { service, projectId, call, options },
      { templates, knownHash, componentOffset, componentLimit },
    ) =>
      call(() =>
        service.templateContext(
          projectId,
          templates ?? options.sessionTemplates ?? [],
          knownHash,
          componentOffset,
          componentLimit,
        ),
      ),
  },
  {
    name: "project_context",
    access: "read",
    description:
      "Return the project and its compact component index (names, descriptions, scenarios, props signatures) with the index revision.",
    input: () => ({ knownCatalogRevision: knownHash() }),
    run: ({ service, projectId, call }, { knownCatalogRevision }) =>
      call(async () => ({
        project: await service.store.readProject(projectId),
        root: service.store.root,
        componentCatalog: await service.componentContext(
          projectId,
          knownCatalogRevision,
        ),
        next: "guide workspace",
      })),
  },
];

/** Components, templates, revisions, publications and search. */
export const catalogTools: ToolDeclaration[] = [
  {
    name: "catalog_list",
    access: "read",
    description:
      "List component and template names, descriptions, scenarios and one-line props signatures. Defaults to built-ins plus this project's components; scope selects global/published/all; limit/cursor paginate. kind contribution lists extension slots and what fills them.",
    input: () => ({
      kind: z.enum(["component", "template", "contribution"]).optional(),
      scope: scopeSchema.optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().optional(),
      versions: z.enum(["recommended", "all"]).optional(),
    }),
    run: ({ service, projectId, call }, { kind, ...input }) =>
      call(async () => {
        if (kind === "contribution")
          return service.catalogContributions({
            projectId,
            query: input.query,
          });
        return service.catalogList({ projectId, kind, ...input });
      }),
  },
  {
    name: "catalog_describe",
    access: "read",
    description: ({ localFiles }) =>
      `Describe a component or template. view: summary (default), guide (use contract, schema, example), parameters (paged by parameterPath/offset/limit), development, examples, dependencies, source or full.${
        localFiles
          ? " With view source, out (absolute folder) writes the component's whole package there for editing and component_save directory."
          : ""
      }`,
    input: ({ localFiles }) => ({
      id: z.string(),
      kind: z.enum(["component", "template", "importer"]).optional(),
      scope: scopeSchema.optional(),
      version: z.string().optional(),
      integrity: z.string().optional(),
      view: z.enum(CATALOG_VIEWS).optional(),
      parameterPath: z.string().min(1).max(500).optional(),
      parameterOffset: z.number().int().nonnegative().optional(),
      parameterLimit: z.number().int().min(1).max(50).optional(),
      knownHash: knownHash(),
      file: z.string().optional(),
      ...(localFiles
        ? {
            out: z.string().min(1).optional(),
            overwrite: z.boolean().optional(),
          }
        : {}),
    }),
    run: ({ service, projectId, call }, { id, out, overwrite, ...input }) =>
      call(async () => {
        if (input.kind === "importer") {
          // A contributed importer: its importer.json and importer.js.
          const found = (
            await listContributedImporters(service.store.root, projectId)
          ).importers.find((item) => item.manifest.id === id);
          if (!found)
            throw new CoreError("NOT_FOUND", `No contributed importer ${id}.`);
          return found;
        }
        if (out === undefined)
          return service.catalogDescribe(id, {
            projectId,
            ...(input as typeof input & { kind?: "component" | "template" }),
          });
        if (
          (input.view !== undefined && input.view !== "source") ||
          input.kind === "template" ||
          input.file !== undefined
        )
          throw new CoreError(
            "INVALID_DATA",
            'out writes a component package: use it with view:"source" (or no view) and without file.',
          );
        const described = (await service.catalogDescribe(id, {
          projectId,
          ...input,
          kind: "component",
          view: "source",
          file: "*",
        })) as unknown as Record<string, unknown> & {
          source: Parameters<typeof writeComponentDirectory>[1];
        };
        const { source, next: _next, ...summary } = described;
        return {
          ...summary,
          out: await writeComponentDirectory(
            String(out),
            source,
            overwrite === true,
          ),
          next: "Edit the files, raise manifest.version, then component_save {directory} with this folder.",
        };
      }),
  },
  {
    name: "component_save",
    access: "write",
    description: ({ localFiles }) =>
      localFiles
        ? "Save component source as a new immutable revision in this project: source inline, or directory, the absolute path of a package folder on this device (manifest.json, props.schema.json, entry and files), read without copying it into the call. Same contract for both; legacy:true imports an old package without manifest.documentation."
        : "Save component source as a new immutable revision in this project.",
    input: ({ localFiles }) => ({
      ...changeSchema,
      source: jsonObject.optional(),
      ...(localFiles
        ? {
            directory: z.string().min(1).optional(),
            legacy: z.boolean().optional(),
          }
        : {}),
    }),
    run: (
      { service, projectId, call, localFiles },
      { source, directory, legacy, ...metadata },
    ) =>
      call(async () => {
        if (!source === !directory)
          throw new CoreError(
            "INVALID_DATA",
            localFiles
              ? "Pass exactly one of source or directory."
              : "Pass source.",
          );
        if (directory) {
          const manifest = await inspectComponentDirectory(String(directory));
          if (!manifest.documentation && legacy !== true)
            throw new CoreError(
              "INVALID_DATA",
              `${String(directory)}/manifest.json has no documentation. New components need manifest.documentation version 2 (guide component); pass legacy:true only to import an existing package that predates it.`,
            );
          return service.importComponent(String(directory), projectId);
        }
        if (legacy !== undefined)
          throw new CoreError(
            "INVALID_DATA",
            "legacy applies to directory imports only.",
          );
        if (
          !(source!.manifest as Record<string, unknown> | undefined)
            ?.documentation
        )
          throw new CoreError(
            "INVALID_DATA",
            `New component authoring requires manifest.documentation. Read guide component for the contract${localFiles ? "; an existing package that predates it is imported with directory and legacy:true" : ""}.`,
          );
        return service.saveComponent(
          projectId,
          source as unknown as ComponentSource,
        );
      }, metadata),
  },
  {
    name: "template_apply",
    access: "write",
    description:
      "Create a resource from a template, or insert it into pageId with its baseHash/baseRevision and optional parentId.",
    input: () => ({
      ...changeSchema,
      templateId: z.string(),
      templates: z.array(templateSelection).max(8).optional(),
      pageId: z.string().optional(),
      baseHash: z.string().optional(),
      baseRevision: z.string().optional(),
      parentId: z.string().optional(),
      title: z.string().optional(),
      scope: z.enum(["builtin", "global", "published", "project"]).optional(),
      version: z.string().optional(),
      integrity: z.string().optional(),
    }),
    run: (
      { service, projectId, call, options },
      { templateId, title, operationId, message, groupId, ...selection },
    ) =>
      call(
        () =>
          service.applyTemplate(projectId, templateId, title, {
            ...selection,
            templates: selection.templates ?? options.sessionTemplates,
          }),
        { operationId, message, groupId },
      ),
  },
  {
    name: "template_save",
    access: "write",
    description:
      "Create an immutable project template from pageId or input:{bundle:{format:1,files,assets?}}; bundled components are compiled and registered.",
    input: () => ({
      ...changeSchema,
      pageId: z.string().optional(),
      input: jsonObject,
    }),
    run: ({ service, projectId, call }, { pageId, input, ...metadata }) =>
      call(async () => {
        const saved = await service.saveTemplate(
          projectId,
          pageId,
          input as unknown as SaveTemplateInput,
        );
        return input.bundle
          ? {
              id: saved.id,
              name: saved.name,
              version: saved.version,
              integrity: saved.integrity,
              scope: saved.scope,
              workflow: saved.workflow,
              next: {
                tool: "template_context",
                arguments: {
                  projectId,
                  templates: [
                    {
                      id: saved.id,
                      scope: saved.scope,
                      version: saved.version,
                      integrity: saved.integrity,
                    },
                  ],
                },
              },
            }
          : saved;
      }, metadata),
  },
  {
    name: "catalog_version",
    access: "write",
    summary:
      "Save a project-owned revision (fork an exact revision, or save a reviewed merge), or remove a revision; remove without version removes every revision in that scope and refuses with IN_USE while pages, packages or publications use it. importer saves an importer (guide import).",
    actions: ({ service, projectId, call }) => ({
      importer: {
        fields: {
          ...changeSchema,
          manifest: jsonObject,
          script: z.string().min(1),
        },
        run: ({ manifest, script, operationId, message, groupId }) =>
          call(
            async () => {
              const saved = await mutateLibrary(service.store.root, () =>
                saveContributedImporter(
                  service.store.root,
                  { manifest, script },
                  { scope: "project", projectId },
                ),
              );
              return {
                ...saved.manifest,
                scope: saved.scope,
                next: "page_create import:{source, dryRun:true}",
              };
            },
            {
              operationId: operationId as string | undefined,
              message: message as string | undefined,
              groupId: groupId as string | undefined,
            },
          ),
      },
      remove: {
        fields: {
          ...changeSchema,
          kind: z.enum(["component", "template", "importer"]),
          id: z.string().min(1),
          version: z.string().optional(),
          scope: z.enum(["project", "global", "published"]).optional(),
        },
        run: ({ operationId, message, groupId, ...input }) =>
          call(
            () =>
              input.kind === "importer"
                ? mutateLibrary(service.store.root, () =>
                    removeContributedImporter(
                      service.store.root,
                      String(input.id),
                      { scope: "project", projectId },
                    ),
                  )
                : service.removeCatalog(
                    projectId,
                    input as Omit<CatalogRemovalInput, "projectId">,
                  ),
            {
              operationId: operationId as string | undefined,
              message: message as string | undefined,
              groupId: groupId as string | undefined,
            },
          ),
      },
      fork: {
        fields: {
          ...changeSchema,
          ref: refSchema,
          id: revisionId,
          version: revisionVersion,
          name: z.string().optional(),
        },
        run: ({ ref, operationId, message, groupId, ...target }) =>
          call(
            () =>
              service.fork(
                projectId,
                ref as z.infer<typeof refSchema>,
                target as { id?: string; version: string; name?: string },
              ),
            {
              operationId: operationId as string | undefined,
              message: message as string | undefined,
              groupId: groupId as string | undefined,
            },
          ),
      },
      merge: {
        fields: {
          ...changeSchema,
          base: refSchema,
          ours: refSchema,
          theirs: refSchema,
          id: revisionId,
          version: revisionVersion,
          resolved: jsonObject,
        },
        run: ({ resolved, operationId, message, groupId, ...input }) =>
          call(
            () =>
              service.resolveMerge(projectId, {
                ...(input as {
                  base: z.infer<typeof refSchema>;
                  ours: z.infer<typeof refSchema>;
                  theirs: z.infer<typeof refSchema>;
                  id?: string;
                  version: string;
                }),
                resolved: resolved as unknown as EditablePackage,
              }),
            {
              operationId: operationId as string | undefined,
              message: message as string | undefined,
              groupId: groupId as string | undefined,
            },
          ),
      },
    }),
  },
  {
    name: "catalog_merge_preview",
    access: "read",
    description:
      'Preview a three-way merge without writing; view:"source" returns the candidate and conflict values.',
    input: () => ({
      base: refSchema,
      ours: refSchema,
      theirs: refSchema,
      view: z.enum(["summary", "source"]).optional(),
    }),
    run: ({ service, projectId, call }, { view, ...input }) =>
      call(async () => {
        const preview = await service.previewMerge(
          projectId,
          input as Parameters<typeof service.previewMerge>[1],
        );
        return view === "source"
          ? preview
          : {
              projectId,
              kind: preview.kind,
              base: preview.base,
              ours: preview.ours,
              theirs: preview.theirs,
              conflictCount: preview.conflicts.length,
              conflicts: preview.conflicts.map(({ path, kind }) => ({
                path,
                kind,
              })),
              next: "Read catalog_merge_preview with view=source, resolve conflicts, then catalog_version action merge with a new version.",
            };
      }),
  },
  {
    name: "publication_prepare",
    access: "write",
    description: "Prepare local static publication files from exact refs.",
    input: () => ({ refs: z.array(refSchema).min(1), out: z.string() }),
    run: ({ service, projectId, call }, input) =>
      call(() =>
        service.preparePublication(
          projectId,
          input as Parameters<typeof service.preparePublication>[1],
        ),
      ),
  },
  {
    name: "publication_list",
    access: "read",
    description:
      "List verified publication references in the local shared library.",
    input: () => ({
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().optional(),
    }),
    run: ({ service, call }, input) => call(() => service.publications(input)),
  },
  {
    name: "library_search",
    access: "read",
    description:
      "Search this project's pages, containers and component/template descriptions and source; returns node locations.",
    input: () => ({
      query: z.string(),
      kind: z
        .enum(["page", "component", "template", "project", "source"])
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().optional(),
    }),
    run: ({ service, projectId, call }, input) =>
      call(() =>
        service.search({
          ...(input as Parameters<typeof service.search>[0]),
          projectId,
        }),
      ),
  },
];
