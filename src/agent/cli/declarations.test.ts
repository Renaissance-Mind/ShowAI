import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { GLOBAL_OPTIONS, commandKey, type CommandDeclaration } from "./command";
import {
  COMMANDS,
  COMMANDS_BY_KEY,
  checkOptions,
  findCommand,
  parseArguments,
} from "./commands";
import { HELP_COMMANDS, HELP_FOOTER } from "./help";

const repository = resolve(import.meta.dirname, "../../..");
const flags = (line: string) =>
  [...line.matchAll(/--([a-z][a-z-]*)/g)].map((match) => match[1]);

/** Help lines of each command, including lines another command shares with it. */
function helpLines() {
  const lines = new Map<CommandDeclaration, string[]>();
  for (const declaration of COMMANDS) {
    if (!declaration.help) continue;
    for (const key of [commandKey(declaration), ...(declaration.covers ?? [])]) {
      const covered = COMMANDS_BY_KEY.get(key);
      if (!covered) throw new Error(`${commandKey(declaration)} covers unknown ${key}.`);
      lines.set(covered, [...(lines.get(covered) ?? []), ...declaration.help]);
    }
  }
  return lines;
}

test("every option in the help is declared by the commands its line describes", () => {
  const undeclared: string[] = [];
  for (const declaration of COMMANDS) {
    if (!declaration.help) continue;
    const covered = [commandKey(declaration), ...(declaration.covers ?? [])].map(
      (key) => COMMANDS_BY_KEY.get(key)!,
    );
    // Notes (indented lines) may mention another command's options.
    for (const line of declaration.help.filter((text) => !text.startsWith(" ")))
      for (const name of flags(line))
        if (
          !Object.hasOwn(GLOBAL_OPTIONS, name) &&
          !covered.some((item) => item.options?.[name])
        )
          undeclared.push(`${commandKey(declaration)}: --${name}`);
  }
  expect(undeclared).toEqual([]);
});

test("every declared option is in the help or marked hidden", () => {
  const lines = helpLines();
  const missing: string[] = [];
  for (const declaration of COMMANDS) {
    const shown = new Set((lines.get(declaration) ?? []).flatMap(flags));
    // Commands without help are not listed, and neither are their options.
    if (!lines.has(declaration)) continue;
    for (const [name, spec] of Object.entries(declaration.options ?? {}))
      if (!spec.hidden && !shown.has(name))
        missing.push(`${commandKey(declaration)}: --${name}`);
  }
  const everywhere = new Set(
    [...COMMANDS.flatMap((item) => item.help ?? []), ...HELP_FOOTER].flatMap(flags),
  );
  for (const [name, spec] of Object.entries(GLOBAL_OPTIONS))
    if (!spec.hidden && !everywhere.has(name)) missing.push(`global: --${name}`);
  expect(missing).toEqual([]);
});

test("the help lists every command that has help lines, once", () => {
  const listed = COMMANDS.filter((item) => item.help).map(commandKey);
  expect([...HELP_COMMANDS].sort()).toEqual(listed.sort());
  expect(new Set(HELP_COMMANDS).size).toBe(HELP_COMMANDS.length);
  // Keys are unique, so the help and lookups reach one declaration each.
  expect(COMMANDS_BY_KEY.size).toBe(COMMANDS.length);
});

test("a command rejects an option it does not declare and names itself", () => {
  const check = (argv: string[]) => {
    const args = parseArguments(argv);
    checkOptions(args, findCommand(args.positional)!);
  };
  expect(() => check(["pages", "pin", "PAGE", "--title", "x"])).toThrow(
    "showai pages pin does not take --title. Run showai --help.",
  );
  expect(() => check(["import", "notes.zip", "--view", "x"])).toThrow(
    "showai import does not take --view.",
  );
  // Global options, before or after the words, and declared ones pass.
  check(["--home", "/tmp/x", "pages", "read", "PAGE", "--view", "image", "--json"]);
  check(["mcp", "--home", "/tmp/x", "--project", "p", "--templates", "t"]);
  expect(() => parseArguments(["pages", "list", "--from", "x"])).toThrow(
    "Unknown option --from. Run showai --help.",
  );
});

function textFiles(root: string, pattern: RegExp): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return textFiles(path, pattern);
    return pattern.test(entry) ? [path] : [];
  });
}

test("documented showai command lines use options their command takes", () => {
  const sources = [
    join(repository, "src/agent/guides.ts"),
    join(repository, "src/agent/service.ts"),
    join(repository, "src/agent/catalog-service.ts"),
    join(repository, "src/agent/import-commands.ts"),
    ...textFiles(join(repository, "docs"), /\.md$/),
    ...textFiles(join(repository, "plugins"), /\.(md|mjs)$/),
    ...textFiles(join(repository, "resources/docs"), /\.json$/),
    ...textFiles(join(repository, "resources/catalog"), /\.(md|json)$/),
  ];
  const rejected: string[] = [];
  let checked = 0;
  for (const file of sources) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/\bshowai ([a-z][a-z-]*)([^`"'\n<>|;\\#]*)/g)) {
      const words = match[2].trim().split(/\s+/);
      const action = words[0] && /^[a-z][a-z-]*$/.test(words[0]) ? words[0] : undefined;
      const declaration = findCommand(action ? [match[1], action] : [match[1]]);
      if (!declaration || declaration.actions?.[0] === "*") continue;
      checked++;
      for (const name of flags(match[2]))
        if (!Object.hasOwn(GLOBAL_OPTIONS, name) && !declaration.options?.[name])
          rejected.push(
            `${file.slice(repository.length + 1)}: showai ${match[1]} ${action ?? ""} --${name}`,
          );
    }
  }
  expect(checked).toBeGreaterThan(100);
  expect(rejected).toEqual([]);
});
