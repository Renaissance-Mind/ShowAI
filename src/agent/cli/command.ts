import type { ChangeContext } from "../../core/history-model";
import type { AgentService } from "../service";

/** The words and options of one command line. */
export interface Arguments {
  positional: string[];
  options: Record<string, string | boolean>;
}

export interface OptionSpec {
  type: "string" | "boolean";
  /** Accepted but left out of the help, e.g. an option kept for older callers. */
  hidden?: true;
}
export const text: OptionSpec = { type: "string" };
export const flag: OptionSpec = { type: "boolean" };
export const hiddenText: OptionSpec = { type: "string", hidden: true };
export const hiddenFlag: OptionSpec = { type: "boolean", hidden: true };

export type Access = "read" | "write";

/** What a command's handler receives besides its arguments. */
export interface CommandScope {
  service: AgentService;
  /** The explicit --project, or the project of the host directory. */
  project(): Promise<string>;
  action: string;
  id: string;
}

export interface CommandDeclaration {
  /** The first word, e.g. "pages". */
  command: string;
  /**
   * The second words this declaration handles. Omitted: the command takes no
   * subcommand word. ["*"]: the command's answer to any other second word.
   */
  actions?: readonly string[];
  /** Options of this command besides the global ones. */
  options?: Record<string, OptionSpec>;
  /**
   * Writes run in one recorded library transaction with an operation id.
   * A function decides from the arguments (e.g. --dry-run reads only).
   */
  access?: Access | ((args: Arguments) => Access);
  /** The handler records its own changes; runCli does not wrap it. */
  ownTransaction?: true;
  /**
   * Shapes a recorded write's result. Called before the command runs, so an
   * invalid shaping option fails before anything is written.
   */
  result?: (args: Arguments) => (value: unknown) => unknown;
  /**
   * Help lines in order. Usage lines start with the command; notes start
   * with two spaces. Commands without help are not listed in showai --help.
   */
  help?: readonly string[];
  /** Other commands (keys) that this declaration's help lines also describe. */
  covers?: readonly string[];
  run(args: Arguments, scope: CommandScope): Promise<unknown>;
}

/** "pages save", "mcp", "public *". */
export const commandKey = (declaration: CommandDeclaration) =>
  declaration.actions
    ? `${declaration.command} ${declaration.actions[0]}`
    : declaration.command;

/**
 * Options every command accepts: the library and project, output, help, and
 * the change context of a write (see commandContext). runCli also reads
 * --dry-run, --revision and --response before choosing how to run a command.
 */
export const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  home: text,
  project: text,
  "source-directory": text,
  json: flag,
  help: flag,
  actor: hiddenText,
  harness: text,
  session: text,
  "operation-id": hiddenText,
  group: hiddenText,
  message: hiddenText,
  "dry-run": flag,
  revision: text,
  response: text,
};

export function option(
  args: Arguments,
  name: string,
  required = false,
): string | undefined {
  const value = args.options[name];
  if (typeof value === "string" && value.trim()) return value;
  if (required) throw new Error(`--${name} is required.`);
}

export function requireCount(args: Arguments, min: number, max = min) {
  if (args.positional.length < min || args.positional.length > max)
    throw new Error(
      "Unexpected command arguments. Run showai --help for the command syntax.",
    );
}

export const unknownCommand = (args: Arguments) =>
  new Error(
    `Unknown command: ${args.positional.join(" ")}. Run showai --help.`,
  );

export function commandContext(args: Arguments): ChangeContext {
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
