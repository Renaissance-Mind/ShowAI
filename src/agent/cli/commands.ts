import {
  GLOBAL_OPTIONS,
  commandKey,
  type Arguments,
  type CommandDeclaration,
  type OptionSpec,
} from "./command";
import { catalogCommands } from "./catalog";
import { connectionCommands } from "./connections";
import { datasetCommands } from "./datasets";
import { libraryCommands } from "./library";
import { pageCommands } from "./pages";
import { presentationCommands } from "./presentation";
import { projectCommands } from "./projects";

export const COMMANDS: readonly CommandDeclaration[] = [
  ...presentationCommands,
  ...connectionCommands,
  ...projectCommands,
  ...pageCommands,
  ...datasetCommands,
  ...catalogCommands,
  ...libraryCommands,
];

export const COMMANDS_BY_KEY = new Map(
  COMMANDS.map((declaration) => [commandKey(declaration), declaration]),
);

/**
 * The declaration that handles these words: the one naming the second word,
 * else the command without subcommands, else the command's answer to any
 * other second word.
 */
export function findCommand(positional: string[]) {
  const [command, action] = positional;
  const own = COMMANDS.filter((item) => item.command === command);
  return (
    own.find((item) => item.actions?.includes(action)) ??
    own.find((item) => !item.actions) ??
    own.find((item) => item.actions?.[0] === "*")
  );
}

/** Every option name with its value type; a name has one type everywhere. */
export const OPTION_TYPES: ReadonlyMap<string, OptionSpec["type"]> = (() => {
  const types = new Map<string, OptionSpec["type"]>();
  for (const options of [
    GLOBAL_OPTIONS,
    ...COMMANDS.map((item) => item.options ?? {}),
  ])
    for (const [name, spec] of Object.entries(options)) {
      if (types.has(name) && types.get(name) !== spec.type)
        throw new Error(`--${name} is declared with two value types.`);
      types.set(name, spec.type);
    }
  return types;
})();

export function parseArguments(args: string[]): Arguments {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
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
    const type = OPTION_TYPES.get(key);
    if (type === "boolean") {
      if (inline.length) throw new Error(`--${key} does not accept a value.`);
      options[key] = true;
    } else if (type === "string") {
      const value = inline.length ? inline.join("=") : args[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`--${key} requires a value.`);
      options[key] = value;
    } else throw new Error(`Unknown option --${key}. Run showai --help.`);
  }
  return { positional, options };
}

/** Rejects an option the command does not declare, naming the command. */
export function checkOptions(args: Arguments, declaration: CommandDeclaration) {
  if (declaration.actions?.[0] === "*") return;
  const named = declaration.actions
    ? args.positional.slice(0, 2).join(" ")
    : declaration.command;
  for (const name of Object.keys(args.options))
    if (!Object.hasOwn(GLOBAL_OPTIONS, name) && !declaration.options?.[name])
      throw new Error(
        `showai ${named} does not take --${name}. Run showai --help.`,
      );
}
