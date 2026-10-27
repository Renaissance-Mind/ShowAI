import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { getObjectShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLibraryMcpServer } from "./mcp-library";
import { actionFields, registeredTools, RENAMED_TOOLS } from "./mcp-compat";
import { getMcpGuide } from "./mcp-guides";
import { GUIDE_TOPICS } from "./guides";
import { PAGE_OPERATION_FIELDS } from "../core/model";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";

/**
 * Skills, guides, tool descriptions and public docs show tool calls such as
 * page_read({projectId,pageId,response:"source"}). Each example is checked
 * against the live inputSchema of a local library connection: the tool must
 * exist under its current name, every argument must exist (per action for
 * action tools, which must name their action), literal enum values must be
 * valid, and page operations must use a current type and fields. Example
 * values are placeholders, so required arguments are not enforced.
 */

const repository = resolve(__dirname, "../..");
let root: string;
let server: ReturnType<typeof createLibraryMcpServer>;
let tools: ReadonlyMap<string, RegisteredTool>;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-doc-examples-"));
  await openLibrary(root);
  server = createLibraryMcpServer({ root });
  tools = registeredTools(server);
});
afterAll(async () => {
  await server.close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A tolerant reader for the object-literal notation used in documents:
// shorthand keys, optional markers (key?), spreads, quoted and bare values.

type Value =
  | { kind: "object"; entries: { key: string; value?: Value }[] }
  | { kind: "array"; items: Value[] }
  | { kind: "string"; value: string }
  | { kind: "raw"; text: string };

class Reader {
  index = 0;
  constructor(readonly text: string) {}
  space() {
    while (/\s/.test(this.text[this.index] ?? "")) this.index++;
  }
  peek() {
    this.space();
    return this.text[this.index];
  }
  string(): string {
    const quote = this.text[this.index++];
    let value = "";
    while (this.index < this.text.length && this.text[this.index] !== quote) {
      if (this.text[this.index] === "\\") this.index++;
      value += this.text[this.index++];
    }
    this.index++;
    return value;
  }
  /** Text up to a delimiter at depth 0, for placeholders like 原baseRevision. */
  raw(stop: string): string {
    const start = this.index;
    let depth = 0;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if ("\"'`".includes(char)) {
        this.string();
        continue;
      }
      if ("{[(".includes(char)) depth++;
      else if ("}])".includes(char)) {
        if (!depth) break;
        depth--;
      } else if (!depth && stop.includes(char)) break;
      this.index++;
    }
    return this.text.slice(start, this.index).trim();
  }
  value(stop: string): Value {
    const char = this.peek();
    if (char === "{") return this.object();
    if (char === "[") return this.array();
    if (char && "\"'`".includes(char)) {
      const start = this.index;
      const value = this.string();
      // "component"或"template" and similar prose stay raw.
      const rest = this.raw(stop);
      return rest
        ? { kind: "raw", text: this.text.slice(start, this.index) }
        : { kind: "string", value };
    }
    return { kind: "raw", text: this.raw(stop) };
  }
  entries(close: string): { key: string; value?: Value }[] {
    const entries: { key: string; value?: Value }[] = [];
    for (;;) {
      const char = this.peek();
      if (char === undefined || char === close) {
        this.index++;
        return entries;
      }
      if (char === ",") {
        this.index++;
        continue;
      }
      if (this.text.startsWith("...", this.index)) {
        this.index += 3;
        this.raw(`,${close}`);
        continue;
      }
      let key: string;
      if ("\"'".includes(char)) key = this.string();
      else {
        const match = /^[^\s:,?{}[\]()]+/.exec(this.text.slice(this.index));
        if (!match) {
          // Prose such as "{…}" or "|": skip one character.
          this.index++;
          continue;
        }
        key = match[0];
        this.index += key.length;
      }
      if (this.peek() === "?") this.index++;
      if (this.peek() === ":") {
        this.index++;
        entries.push({ key, value: this.value(`,${close}`) });
      } else entries.push({ key });
    }
  }
  object(): Value {
    this.index++;
    return { kind: "object", entries: this.entries("}") };
  }
  array(): Value {
    this.index++;
    const items: Value[] = [];
    for (;;) {
      const char = this.peek();
      if (char === undefined || char === "]") {
        this.index++;
        return { kind: "array", items };
      }
      if (char === ",") {
        this.index++;
        continue;
      }
      items.push(this.value(",]"));
    }
  }
}

/** The argument object of name( … ): {…} or bare key:value pairs. */
function callArguments(
  text: string,
  open: number,
): { value: Value; end: number } | undefined {
  const reader = new Reader(text);
  reader.index = open + 1;
  const char = reader.peek();
  if (char === ")")
    return { value: { kind: "object", entries: [] }, end: reader.index };
  if (char === "{") return { value: reader.object(), end: reader.index };
  // guide prose writes dataset_write(action:apply) without braces.
  if (!/^[A-Za-z_$][\w$]*\s*:/.test(text.slice(reader.index))) return undefined;
  const value: Value = { kind: "object", entries: reader.entries(")") };
  return { value, end: reader.index };
}

// ---------------------------------------------------------------------------

interface Source {
  name: string;
  text: string;
}
const unwrap = (schema: unknown): z.ZodType => {
  let current = schema as z.ZodType;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable)
      current = current.unwrap() as z.ZodType;
    else if (current instanceof z.ZodDefault)
      current = current.unwrap() as z.ZodType;
    else return current;
  }
};
/** Arguments only the hosted gateway adds (src/agent/mcp-http.ts guide). */
const HOSTED_ARGUMENTS: Record<string, string[]> = {
  guide: ["skill", "file", "section"],
};
const enumValues = (schema: unknown): string[] | undefined => {
  const inner = unwrap(schema);
  return inner instanceof z.ZodEnum
    ? (inner.options as string[])
    : inner instanceof z.ZodLiteral
      ? [...inner.values].map(String)
      : undefined;
};

function checkOperation(value: Value, where: string, problems: string[]) {
  if (value.kind !== "object") return;
  const type = value.entries.find((entry) => entry.key === "type")?.value;
  if (type?.kind !== "string") return;
  const fields = (PAGE_OPERATION_FIELDS as Record<string, readonly string[]>)[
    type.value
  ];
  if (!fields) {
    // Board drawings and other nodes also carry "type"; only dotted names are operations.
    if (/^[a-z-]+\.[a-z.-]+$/.test(type.value))
      problems.push(`${where}: unknown page operation ${type.value}`);
    return;
  }
  for (const entry of value.entries)
    if (entry.key !== "type" && !fields.includes(entry.key))
      problems.push(
        `${where}: ${type.value} has no field ${entry.key} (fields: ${fields.join(", ")})`,
      );
}

function checkCall(
  name: string,
  args: Value,
  where: string,
  problems: string[],
) {
  if (RENAMED_TOOLS[name]) {
    problems.push(
      `${where}: ${name} was replaced by ${RENAMED_TOOLS[name]} (guide migrations)`,
    );
    return;
  }
  const tool = tools.get(name);
  if (!tool || args.kind !== "object") return;
  const shape = (getObjectShape(tool.inputSchema) ?? {}) as Record<
    string,
    unknown
  >;
  const actions = actionFields(shape);
  const action = args.entries.find((entry) => entry.key === "action")?.value;
  let fields: Record<string, unknown> = shape;
  if (actions) {
    const literal =
      action?.kind === "string"
        ? action.value
        : action?.kind === "raw" && /^[a-z_]+$/.test(action.text)
          ? action.text
          : undefined;
    if (!action) {
      problems.push(
        `${where}: ${name} needs action (${Object.keys(actions).join(", ")})`,
      );
      return;
    }
    if (literal && !actions[literal]) {
      problems.push(
        `${where}: ${name} has no action ${literal} (${Object.keys(actions).join(", ")})`,
      );
      return;
    }
    if (literal)
      fields = {
        ...actions[literal],
        action: shape.action,
        projectId: shape.projectId,
      };
  }
  for (const entry of args.entries) {
    if (HOSTED_ARGUMENTS[name]?.includes(entry.key)) continue;
    if (!(entry.key in fields)) {
      problems.push(
        `${where}: ${name}${actions && action?.kind === "string" ? ` action ${action.value}` : ""} has no argument ${entry.key}`,
      );
      continue;
    }
    const allowed = enumValues(fields[entry.key]);
    if (allowed && entry.value?.kind === "string" && entry.key !== "action")
      if (!allowed.includes(entry.value.value))
        problems.push(
          `${where}: ${name} ${entry.key} must be one of ${allowed.join(", ")}, not ${entry.value.value}`,
        );
    if (entry.key === "operations" && entry.value?.kind === "array")
      for (const operation of entry.value.items)
        checkOperation(operation, where, problems);
  }
}

function lineOf(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

function scan(source: Source, names: string[]) {
  const problems: string[] = [];
  let examples = 0;
  const pattern = new RegExp(`\\b(${names.join("|")})\\(`, "g");
  const calls: [number, number][] = [];
  for (const match of source.text.matchAll(pattern)) {
    const where = `${source.name}:${lineOf(source.text, match.index!)}`;
    const args = callArguments(source.text, match.index! + match[1].length);
    if (!args) continue;
    examples++;
    calls.push([match.index!, args.end]);
    checkCall(match[1], args.value, where, problems);
  }
  // Operation objects written outside a page_apply call.
  for (const match of source.text.matchAll(/\{\s*type\s*:\s*["'][a-z]/g)) {
    if (
      calls.some(([start, end]) => match.index! > start && match.index! < end)
    )
      continue;
    const reader = new Reader(source.text);
    reader.index = match.index!;
    checkOperation(
      reader.object(),
      `${source.name}:${lineOf(source.text, match.index!)}`,
      problems,
    );
  }
  return { problems, examples };
}

async function documentSources(): Promise<Source[]> {
  const tracked = execFileSync(
    "git",
    [
      "ls-files",
      "plugins/showai/skills",
      "plugins/showai/host-adapters",
      "plugins/showai/README.md",
      "plugins/showai/README.zh-CN.md",
      "docs",
      "resources/templates",
    ],
    { cwd: repository, encoding: "utf8" },
  )
    .split("\n")
    .filter((path) => path.endsWith(".md"));
  // New Skill files count as soon as they exist, before they are committed.
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "plugins/showai/skills"],
    { cwd: repository, encoding: "utf8" },
  )
    .split("\n")
    .filter((path) => path.endsWith(".md"));
  return Promise.all(
    [...new Set([...tracked, ...untracked])].map(async (path) => ({
      name: path,
      text: await readFile(join(repository, path), "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      ),
    })),
  );
}

test("documented tool calls match the live tool schemas", async () => {
  const names = [...new Set([...tools.keys(), ...Object.keys(RENAMED_TOOLS)])];
  const sources: Source[] = [
    ...(await documentSources()),
    ...GUIDE_TOPICS.filter((topic) => topic !== "migrations").map((topic) => {
      const guide = getMcpGuide(topic) as Record<string, unknown>;
      return {
        name: `guide ${topic}`,
        text: JSON.stringify({ rules: guide.rules, input: guide.input })
          .replace(/\\"/g, '"')
          .replace(/\\n/g, "\n"),
      };
    }),
    ...[...tools.entries()].map(([name, tool]) => ({
      name: `tool ${name} description`,
      text: tool.description ?? "",
    })),
  ];
  let examples = 0;
  const problems: string[] = [];
  for (const source of sources) {
    const result = scan(source, names);
    examples += result.examples;
    problems.push(...result.problems);
  }
  expect(problems, problems.join("\n")).toEqual([]);
  // The scan must keep finding the documented calls it is meant to check.
  expect(examples).toBeGreaterThan(100);
  expect(relative(repository, __dirname)).toBe("src/agent");
});

test("the checker reports stale examples", () => {
  const names = [...tools.keys(), ...Object.keys(RENAMED_TOOLS)];
  const { problems } = scan(
    {
      name: "fixture",
      text: [
        'dataset_create({projectId,name:"x",value})',
        "dataset_read({projectId,datasetId})",
        'page_read({projectId,pageId,out:"/tmp/x",response:"everything"})',
        'organization_update({projectId,action:"sort",parentId,sortBy,name})',
        'page_apply({projectId,pageId,baseHash,operations:[{type:"component.props.set",blockId,data}]})',
        '{type:"component.upgrade",blockId}',
      ].join("\n"),
    },
    names,
  );
  expect(problems).toEqual([
    "fixture:1: dataset_create was replaced by dataset_write (guide migrations)",
    "fixture:2: dataset_read needs action (list, read)",
    "fixture:3: page_read response must be one of full, source, receipt, not everything",
    "fixture:4: organization_update action sort has no argument name",
    "fixture:5: component.props.set has no field data (fields: blockId, props)",
    "fixture:6: unknown page operation component.upgrade",
  ]);
});
