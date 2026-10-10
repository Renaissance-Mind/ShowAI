#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { withChangeContext } from "../core/history-context";
import { mutateLibrary } from "../core/library-runtime";
import { canonicalJson } from "../core/diff";
import { ContentLibrary as GitLibrary } from "../core/content-library";
import { syncManager, stopSyncManagers } from "../sync/manager";
import { openLibrary } from "../core/open-library";
import { LibraryImport } from "../core/library-import";
import {
  LibraryMaintenance,
  verifyLibraryArchive,
} from "../core/library-maintenance";
import {
  maintenancePolicy,
  setMaintenancePolicy,
} from "../core/maintenance-scheduler";
import type { ChangeContext } from "../core/history-model";
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
import { runtimeInfo, registerRuntime } from "./runtime";
import type { PageReadOptions } from "./page-reading";
import {
  describePublicResource,
  publicCatalog,
  renderPresentation,
  writePresentation,
} from "./presentation";

export const CLI_HELP = `ShowAI — interactive pages shared by people and Agents.

Local browser workbench (same files as the desktop app and CLI):
  serve [--home PATH] [--port PORT] [--no-open]

Independent presentation (no personal project or synchronization required):
  public list [--kind component|template] [--query TEXT]
  public describe ID [--kind component|template] [--view guide|schema|examples|source]
  render --input INPUT_JSON --out PAGE.html [--overwrite]
  render --template TEMPLATE_ID --title TITLE --out PAGE.html

MCP connections:
  mcp [--project PROJECT] [--presentation-directory PATH]
  mcp --public
  mcp serve --state DIRECTORY --public-url HTTPS_ORIGIN [--sync-server SERVER_ORIGIN] [--port 8789]

Start with one project:
  runtime info | runtime register
  projects current [--source-directory PROJECT_DIRECTORY] [--project ID]
  projects list
  projects create --name NAME [--harness HOST --session SESSION_ID]
  projects bind PROJECT --harness HOST --session SESSION_ID
  pages list --project PROJECT

Discover only what you need:
  guide [workspace|reading|authoring|containers|document|catalog|component|templates|versions|history|sync|export|publish]
  catalog list [--kind component|template] [--scope SCOPE] [--limit N --cursor CURSOR]
  catalog describe ID [--kind component|template] [--view VIEW]

Display a full page or selected blocks:
  export --project PROJECT --page PAGE [--blocks ID,ID] --format html|inline --out PATH

Read one Page through structured data, an image or interactive HTML:
  pages read PAGE --project PROJECT [--view structured|image|html] [--blocks ID,ID]
  pages read PAGE --project PROJECT --format markdown [--detail full|outline]
  pages read PAGE --project PROJECT --view image --theme dark --width 1000 --height 900 --out preview.png
  pages read PAGE --project PROJECT --view html [--state reading-state.json] --out preview.html

Versioned libraries: library init | verify | compact
  library stats | cleanup-plan [--older-than-days DAYS] | cleanup PLAN_ID
  library rebuild-index | policy [--automatic true|false]
  library archive --out ABSOLUTE_NEW_DIRECTORY | verify-archive ARCHIVE_DIRECTORY
  library import --source OLD_PATH --home NEW_OR_SAME_PATH
  library activate IMPORT_ID --home PATH
  library migrate --home PATH (prepare, verify and activate in place; retain originals)
  library imports --home PATH
  history imported --project ID [--page ID]
  history snapshot PAGE --project ID --import IMPORT_ID --snapshot SNAPSHOT_ID
  history restore-snapshot PAGE --project ID --import IMPORT_ID --snapshot SNAPSHOT_ID --base-revision CURRENT_REVISION
  search --query TEXT [--project ID] [--kind page|component|template|project|source]
  history list [--project ID] [--page ID] [--session SESSION_ID]
  history read PAGE --project ID --revision REVISION
  history compare --before REVISION --after REVISION [--project ID] [--page ID]
  history restore PAGE --project ID --revision REVISION --base-revision CURRENT_REVISION
  history merge PAGE --project ID --input DRAFT --base-revision BASE [--revision CURRENT_TO_SAVE]
  history conflicts [--project ID] | conflict CONFLICT_ID | resolve CONFLICT_ID --resolution discard|import|merge
Shared: --home PATH, --project ID, --json, --help.
Project defaults to the host project directory (Git root of cwd); --project overrides it.
Shared promotion/registration is explicit.
Use showai guide TOPIC for exact authoring, versioning and delivery commands.
`;

interface Arguments {
  positional: string[];
  options: Record<string, string | boolean>;
}
function parseArguments(args: string[]): Arguments {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  const booleans = new Set([
    "json",
    "help",
    "overwrite",
    "no-open",
    "draft",
    "public",
  ]);
  const strings = new Set([
    "state",
    "public-url",
    "sync-server",
    "widget-domain",
    "presentation-directory",
    "host",
    "template",
    "home",
    "automatic",
    "older-than-days",
    "source",
    "import",
    "snapshot",
    "port",
    "project",
    "name",
    "title",
    "kind",
    "harness",
    "session",
    "source-directory",
    "input",
    "base-hash",
    "base-revision",
    "message",
    "operation-id",
    "group",
    "actor",
    "since",
    "revision",
    "before",
    "after",
    "from",
    "until",
    "resolution",
    "path",
    "page",
    "blocks",
    "format",
    "presentation",
    "parent",
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
    "detail",
    "theme",
    "width",
    "height",
    "state",
    "rendered",
    "connection",
    "account",
    "password-file",
    "token-file",
    "registration-key-file",
    "invite",
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
  const projectId =
    option(args, "project") ??
    (
      await service.currentProject({
        sourceDirectory: option(args, "source-directory"),
      })
    ).project.id;
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

async function runCliCommand(argv: string[]): Promise<unknown> {
  const args = parseArguments(argv);
  const [command, action, id] = args.positional;
  if (!command || (args.options.help && !command)) {
    process.stdout.write(CLI_HELP);
    return undefined;
  }
  if (command === "serve" && args.options.help) {
    process.stdout.write(
      "showai serve [--home PATH] [--port PORT] [--no-open] [--json]\nStart the local browser workbench. Default port: a free loopback port.\n",
    );
    return undefined;
  }
  const service = new AgentService({ root: option(args, "home") });
  let resolvedProject: Promise<string> | undefined;
  const project = (): Promise<string> => {
    const explicit = option(args, "project");
    if (explicit) return Promise.resolve(service.requireProject(explicit));
    return (resolvedProject ??= service
      .currentProject({
        sourceDirectory: option(args, "source-directory"),
      })
      .then((result) => result.project.id));
  };
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
          sync: "sync",
        } as Record<string, string>
      )[command],
    );
  switch (command) {
    case "public": {
      if (action === "list")
        return publicCatalog({
          kind: option(args, "kind") as "component" | "template" | undefined,
          query: option(args, "query"),
          cursor: option(args, "cursor"),
          limit: option(args, "limit")
            ? Number(option(args, "limit"))
            : undefined,
        });
      if (action === "describe" && id)
        return describePublicResource(id, {
          kind: option(args, "kind") as "component" | "template" | undefined,
          view: option(args, "view") as
            "guide" | "schema" | "examples" | "source" | undefined,
          file: option(args, "file"),
        });
      throw new Error("Use public list or public describe ID.");
    }
    case "render": {
      requireCount(args, 1);
      const inputPath = option(args, "input"),
        templateId = option(args, "template");
      if (!!inputPath === !!templateId)
        throw new Error("Provide --input or --template.");
      const input = inputPath
        ? objectInput(await readJson(inputPath))
        : { templateId };
      const presentation = await renderPresentation({
        ...("format" in input
          ? {
              document: parseArtifact(input).document,
              ...(Array.isArray(input.componentSources)
                ? { componentSources: input.componentSources }
                : {}),
            }
          : input),
        ...(option(args, "title") ? { title: option(args, "title") } : {}),
      });
      const out = option(args, "out", true)!;
      await assertExportDestination(
        service.store.root,
        "presentation",
        resolve(out),
      );
      return writePresentation(presentation, out, !!args.options.overwrite);
    }
    case "sync": {
      const manager = syncManager(service.store.root);
      const credential = async (fileOption: string, environment: string) => {
        const path = option(args, fileOption);
        return path
          ? (await readFile(resolve(path), "utf8")).trim()
          : process.env[environment];
      };
      if (action === "status") return manager.status();
      if (action === "retained")
        return manager.retainedConflicts(id ?? (await project()));
      if (action === "connect")
        return manager.connect({
          url: option(args, "url", true)!,
          account: option(args, "account"),
          password: await credential("password-file", "SHOWAI_SERVER_PASSWORD"),
          token: await credential("token-file", "SHOWAI_SERVER_TOKEN"),
          registrationKey: await credential(
            "registration-key-file",
            "SHOWAI_REGISTRATION_KEY",
          ),
          register: option(args, "view") === "register",
          invite: option(args, "invite"),
        });
      if (action === "default")
        return manager.setDefault(option(args, "connection") ?? null);
      if (action === "projects")
        return manager.remoteProjects(option(args, "connection", true)!);
      if (action === "attach")
        return manager.attach(
          option(args, "connection", true)!,
          id ?? (await project()),
        );
      if (action === "join")
        return manager.join(
          option(args, "connection", true)!,
          option(args, "url", true)!,
        );
      if (action === "subscribe")
        return manager.subscribe(option(args, "connection", true)!, id);
      if (action === "detach") return manager.detach(id ?? (await project()));
      if (action === "account")
        return manager.changeAccount(
          id ?? (await project()),
          option(args, "connection", true)!,
        );
      if (action === "run") return manager.run(option(args, "project"));
      if (action === "conflict")
        return manager.conflict(id ?? (await project()));
      if (action === "resolve")
        return manager.resolveConflict(
          id ?? (await project()),
          (await readJson(option(args, "input", true)!)) as Record<
            string,
            "local" | "remote"
          >,
        );
      if (action === "dashboard")
        return manager.dashboard(
          option(args, "connection", true)!,
          option(args, "project"),
        );
      if (action === "disconnect")
        return manager.disconnect(option(args, "connection", true)!);
      throw new Error(
        "Use sync status/connect/default/projects/attach/join/subscribe/detach/account/run/conflict/resolve/dashboard/disconnect.",
      );
    }
    case "library": {
      if (action === "stats") {
        requireCount(args, 2);
        return new LibraryMaintenance(service.store.root).storage();
      }
      if (action === "cleanup-plan") {
        requireCount(args, 2);
        return new LibraryMaintenance(service.store.root).prepareCleanup({
          olderThanDays: option(args, "older-than-days")
            ? Number(option(args, "older-than-days"))
            : undefined,
        });
      }
      if (action === "cleanup") {
        requireCount(args, 3);
        return new LibraryMaintenance(service.store.root).cleanup(
          args.positional[2],
        );
      }
      if (action === "rebuild-index") {
        requireCount(args, 2);
        return {
          revision: await new LibraryMaintenance(
            service.store.root,
          ).rebuildIndex(),
        };
      }
      if (action === "archive") {
        requireCount(args, 2);
        return new LibraryMaintenance(service.store.root).archive(
          option(args, "out", true)!,
        );
      }
      if (action === "verify-archive") {
        requireCount(args, 3);
        return verifyLibraryArchive(resolve(args.positional[2]));
      }
      if (action === "policy") {
        requireCount(args, 2);
        const automatic = option(args, "automatic");
        if (!automatic) return maintenancePolicy(service.store.root);
        if (!["true", "false"].includes(automatic))
          throw new Error("--automatic must be true or false.");
        return setMaintenancePolicy(service.store.root, {
          automatic: automatic === "true",
        });
      }
      const importer = new LibraryImport(service.store.root);
      if (action === "import") {
        requireCount(args, 2);
        return importer.prepare(option(args, "source") ?? service.store.root);
      }
      if (action === "imports") {
        requireCount(args, 2);
        return importer.list();
      }
      if (action === "activate") {
        requireCount(args, 3);
        return importer.activate(args.positional[2]);
      }
      if (action === "migrate") {
        requireCount(args, 2);
        const report = await importer.prepare(service.store.root);
        return importer.activate(report.id);
      }
      if (action === "init") {
        requireCount(args, 2);
        return new GitLibrary(service.store.root).initialize();
      }
      if (action === "verify") {
        requireCount(args, 2);
        await new GitLibrary(service.store.root).verify();
        return { verified: true };
      }
      if (action === "compact") {
        requireCount(args, 2);
        return new LibraryMaintenance(service.store.root).compact();
      }
      break;
    }
    case "search": {
      requireCount(args, 1);
      return service.search({
        query: option(args, "query", true)!,
        projectId: option(args, "project"),
        kind: option(args, "kind") as
          "page" | "component" | "template" | "project" | "source" | undefined,
        limit: option(args, "limit")
          ? Number(option(args, "limit"))
          : undefined,
        cursor: option(args, "cursor"),
      });
    }
    case "history": {
      if (action === "imported") {
        requireCount(args, 2);
        return service.importedSnapshots(await project(), option(args, "page"));
      }
      if (action === "snapshot" || action === "restore-snapshot") {
        requireCount(args, 3);
        const input = {
          projectId: await project(),
          pageId: args.positional[2],
          importId: option(args, "import", true)!,
          snapshotId: option(args, "snapshot", true)!,
        };
        if (action === "snapshot")
          return service.importedPage(input.projectId, input.pageId, input);
        const baseRevision = option(args, "base-revision", true)!;
        return service.restoreImportedSnapshot({
          ...input,
          baseRevision: baseRevision === "absent" ? null : baseRevision,
        });
      }
      if (action === "list") {
        requireCount(args, 2);
        return service.history({
          projectId: option(args, "project"),
          pageId: option(args, "page"),
          path: option(args, "path"),
          harness: option(args, "harness"),
          sessionId: option(args, "session"),
          query: option(args, "query"),
          from: option(args, "from"),
          to: option(args, "until"),
          before: option(args, "cursor"),
          limit: option(args, "limit")
            ? Number(option(args, "limit"))
            : undefined,
        });
      }
      if (action === "compare") {
        requireCount(args, 2);
        return service.compareHistory(
          option(args, "before", true)!,
          option(args, "after", true)!,
          { projectId: option(args, "project"), pageId: option(args, "page") },
        );
      }
      if (action === "read") {
        requireCount(args, 3);
        if (option(args, "view") === "html") {
          const rendered = await service.historicalHtml(
            await project(),
            id,
            option(args, "revision", true)!,
          );
          const out = option(args, "out");
          if (out)
            return service.export({
              projectId: await project(),
              pageId: id,
              revision: option(args, "revision", true)!,
              format: "html",
              out,
              overwrite: !!args.options.overwrite,
            });
          return rendered;
        }
        return service.historicalPage(
          await project(),
          id,
          option(args, "revision", true)!,
        );
      }
      if (action === "restore") {
        requireCount(args, 3);
        return service.restorePage({
          projectId: await project(),
          pageId: id,
          revision: option(args, "revision", true)!,
          baseRevision: option(args, "base-revision", true)!,
        });
      }
      if (action === "merge") {
        requireCount(args, 3);
        const document = (await readDocument(option(args, "input", true)!))
          .document;
        const selection = {
          projectId: await project(),
          pageId: id,
          baseRevision: option(args, "base-revision", true)!,
          document,
        };
        return option(args, "revision")
          ? service.pageMergeSave({
              ...selection,
              currentRevision: option(args, "revision", true)!,
            })
          : service.pageMergePreview(selection);
      }
      if (action === "conflicts") {
        requireCount(args, 2);
        return service.workspaceConflicts(option(args, "project"));
      }
      if (action === "recover-package") {
        requireCount(args, 3);
        return service.recoverPackageConflict({
          id: args.positional[2],
          clientId: `cli:${commandContext(args).actor.sessionId ?? "local-recovery"}`,
          targetProjectId: option(args, "project"),
        });
      }
      if (action === "conflict") {
        requireCount(args, 3);
        return service.workspaceConflict(id);
      }
      if (action === "resolve") {
        requireCount(args, 3);
        const resolution = option(args, "resolution", true);
        if (!resolution || !["discard", "import", "merge"].includes(resolution))
          throw new Error("--resolution must be discard, import or merge.");
        return service.resolveWorkspaceConflict({
          id,
          resolution: resolution as "discard" | "import" | "merge",
          document: option(args, "input")
            ? (await readDocument(option(args, "input")!)).document
            : undefined,
        });
      }
      break;
    }
    case "serve": {
      requireCount(args, 1);
      const { runBrowser } = await import("../browser/launch");
      await runBrowser({
        home: option(args, "home"),
        port: option(args, "port"),
        open: !args.options["no-open"],
        json: !!args.options.json,
      });
      return undefined;
    }
    case "runtime": {
      requireCount(args, 2);
      const info = await runtimeInfo(service.store.root);
      if (args.positional[1] === "info") return info;
      if (args.positional[1] === "register")
        return registerRuntime(service.store.root, info.launch);
      throw new Error("Use runtime info or runtime register.");
    }
    case "guide":
      requireCount(args, 1, 2);
      return service.guide(action);
    case "projects":
      if (action === "current") {
        requireCount(args, 2);
        return service.currentProject({
          projectId: option(args, "project"),
          sourceDirectory: option(args, "source-directory"),
        });
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
        return service.listPages(await project());
      }
      if (action === "create") {
        requireCount(args, 2);
        return service.createPage(await project(), {
          title: option(args, "title"),
          kind: option(args, "kind") as "page" | "board" | undefined,
          ...(option(args, "input")
            ? await readDocument(option(args, "input")!)
            : {}),
        });
      }
      if (action === "read") {
        requireCount(args, 3);
        const state = option(args, "state")
          ? await readJson(option(args, "state")!)
          : {};
        if (!state || typeof state !== "object" || Array.isArray(state))
          throw new Error(
            "--state must contain Page reading options such as actions, viewport and draft.",
          );
        const readOptions: PageReadOptions = { ...state };
        const view = option(args, "view");
        if (view) readOptions.view = view as PageReadOptions["view"];
        const format = option(args, "format");
        if (format) readOptions.format = format as PageReadOptions["format"];
        const detail = option(args, "detail");
        if (detail) readOptions.detail = detail as PageReadOptions["detail"];
        const theme = option(args, "theme");
        if (theme) readOptions.theme = theme as PageReadOptions["theme"];
        const blocks = option(args, "blocks");
        if (blocks) readOptions.blockIds = blocks.split(",");
        const width = option(args, "width"),
          height = option(args, "height");
        if (width || height)
          readOptions.viewport = {
            width: width
              ? Number(width)
              : (readOptions.viewport?.width ?? 1000),
            height: height
              ? Number(height)
              : (readOptions.viewport?.height ?? 900),
          };
        const presentation = option(args, "presentation");
        if (presentation)
          readOptions.presentation =
            presentation as PageReadOptions["presentation"];
        const rendered = option(args, "rendered");
        if (rendered) {
          if (!["true", "false"].includes(rendered))
            throw new Error("--rendered must be true or false.");
          readOptions.rendered = rendered === "true";
        }
        if (args.options.draft) readOptions.draft = true;
        if (args.options.overwrite) readOptions.overwrite = true;
        const out = option(args, "out");
        if (out) readOptions.out = out;
        const hash = option(args, "base-hash");
        if (hash) readOptions.expectedHash = hash;
        return service.readPage(await project(), id, readOptions);
      }
      if (action === "save") {
        requireCount(args, 3);
        const input = await readDocument(option(args, "input", true)!);
        return service.savePage(
          await project(),
          id,
          input.document,
          option(args, "base-hash", true)!,
          input.components,
          input.remoteComponents,
          option(args, "base-revision"),
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
        return service.applyPage(await project(), id, {
          baseHash: option(args, "base-hash", true)!,
          baseRevision: option(args, "base-revision"),
          operations: operations as PageOperation[],
        });
      }
      if (action === "diff") {
        requireCount(args, 3);
        return service.diffPage(
          await project(),
          id,
          option(args, "since", true)!,
        );
      }
      break;
    case "export": {
      requireCount(args, 1);
      const format = option(args, "format", true);
      if (!["html", "inline", "site"].includes(format!))
        throw new Error("--format must be html, inline or site.");
      return service.export({
        projectId: await project(),
        pageId: option(args, "page"),
        ...(Object.hasOwn(args.options, "blocks")
          ? {
              blockIds: option(args, "blocks", true)!
                .split(",")
                .map((id) => id.trim()),
            }
          : {}),
        format: format as ExportFormat,
        out: option(args, "out", true)!,
        overwrite: !!args.options.overwrite,
        components: componentMode(args),
        revision: option(args, "revision"),
        ...(option(args, "import") || option(args, "snapshot")
          ? {
              importedSnapshot: {
                importId: option(args, "import", true)!,
                snapshotId: option(args, "snapshot", true)!,
              },
            }
          : {}),
        presentation: option(args, "presentation") as
          "spatial" | "reading" | undefined,
      });
    }
    case "catalog": {
      const kind = option(args, "kind") as "component" | "template" | undefined;
      if (kind && !["component", "template"].includes(kind))
        throw new Error("--kind must be component or template.");
      if (action === "list") {
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
      }
      if (action === "describe") {
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
          await project(),
        );
      }
      if (action === "save") {
        requireCount(args, 2);
        const input = objectInput(await readJson(option(args, "input", true)!));
        return service.saveComponent(
          await project(),
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
          return service.promote(await project(), ref, "global");
        }
        return service.fork(await project(), ref, {
          id: option(args, "id"),
          version: option(args, "version", true)!,
          name: option(args, "name"),
        });
      }
      if (action === "merge") {
        requireCount(args, 3);
        const input = objectInput(await readJson(option(args, "input", true)!));
        if (
          input.projectId !== undefined &&
          input.projectId !== (await project())
        )
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
      }
      break;
    }
    case "template": {
      if (action === "apply" || action === "instantiate") {
        requireCount(args, 3);
        return service.applyTemplate(
          await project(),
          id,
          option(args, "title"),
          {
            scope: catalogScope(args, false) as CatalogScope | undefined,
            version: option(args, "version"),
            integrity: option(args, "integrity"),
            pageId: option(args, "page"),
            baseRevision: option(args, "base-revision"),
            baseHash: option(args, "page")
              ? option(args, "base-hash", true)
              : undefined,
            parentId: option(args, "parent"),
          },
        );
      }
      if (action === "save") {
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
        return service.preparePublication(await project(), {
          refs: refs as PackageRevisionRef[],
          out: resolve(option(args, "out", true)!),
        });
      }
      if (action === "verify" || action === "register") {
        requireCount(args, 2);
        return service.verifyPublication(
          await project(),
          option(args, "url", true)!,
        );
      }
      break;
    }
    case "mcp": {
      if (action === "serve") {
        requireCount(args, 2);
        const { startMcpHttpServer } = await import("./mcp-http");
        const running = await startMcpHttpServer({
          stateDirectory: resolve(
            option(args, "state") ??
              join(service.store.root, "local", "agent-server"),
          ),
          publicUrl: option(args, "public-url"),
          syncServers: option(args, "sync-server")?.split(",").filter(Boolean),
          widgetDomain: option(args, "widget-domain"),
          host: option(args, "host"),
          port: option(args, "port") ? Number(option(args, "port")) : undefined,
        });
        process.stdout.write(
          JSON.stringify({
            ok: true,
            data: {
              protocol: "showai-agent-http-v1",
              url: running.url + "/mcp",
              publicPresentation: true,
              privateProjects: !!option(args, "sync-server"),
            },
          }) + "\n",
        );
        const stop = () => {
          void running.close().then(
            () => process.exit(0),
            (error) => {
              console.error(error);
              process.exit(1);
            },
          );
        };
        process.once("SIGTERM", stop);
        process.once("SIGINT", stop);
        return undefined;
      }
      if (args.options.public) {
        requireCount(args, 1);
        if (option(args, "project"))
          throw new Error("Choose --public or --project.");
        const { startPublicMcp } = await import("./mcp");
        await startPublicMcp(service.store.root);
        return undefined;
      }
      requireCount(args, 1);
      const presentationDirectory = option(args, "presentation-directory")
        ? resolve(option(args, "presentation-directory")!)
        : undefined;
      if (!option(args, "project")) {
        const { startLibraryMcp } = await import("./mcp-library");
        await startLibraryMcp({
          root: service.store.root,
          presentationDirectory,
        });
      } else {
        const { startMcp } = await import("./mcp");
        await startMcp({
          root: service.store.root,
          projectId: await project(),
          presentationDirectory,
        });
      }
      return undefined;
    }
    default:
      break;
  }
  throw new Error(
    `Unknown command: ${args.positional.join(" ")}. Run showai --help.`,
  );
}

function commandContext(args: Arguments): ChangeContext {
  const kind = option(args, "actor");
  if (kind && !["human", "agent", "system", "unknown"].includes(kind))
    throw new Error("--actor must be human, agent, system or unknown.");
  const sessionId = option(args, "session") ?? process.env.CODEX_THREAD_ID;
  const harness =
    option(args, "harness") ??
    (process.env.CODEX_THREAD_ID ? "codex" : undefined);
  const actor =
    kind && kind !== "agent"
      ? { kind: kind as "human" | "system" | "unknown" }
      : sessionId && harness
        ? { kind: "agent" as const, harness, sessionId }
        : kind === "agent"
          ? undefined
          : { kind: "unknown" as const };
  if (!actor)
    throw new Error(
      "Agent attribution requires a real --harness and --session, or CODEX_THREAD_ID.",
    );
  return {
    actor,
    channel: "cli",
    operationId: option(args, "operation-id"),
    groupId: option(args, "group"),
    message: option(args, "message"),
  };
}
export async function runCli(argv: string[]): Promise<unknown> {
  const args = parseArguments(argv);
  const context = commandContext(args);
  const [command, action, mode] = args.positional;
  if (
    !["library", "render", "public"].includes(command) &&
    !(command === "mcp" && (action === "serve" || args.options.public)) &&
    !args.options.help
  )
    await openLibrary(
      new AgentService({ root: option(args, "home") }).store.root,
    );
  const mutation =
    (command === "projects" &&
      ["current", "create", "bind"].includes(action)) ||
    (command === "pages" && ["create", "save", "apply"].includes(action)) ||
    (command === "template" &&
      ["apply", "instantiate", "save"].includes(action)) ||
    (command === "catalog" &&
      (["import", "save", "promote", "fork"].includes(action) ||
        (action === "merge" && mode === "resolve"))) ||
    (command === "publish" && ["verify", "register"].includes(action)) ||
    (command === "history" &&
      (action === "restore" ||
        action === "restore-snapshot" ||
        (action === "merge" && !!option(args, "revision"))));
  if (!mutation || args.options.help)
    return withChangeContext(context, () => runCliCommand(argv));
  const requestFingerprint = createHash("sha256")
    .update(
      canonicalJson({
        positional: args.positional,
        options: {
          ...args.options,
          "operation-id": undefined,
          json: undefined,
        },
      }),
    )
    .digest("hex");
  const marked = {
    ...context,
    operationId: context.operationId ?? randomUUID(),
    requestFingerprint,
    message: context.message ?? args.positional.join(" "),
  };
  const service = new AgentService({ root: option(args, "home") });
  return withChangeContext(marked, () =>
    mutateLibrary(service.store.root, () => runCliCommand(argv), marked),
  );
}

function printHuman(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "format" in value &&
    value.format === "markdown" &&
    "markdown" in value
  ) {
    process.stdout.write(String(value.markdown) + "\n");
    return;
  }
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
let continuous = false;
try {
  continuous = ["serve", "mcp"].includes(
    parseArguments(process.argv.slice(2)).positional[0],
  );
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
} finally {
  if (!continuous) await stopSyncManagers();
}
