import type { ChangeContext } from "../../core/history-model";
import type { AgentService } from "../service";
import { parseInput, type Operation } from "../operations/operation";

export interface Arguments {
  positional: string[];
  options: Record<string, string | boolean>;
}

export interface OptionSpec {
  type: "string" | "boolean";
  hidden?: true;
}
export const text: OptionSpec = { type: "string" };
export const flag: OptionSpec = { type: "boolean" };
export const hiddenText: OptionSpec = { type: "string", hidden: true };
export const hiddenFlag: OptionSpec = { type: "boolean", hidden: true };

export type Access = "read" | "write";

export interface CommandScope {
  service: AgentService;
  project(): Promise<string>;
  action: string;
  id: string;
}

export interface CommandDeclaration {
  command: string;
  actions?: readonly string[];
  options?: Record<string, OptionSpec>;
  access?: Access | ((args: Arguments) => Access);
  ownTransaction?: true;
  result?: (args: Arguments) => (value: unknown) => unknown;
  help?: readonly string[];
  covers?: readonly string[];
  operation?: Operation<any>;
  input?(args: Arguments, scope: CommandScope): Promise<Record<string, unknown>>;
  fields?: Record<string, string>;
  run?(args: Arguments, scope: CommandScope): Promise<unknown>;
}

export async function runCommand(
  declaration: CommandDeclaration,
  args: Arguments,
  scope: CommandScope,
) {
  if (declaration.run) return declaration.run(args, scope);
  const shared = declaration.operation!;
  const input = parseInput(
    shared,
    await declaration.input!(args, scope),
    declaration.fields,
  );
  return shared.run(
    { service: scope.service, projectId: await scope.project() },
    input,
  );
}

export function commandAccess(declaration: CommandDeclaration, args: Arguments) {
  const access = declaration.access ?? declaration.operation?.access;
  return typeof access === "function" ? access(args) : access;
}

export const commandKey = (declaration: CommandDeclaration) =>
  declaration.actions
    ? `${declaration.command} ${declaration.actions[0]}`
    : declaration.command;

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
