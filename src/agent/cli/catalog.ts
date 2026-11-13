import { resolve } from "node:path";
import type {
  CatalogScope,
  ComponentSource,
  EditablePackage,
  PackageMergeInput,
  PackageRevisionRef,
  SaveTemplateInput,
} from "../../contract/types";
import {
  hiddenFlag,
  hiddenText,
  option,
  requireCount,
  text,
  unknownCommand,
  type Arguments,
  type CommandDeclaration,
} from "./command";
import {
  catalogScope,
  catalogView,
  objectInput,
  readJson,
  resultLimit,
  saveOutput,
} from "./inputs";

/** --kind of catalog commands; list also takes contribution. */
function catalogKind(args: Arguments) {
  const kind = option(args, "kind") as "component" | "template" | undefined;
  if (kind && !["component", "template"].includes(kind))
    throw new Error(
      "--kind must be component or template (list also takes contribution).",
    );
  return kind;
}

function templateSelections(args: Arguments) {
  return (option(args, "templates") ?? "")
    .split(",")
    .filter(Boolean)
    .map((value) => {
      const [templateId, version, ...extra] = value.split("@");
      if (extra.length || !templateId || (value.includes("@") && !version))
        throw new Error(
          "Use comma-separated ID or ID@VERSION template selections.",
        );
      return {
        id: templateId,
        ...(version ? { version } : {}),
        ...(catalogScope(args, false)
          ? { scope: catalogScope(args, false) as CatalogScope }
          : {}),
      };
    });
}

/** Components, templates and publications: catalog *, template *, publish *. */
export const catalogCommands: CommandDeclaration[] = [
  {
    command: "catalog",
    actions: ["list"],
    options: {
      kind: text,
      scope: text,
      versions: text,
      limit: text,
      cursor: text,
      query: hiddenText,
    },
    help: [
      "catalog list [--kind component|template|contribution] [--scope SCOPE] [--versions recommended|all] [--limit N --cursor CURSOR]",
    ],
    async run(args, { service, project }) {
      if (option(args, "kind") === "contribution") {
        requireCount(args, 2);
        return service.catalogContributions({
          projectId: option(args, "project") ?? (await project()),
          query: option(args, "query"),
        });
      }
      const kind = catalogKind(args);
      requireCount(args, 2);
      return service.catalogList({
        versions: option(args, "versions") as "recommended" | "all" | undefined,
        projectId:
          option(args, "project") ??
          (!catalogScope(args) ||
          ["all", "project"].includes(catalogScope(args)!)
            ? await project()
            : undefined),
        kind,
        scope: catalogScope(args),
        query: option(args, "query"),
        limit: resultLimit(args),
        cursor: option(args, "cursor"),
      });
    },
  },
  {
    command: "catalog",
    actions: ["describe"],
    options: {
      kind: text,
      view: text,
      "parameter-path": text,
      "parameter-offset": text,
      "parameter-limit": text,
      "known-hash": text,
      scope: hiddenText,
      version: hiddenText,
      integrity: hiddenText,
      file: hiddenText,
      out: hiddenText,
      overwrite: hiddenFlag,
    },
    help: [
      "catalog describe ID [--kind component|template] [--view VIEW]",
      "catalog describe ID --view parameters [--parameter-path PATH --parameter-offset N --parameter-limit N --known-hash HASH]",
    ],
    async run(args, { service, project, id }) {
      const kind = catalogKind(args);
      requireCount(args, 3);
      const result = await service.catalogDescribe(id, {
        projectId:
          option(args, "project") ??
          (!catalogScope(args) ||
          ["all", "project"].includes(catalogScope(args)!)
            ? await project()
            : undefined),
        kind,
        scope: catalogScope(args),
        version: option(args, "version"),
        integrity: option(args, "integrity"),
        view: catalogView(args),
        parameterPath: option(args, "parameter-path"),
        parameterOffset:
          option(args, "parameter-offset") === undefined
            ? undefined
            : Number(option(args, "parameter-offset")),
        parameterLimit:
          option(args, "parameter-limit") === undefined
            ? undefined
            : Number(option(args, "parameter-limit")),
        knownHash: option(args, "known-hash"),
        file: option(args, "file"),
      });
      const path = await saveOutput(service, args, result);
      return path
        ? {
            id,
            kind: kind ?? "component",
            view: catalogView(args),
            path,
            next: "Read the saved detail only when needed.",
          }
        : result;
    },
  },
  {
    command: "catalog",
    actions: ["remove"],
    options: { kind: text, version: text, scope: text },
    help: [
      "catalog remove ID --kind component|template [--version VERSION] [--scope project|global|published]",
      "  Refuses while pages, packages or publications use it and lists where; built-ins cannot be removed.",
    ],
    async run(args, { service, project, id }) {
      const kind = catalogKind(args);
      requireCount(args, 3);
      // Core explains why built-in and unknown scopes cannot be removed.
      const scope = catalogScope(args) ?? "project";
      return service.removeCatalog(
        scope === "project" ? await project() : undefined,
        {
          kind: kind ?? "component",
          id,
          version: option(args, "version"),
          scope: scope as "project" | "global" | "published",
        },
      );
    },
  },
  {
    command: "catalog",
    actions: ["import"],
    options: { input: text },
    access: "write",
    async run(args, { service, project }) {
      requireCount(args, 2);
      return service.importComponent(
        resolve(option(args, "input", true)!),
        await project(),
      );
    },
  },
  {
    command: "catalog",
    actions: ["save"],
    options: { input: text },
    access: "write",
    async run(args, { service, project }) {
      requireCount(args, 2);
      const input = objectInput(await readJson(option(args, "input", true)!));
      return service.saveComponent(
        await project(),
        objectInput(
          typeof input.source === "object" ? input.source : input,
        ) as unknown as ComponentSource,
      );
    },
  },
  {
    command: "catalog",
    actions: ["promote", "fork"],
    options: { input: text, to: text, id: text, version: text, name: text },
    access: "write",
    async run(args, { service, project, action }) {
      requireCount(args, 2);
      const input = objectInput(await readJson(option(args, "input", true)!));
      const ref = objectInput(
        input.ref ?? input,
        "package ref",
      ) as unknown as PackageRevisionRef;
      if (action === "promote") {
        if (option(args, "to") !== "global")
          throw new Error(
            "Promotion requires explicit --to global. It registers a local shared revision, not a public upload.",
          );
        return service.promote(await project(), ref, "global");
      }
      return service.fork(await project(), ref, {
        id: option(args, "id"),
        version: option(args, "version", true)!,
        name: option(args, "name"),
      });
    },
  },
  {
    command: "catalog",
    actions: ["merge"],
    options: { input: text, out: text, view: text, overwrite: hiddenFlag },
    access: (args) => (args.positional[2] === "resolve" ? "write" : "read"),
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      const input = objectInput(await readJson(option(args, "input", true)!));
      if (input.projectId !== undefined && input.projectId !== (await project()))
        throw new Error("The input projectId must match --project.");
      if (id === "preview") {
        const preview = await service.previewMerge(
          await project(),
          input as unknown as Omit<PackageMergeInput, "projectId">,
        );
        const path = await saveOutput(service, args, preview);
        if (catalogView(args) === "source" && !path) return preview;
        return {
          projectId: preview.projectId,
          kind: preview.kind,
          base: preview.base,
          ours: preview.ours,
          theirs: preview.theirs,
          conflictCount: preview.conflicts.length,
          conflicts: preview.conflicts.map(({ path, kind }) => ({
            path,
            kind,
          })),
          ...(path ? { path } : {}),
          next: "Review --view source or the saved preview, then provide resolved plus a new version to catalog merge resolve.",
        };
      }
      if (id === "resolve") {
        if (!input.resolved || typeof input.version !== "string")
          throw new Error(
            "Resolve requires a reviewed resolved package and a new version in the input file.",
          );
        return service.resolveMerge(
          await project(),
          input as unknown as Omit<PackageMergeInput, "projectId"> & {
            id?: string;
            version: string;
            resolved: EditablePackage;
          },
        );
      }
      throw unknownCommand(args);
    },
  },
  {
    command: "catalog",
    actions: ["*"],
    async run(args) {
      catalogKind(args);
      throw unknownCommand(args);
    },
  },
  {
    command: "template",
    actions: ["import"],
    access: "write",
    help: ["template import DIRECTORY --project PROJECT"],
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      const saved = await service.importTemplate(await project(), resolve(id));
      return {
        id: saved.id,
        name: saved.name,
        version: saved.version,
        integrity: saved.integrity,
        scope: saved.scope,
        workflow: saved.workflow,
      };
    },
  },
  {
    command: "template",
    actions: ["export"],
    options: {
      out: text,
      scope: hiddenText,
      version: hiddenText,
      integrity: hiddenText,
    },
    help: ["template export ID --project PROJECT --out NEW_DIRECTORY"],
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      return service.exportTemplate(
        await project(),
        id,
        resolve(option(args, "out", true)!),
        {
          scope: catalogScope(args, false),
          version: option(args, "version"),
          integrity: option(args, "integrity"),
        },
      );
    },
  },
  {
    command: "template",
    actions: ["context"],
    options: { templates: text, scope: hiddenText },
    help: ["template context --project PROJECT [--templates ID[@VERSION],ID]"],
    async run(args, { service, project }) {
      requireCount(args, 2);
      return service.templateContext(await project(), templateSelections(args));
    },
  },
  {
    command: "template",
    actions: ["apply", "instantiate"],
    options: {
      title: text,
      scope: text,
      version: text,
      integrity: text,
      page: text,
      "base-revision": text,
      "base-hash": text,
      parent: text,
    },
    access: "write",
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      return service.applyTemplate(await project(), id, option(args, "title"), {
        scope: catalogScope(args, false) as CatalogScope | undefined,
        version: option(args, "version"),
        integrity: option(args, "integrity"),
        pageId: option(args, "page"),
        baseRevision: option(args, "base-revision"),
        baseHash: option(args, "page")
          ? option(args, "base-hash", true)
          : undefined,
        parentId: option(args, "parent"),
      });
    },
  },
  {
    command: "template",
    actions: ["save"],
    options: {
      input: text,
      page: text,
      id: text,
      version: text,
      name: text,
      description: text,
    },
    access: "write",
    async run(args, { service, project }) {
      requireCount(args, 2);
      const raw = option(args, "input")
        ? objectInput(await readJson(option(args, "input")!))
        : {};
      const input = objectInput(
        raw.source ?? raw.template ?? raw,
      ) as unknown as SaveTemplateInput;
      return service.saveTemplate(await project(), option(args, "page"), {
        ...input,
        ...(option(args, "id") ? { id: option(args, "id") } : {}),
        ...(option(args, "version") ? { version: option(args, "version") } : {}),
        ...(input.bundle && !option(args, "name")
          ? {}
          : { name: option(args, "name") ?? input.name }),
        ...(input.bundle && !option(args, "description")
          ? {}
          : {
              description:
                option(args, "description") ?? input.description ?? "",
            }),
      });
    },
  },
  {
    command: "publish",
    actions: ["list"],
    options: { limit: text, cursor: text },
    async run(args, { service }) {
      requireCount(args, 2);
      return service.publications({
        limit: resultLimit(args),
        cursor: option(args, "cursor"),
      });
    },
  },
  {
    command: "publish",
    actions: ["prepare"],
    options: { input: text, out: text },
    access: "write",
    ownTransaction: true,
    async run(args, { service, project }) {
      requireCount(args, 2);
      const raw = await readJson(option(args, "input", true)!);
      const refs = Array.isArray(raw) ? raw : objectInput(raw).refs;
      if (!Array.isArray(refs))
        throw new Error("Publication input requires a refs array.");
      return service.preparePublication(await project(), {
        refs: refs as PackageRevisionRef[],
        out: resolve(option(args, "out", true)!),
      });
    },
  },
  {
    command: "publish",
    actions: ["verify", "register"],
    options: { url: text },
    access: "write",
    async run(args, { service, project }) {
      requireCount(args, 2);
      return service.verifyPublication(
        await project(),
        option(args, "url", true)!,
      );
    },
  },
];
