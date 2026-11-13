#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { withChangeContext } from "../core/history-context";
import { mutateLibrary } from "../core/library-runtime";
import { canonicalJson } from "../core/diff";
import { stopSyncManagers } from "../sync/manager";
import { openLibrary } from "../core/open-library";
import { followAppLanguage } from "../core/app-language";
import { AgentService, errorResult, type FailedOperation } from "./service";
import {
  commandContext,
  option,
  unknownCommand,
  type Arguments,
  type CommandDeclaration,
} from "./cli/command";
import { checkOptions, findCommand, parseArguments } from "./cli/commands";
import { cliHelp } from "./cli/help";

// The command line: words and options are parsed against the command
// declarations in ./cli, which also produce the help text.

export const CLI_HELP = cliHelp();

/** The guide topic `showai COMMAND --help` prints. */
const HELP_TOPICS: Record<string, string> = {
  projects: "workspace",
  pages: "authoring",
  catalog: "catalog",
  template: "templates",
  export: "export",
  publish: "publish",
  mcp: "workspace",
  sync: "sync",
  import: "import",
  importers: "import",
};

async function runCliCommand(
  args: Arguments,
  declaration: CommandDeclaration | undefined,
): Promise<unknown> {
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
  if (args.options.help) return service.guide(HELP_TOPICS[command]);
  if (!declaration) throw unknownCommand(args);
  return declaration.run(args, { service, project, action, id });
}

export async function runCli(argv: string[]): Promise<unknown> {
  const args = parseArguments(argv);
  const declaration = findCommand(args.positional);
  if (declaration) checkOptions(args, declaration);
  const context = commandContext(args);
  const [command, action] = args.positional;
  if (
    !["library", "render", "public"].includes(command) &&
    !(command === "mcp" && (action === "serve" || args.options.public)) &&
    !args.options.help
  ) {
    const root = new AgentService({ root: option(args, "home") }).store.root;
    await openLibrary(root);
    // The browser workbench sets its own language; other commands speak the App's.
    if (command !== "serve") await followAppLanguage(root);
  }
  const access =
    typeof declaration?.access === "function"
      ? declaration.access(args)
      : declaration?.access;
  // Writes run in one recorded transaction unless the handler records its own.
  const mutation = access === "write" && !declaration?.ownTransaction;
  if (!mutation || args.options.help)
    return withChangeContext(context, () => runCliCommand(args, declaration));
  const shape = declaration!.result?.(args);
  const requestFingerprint = createHash("sha256")
    .update(
      canonicalJson({
        positional: args.positional,
        options: {
          ...args.options,
          "operation-id": undefined,
          json: undefined,
          response: undefined,
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
  const result = await withChangeContext(marked, () =>
    mutateLibrary(
      service.store.root,
      () => runCliCommand(args, declaration),
      marked,
    ),
  );
  return shape ? shape(result) : result;
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

/** The step a failed command was taking, for the error's user message. */
function cliOperation(argv: string[]): FailedOperation | undefined {
  const [command, action] = parseArguments(argv).positional;
  if (command === "export") return "export";
  if (command === "render") return "present";
  return ["save", "apply", "create", "duplicate", "link", "transform", "import"].includes(action)
    ? "save"
    : undefined;
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
  const result = errorResult(error, cliOperation(process.argv.slice(2)));
  if (json)
    process.stdout.write(JSON.stringify({ ok: false, error: result }) + "\n");
  else process.stderr.write(`ShowAI: ${result.message}\n`);
  process.exitCode = result.code === "CONFLICT" ? 3 : 1;
} finally {
  if (!continuous) await stopSyncManagers();
}
