#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentService, errorResult } from "./service";
import type {
  PageOperation,
  ProjectBinding,
  ShowDocument,
} from "../core/model";
import { parseArtifact, validateDocument } from "../portable/validation.mjs";
import type { CompiledComponent } from "../components/custom/types";
import type { ExportFormat } from "./exporter";

export const CLI_HELP = `ShowAI — create, revise and deliver interactive pages.

Usage: showai <command> [options]

  projects list
  projects create --name NAME [--harness codex --session SESSION_ID]
  projects bind PROJECT --harness HARNESS --session SESSION_ID
  pages list --project PROJECT
  pages create --project PROJECT [--title TITLE] [--input page.showai.json]
  pages read PAGE --project PROJECT
  pages save PAGE --project PROJECT --input page.showai.json --base-hash HASH
  pages apply PAGE --project PROJECT --input operations.json --base-hash HASH
  pages diff PAGE --project PROJECT --since HASH
  export --project PROJECT [--page PAGE] --format html|inline|site --out PATH
  catalog list [--kind component|template] [--query TEXT]
  catalog describe ID [--kind component|template] [--version VERSION]
  catalog import --input COMPONENT_DIRECTORY [--project PROJECT]
  template apply ID --project PROJECT [--title TITLE]
  template save --project PROJECT --page PAGE --name NAME [--description TEXT]
  mcp --project PROJECT

Shared options:
  --home PATH        Data directory (default SHOWAI_HOME or ~/.showai)
  --project ID       Explicit project; never inferred from another session
  --json             Return machine-readable { ok, data } or { ok, error }
  --overwrite        Replace an existing exported deliverable
  --help             Show this help

Read a page before changing it. Keep its hash, compare with pages diff, and
pass --base-hash when saving/applying; stale writes return CONFLICT.
MCP runs over stdin/stdout and is bound to one explicitly selected project.
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

async function readDocument(
  path: string,
): Promise<{ document: ShowDocument; components?: CompiledComponent[] }> {
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

export async function runCli(argv: string[]): Promise<unknown> {
  const args = parseArguments(argv);
  const [command, action, id] = args.positional;
  if (!command || args.options.help) {
    process.stdout.write(CLI_HELP);
    return undefined;
  }
  const service = new AgentService({ root: option(args, "home") });
  const project = () => service.requireProject(option(args, "project"));
  switch (command) {
    case "projects":
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
      });
    }
    case "catalog": {
      const kind = option(args, "kind") as "component" | "template" | undefined;
      if (kind && kind !== "component" && kind !== "template")
        throw new Error("--kind must be component or template.");
      if (action === "list") {
        requireCount(args, 2);
        return service.catalogList({
          projectId: option(args, "project"),
          kind,
          query: option(args, "query"),
        });
      }
      if (action === "describe") {
        requireCount(args, 3);
        return service.catalogDescribe(id, {
          projectId: option(args, "project"),
          kind,
          version: option(args, "version"),
        });
      }
      if (action === "import") {
        requireCount(args, 2);
        return service.importComponent(
          resolve(option(args, "input", true)!),
          option(args, "project"),
        );
      }
      break;
    }
    case "template": {
      if (action === "apply" || action === "instantiate") {
        requireCount(args, 3);
        return service.applyTemplate(project(), id, option(args, "title"));
      }
      if (action === "save") {
        requireCount(args, 2);
        return service.saveTemplate(project(), option(args, "page", true)!, {
          name: option(args, "name", true)!,
          description: option(args, "description") ?? "",
        });
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
