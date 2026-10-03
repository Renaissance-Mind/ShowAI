#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AgentService, errorResult } from "./service";
import type {
  PageOperation,
  ProjectBinding,
  ShowDocument,
} from "../core/model";
import { parseArtifact, validateDocument } from "../portable/validation.mjs";
import type {
  CatalogScope,
  CompiledComponent,
  ComponentSource,
  EditablePackage,
  PackageMergeInput,
  PackageRevisionRef,
  SaveTemplateInput,
} from "../components/custom/types";
import type { PublishedComponentLocator } from "../core/publication";
import { CATALOG_VIEWS, type CatalogView } from "./disclosure";
import { assertExportDestination } from "./exporter";
import type { ExportFormat } from "./exporter";

export const CLI_HELP = `ShowAI — interactive pages shared by people and Agents.

Start with one project:
  projects current --harness HOST --session SESSION_ID
  projects list
  projects create --name NAME [--harness HOST --session SESSION_ID]
  projects bind PROJECT --harness HOST --session SESSION_ID
  pages list --project PROJECT

Discover only what you need:
  guide [workspace|authoring|document|catalog|templates|versions|export|publish]
  catalog list [--kind component|template] [--scope SCOPE] [--limit 20]
  catalog describe ID [--kind component|template] [--view VIEW]

Shared: --home PATH, --project ID, --json, --help.
Project writes require --project; shared promotion/registration is explicit.
Use showai guide TOPIC for exact authoring, versioning and delivery commands.
`;

interface Arguments {
  positional: string[];
  options: Record<string, string | boolean>;
}
function parseArguments(args: string[]): Arguments {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  const booleans = new Set(["json", "help", "overwrite"]);
  const strings = new Set([
    "home",
    "project",
    "name",
    "title",
    "harness",
    "session",
    "source-directory",
    "input",
    "base-hash",
    "since",
    "page",
    "format",
    "out",
    "kind",
    "query",
    "version",
    "description",
    "scope",
    "view",
    "file",
    "limit",
    "cursor",
    "to",
    "id",
    "url",
    "components",
    "integrity",
  ]);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "-h") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const [key, ...inline] = argument.slice(2).split("=");
    if (Object.hasOwn(options, key))
      throw new Error(`Duplicate option --${key}.`);
    if (booleans.has(key)) {
      if (inline.length) throw new Error(`--${key} does not accept a value.`);
      options[key] = true;
    } else if (strings.has(key)) {
      const value = inline.length ? inline.join("=") : args[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`--${key} requires a value.`);
      options[key] = value;
    } else throw new Error(`Unknown option --${key}. Run showai --help.`);
  }
  return { positional, options };
}

function option(
  args: Arguments,
  name: string,
  required = false,
): string | undefined {
  const value = args.options[name];
  if (typeof value === "string" && value.trim()) return value;
  if (required) throw new Error(`--${name} is required.`);
}

async function readJson(path: string): Promise<unknown> {
  const data =
    path === "-"
      ? await new Promise<string>((resolveInput, reject) => {
          let text = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => {
            text += chunk;
            if (text.length > 10 * 1024 * 1024)
              reject(new Error("Input exceeds 10 MB."));
          });
          process.stdin.once("end", () => resolveInput(text));
          process.stdin.once("error", reject);
        })
      : await readFile(resolve(path), "utf8");
  if (Buffer.byteLength(data) > 10 * 1024 * 1024)
    throw new Error("Input exceeds 10 MB.");
  return JSON.parse(data);
}

async function readDocument(path: string): Promise<{
  document: ShowDocument;
  components?: CompiledComponent[];
  remoteComponents?: PublishedComponentLocator[];
}> {
  const input = await readJson(path);
  return input && typeof input === "object" && "format" in input
    ? parseArtifact(input)
    : { document: validateDocument(input) };
}

function binding(
  args: Arguments,
  required = false,
): ProjectBinding | undefined {
  const harness = option(args, "harness", required);
  const sessionId = option(args, "session", required);
  if (!!harness !== !!sessionId)
    throw new Error("--harness and --session must be provided together.");
  return harness && sessionId
    ? {
        harness,
        sessionId,
        ...(option(args, "source-directory")
          ? { sourceDirectory: resolve(option(args, "source-directory")!) }
          : {}),
      }
    : undefined;
}

function requireCount(args: Arguments, min: number, max = min) {
  if (args.positional.length < min || args.positional.length > max)
    throw new Error(
      "Unexpected command arguments. Run showai --help for the command syntax.",
    );
}

function objectInput(value: unknown, label = "input"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}
function catalogScope(
  args: Arguments,
  allowAll = true,
): CatalogScope | "all" | undefined {
  const value = option(args, "scope");
  if (!value) return;
  const scope = value === "user" ? "global" : value;
  if (
    ![
      "builtin",
      "global",
      "published",
      "project",
      ...(allowAll ? ["all"] : []),
    ].includes(scope)
  )
    throw new Error("--scope must be builtin, global, published or project.");
  return scope as CatalogScope | "all";
}
function catalogView(args: Arguments): CatalogView {
  const view = option(args, "view") ?? "summary";
  if (!CATALOG_VIEWS.includes(view as CatalogView))
    throw new Error(`--view must be one of ${CATALOG_VIEWS.join(", ")}.`);
  return view as CatalogView;
}
function componentMode(args: Arguments): "bundled" | "remote" {
  const mode = option(args, "components") ?? "bundled";
  if (mode !== "bundled" && mode !== "remote")
    throw new Error("--components must be bundled or remote.");
  return mode;
}
function resultLimit(args: Arguments): number | undefined {
  const text = option(args, "limit");
  if (text === undefined) return;
  if (!/^[0-9]+$/.test(text))
    throw new Error("--limit must be an integer from 1 to 50.");
  return Number(text);
}
async function saveOutput(
  service: AgentService,
  args: Arguments,
  value: unknown,
) {
  const output = option(args, "out");
  if (!output) return;
  const path = resolve(output);
  const projectId = option(args, "project");
  if (!projectId)
    throw new Error(
      "Writing a catalog/merge output requires --project; choose a project export location or an external path.",
    );
  await assertExportDestination(
    service.store.root,
    service.requireProject(projectId),
    path,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    flag: args.options.overwrite ? "w" : "wx",
  });
  return path;
}

export async function runCli(argv: string[]): Promise<unknown> {
  const args = parseArguments(argv);
  const [command, action, id] = args.positional;
  if (!command || (args.options.help && !command)) {
    process.stdout.write(CLI_HELP);
    return undefined;
  }
  const service = new AgentService({ root: option(args, "home") });
  const project = () => service.requireProject(option(args, "project"));
  if (args.options.help)
    return service.guide(
      (
        {
          projects: "workspace",
          pages: "authoring",
          catalog: "catalog",
          template: "templates",
          export: "export",
          publish: "publish",
          mcp: "workspace",
        } as Record<string, string>
      )[command],
    );
  switch (command) {
    case "guide":
      requireCount(args, 1, 2);
      return service.guide(action);
    case "projects":
      if (action === "current") {
        requireCount(args, 2);
        return service.currentProject(binding(args, true)!);
      }
      if (action === "list") {
        requireCount(args, 2);
        return service.listProjects();
      }
      if (action === "create") {
        requireCount(args, 2);
        return service.createProject(
          option(args, "name", true)!,
          binding(args),
        );
      }
      if (action === "bind") {
        requireCount(args, 3);
        return service.bindProject(id, binding(args, true)!);
      }
      break;
    case "pages":
      if (action === "list") {
        requireCount(args, 2);
        return service.listPages(project());
      }
      if (action === "create") {
        requireCount(args, 2);
        return service.createPage(project(), {
          title: option(args, "title"),
          ...(option(args, "input")
            ? await readDocument(option(args, "input")!)
            : {}),
        });
      }
      if (action === "read") {
        requireCount(args, 3);
        return service.readPage(project(), id);
      }
      if (action === "save") {
        requireCount(args, 3);
        const input = await readDocument(option(args, "input", true)!);
        return service.savePage(
          project(),
          id,
          input.document,
          option(args, "base-hash", true)!,
          input.components,
          input.remoteComponents,
        );
      }
      if (action === "apply") {
        requireCount(args, 3);
        const input = await readJson(option(args, "input", true)!);
        const operations = Array.isArray(input)
          ? input
          : input && typeof input === "object" && "operations" in input
            ? input.operations
            : undefined;
        if (!Array.isArray(operations))
          throw new Error(
            "Expected a JSON array of operations, or { operations: [...] }.",
          );
        return service.applyPage(project(), id, {
          baseHash: option(args, "base-hash", true)!,
          operations: operations as PageOperation[],
        });
      }
      if (action === "diff") {
        requireCount(args, 3);
        return service.diffPage(project(), id, option(args, "since", true)!);
      }
      break;
    case "export": {
      requireCount(args, 1);
      const format = option(args, "format", true);
      if (!["html", "inline", "site"].includes(format!))
        throw new Error("--format must be html, inline or site.");
      return service.export({
        projectId: project(),
        pageId: option(args, "page"),
        format: format as ExportFormat,
        out: option(args, "out", true)!,
        overwrite: !!args.options.overwrite,
        components: componentMode(args),
      });
    }
    case "catalog": {
      const kind = option(args, "kind") as "component" | "template" | undefined;
      if (kind && !["component", "template"].includes(kind))
        throw new Error("--kind must be component or template.");
      if (action === "list") {
        requireCount(args, 2);
        return service.catalogList({
          projectId: option(args, "project"),
          kind,
          scope: catalogScope(args),
          query: option(args, "query"),
          limit: resultLimit(args),
          cursor: option(args, "cursor"),
        });
      }
      if (action === "describe") {
        requireCount(args, 3);
        const result = await service.catalogDescribe(id, {
          projectId: option(args, "project"),
          kind,
          scope: catalogScope(args),
          version: option(args, "version"),
          integrity: option(args, "integrity"),
          view: catalogView(args),
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
      }
      if (action === "import") {
        requireCount(args, 2);
        return service.importComponent(
          resolve(option(args, "input", true)!),
          project(),
        );
      }
      if (action === "save") {
        requireCount(args, 2);
        const input = objectInput(await readJson(option(args, "input", true)!));
        return service.saveComponent(
          project(),
          objectInput(
            typeof input.source === "object" ? input.source : input,
          ) as unknown as ComponentSource,
        );
      }
      if (action === "promote" || action === "fork") {
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
          return service.promote(project(), ref, "global");
        }
        return service.fork(project(), ref, {
          id: option(args, "id"),
          version: option(args, "version", true)!,
          name: option(args, "name"),
        });
      }
      if (action === "merge") {
        requireCount(args, 3);
        const input = objectInput(await readJson(option(args, "input", true)!));
        if (input.projectId !== undefined && input.projectId !== project())
          throw new Error("The input projectId must match --project.");
        if (id === "preview") {
          const preview = await service.previewMerge(
            project(),
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
            project(),
            input as unknown as Omit<PackageMergeInput, "projectId"> & {
              id?: string;
              version: string;
              resolved: EditablePackage;
            },
          );
        }
      }
      break;
    }
    case "template": {
      if (action === "apply" || action === "instantiate") {
        requireCount(args, 3);
        return service.applyTemplate(project(), id, option(args, "title"), {
          scope: catalogScope(args, false) as CatalogScope | undefined,
          version: option(args, "version"),
          integrity: option(args, "integrity"),
        });
      }
      if (action === "save") {
        requireCount(args, 2);
        const raw = option(args, "input")
          ? objectInput(await readJson(option(args, "input")!))
          : {};
        const input = objectInput(
          raw.source ?? raw.template ?? raw,
        ) as unknown as SaveTemplateInput;
        return service.saveTemplate(project(), option(args, "page"), {
          ...input,
          ...(option(args, "id") ? { id: option(args, "id") } : {}),
          ...(option(args, "version")
            ? { version: option(args, "version") }
            : {}),
          name: option(args, "name") ?? input.name,
          description: option(args, "description") ?? input.description ?? "",
        });
      }
      break;
    }
    case "publish": {
      if (action === "list") {
        requireCount(args, 2);
        return service.publications({
          limit: resultLimit(args),
          cursor: option(args, "cursor"),
        });
      }
      if (action === "prepare") {
        requireCount(args, 2);
        const raw = await readJson(option(args, "input", true)!);
        const refs = Array.isArray(raw) ? raw : objectInput(raw).refs;
        if (!Array.isArray(refs))
          throw new Error("Publication input requires a refs array.");
        return service.preparePublication(project(), {
          refs: refs as PackageRevisionRef[],
          out: resolve(option(args, "out", true)!),
        });
      }
      if (action === "verify" || action === "register") {
        requireCount(args, 2);
        return service.verifyPublication(project(), option(args, "url", true)!);
      }
      break;
    }
    case "mcp": {
      requireCount(args, 1);
      const { startMcp } = await import("./mcp");
      await startMcp({ root: service.store.root, projectId: project() });
      return undefined;
    }
    default:
      break;
  }
  throw new Error(
    `Unknown command: ${args.positional.join(" ")}. Run showai --help.`,
  );
}

function printHuman(value: unknown) {
  if (Array.isArray(value)) {
    if (!value.length) {
      process.stdout.write("No items.\n");
      return;
    }
    process.stdout.write(
      value
        .map((item) =>
          item && typeof item === "object" && "id" in item
            ? `${item.id}\t${item.name ?? item.title ?? ""}`
            : JSON.stringify(item),
        )
        .join("\n") + "\n",
    );
  } else process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

const json = process.argv.includes("--json");
try {
  const result = await runCli(process.argv.slice(2));
  if (result !== undefined) {
    if (json)
      process.stdout.write(JSON.stringify({ ok: true, data: result }) + "\n");
    else printHuman(result);
  }
} catch (error) {
  const result = errorResult(error);
  if (json)
    process.stdout.write(JSON.stringify({ ok: false, error: result }) + "\n");
  else process.stderr.write(`ShowAI: ${result.message}\n`);
  process.exitCode = result.code === "CONFLICT" ? 3 : 1;
}
