import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const docs = join(repository, "resources/docs");
const check = process.argv.includes("--check");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));

async function loadRuntime() {
  const cache = join(repository, "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "showai-doc-commands-"));
  try {
    const output = join(directory, "commands.mjs");
    await build({
      stdin: {
        contents:
          'export { COMMANDS, findCommand } from "./src/agent/cli/commands.ts"; export { withLibraryLock } from "./src/core/library-lock.ts";',
        resolveDir: repository,
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      target: "node22",
      plugins: [rawSourcePlugin],
      banner: {
        js: 'import { createRequire as makeRequire } from "node:module"; const require = makeRequire(import.meta.url);',
      },
    });
    return await import(pathToFileURL(output).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function cliIndex(commands) {
  const groups = new Map();
  for (const { command, actions, help } of commands) {
    if (actions?.includes("*")) continue;
    const entries = groups.get(command) ?? new Set();
    if (actions) {
      for (const action of actions) entries.add(command + " " + action);
    } else {
      const verbs = new RegExp("^" + command + " ([a-z][a-z-]*)(?: |$)");
      const subcommands = (help ?? []).flatMap((usage) =>
        usage.split(" | ").flatMap((part) => {
          const verb = verbs.exec(part);
          return verb ? [command + " " + verb[1]] : [];
        }),
      );
      for (const name of subcommands.length ? subcommands : [command])
        entries.add(name);
    }
    groups.set(command, entries);
  }
  const lines = [...groups.keys()]
    .sort()
    .map((command) => [...groups.get(command)].sort().join("\n"));
  return { count: groups.size, text: lines.join("\n\n") };
}

const modes = [
  ["library", "本机内容库 · stdio", "Local library · stdio"],
  ["project", "固定项目 · stdio", "Bound project · stdio"],
  ["public", "公开资源 · stdio", "Public resources · stdio"],
  ["http", "托管 HTTP · 工具发现", "Hosted HTTP · tool discovery"],
];
const names = await Promise.all(
  modes.map(async ([id]) => {
    const tools = await json(
      join(repository, "src/agent/fixtures", "mcp-tools-" + id + ".json"),
    );
    return tools.map((tool) => tool.name).sort();
  }),
);

function wrapNames(list) {
  const lines = [];
  let line = "";
  for (const name of list) {
    if (line.length + name.length > 76) {
      lines.push(line);
      line = "";
    }
    line += (line ? "  " : "") + name;
  }
  return [...lines, line].join("\n");
}

const { COMMANDS, findCommand, withLibraryLock } = await loadRuntime();
const cli = cliIndex(COMMANDS);
const advertisedTools = new Set(names.flat());

async function replaceFile(path, previous, next) {
  const temporary = join(
    dirname(path),
    ".docs-reference-" + randomUUID() + ".tmp",
  );
  try {
    await writeFile(temporary, next, { flag: "wx" });
    if ((await readFile(path, "utf8")) !== previous)
      throw new Error(
        "The source changed during documentation generation. Retry with the saved file: " +
          path,
      );
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
const routes = await json(join(docs, "routes.json"));
for (const locale of ["zh-CN", "en"]) {
  const zh = locale === "zh-CN";
  const sections = [
    {
      id: "cli-command-index",
      title: zh ? "按命令查看 CLI 注册表" : "Browse the CLI command registry",
      text: cli.text,
      before: "node-cab76929",
    },
    {
      id: "mcp-tool-index",
      title: zh
        ? "按连接模式查看 MCP 工具"
        : "Browse MCP tools by connection mode",
      text: modes
        .map(
          (mode, index) =>
            mode[zh ? 1 : 2] +
            " (" +
            names[index].length +
            ")\n" +
            wrapNames(names[index]),
        )
        .join("\n\n"),
      before: "node-adceb3d5",
    },
  ];
  const path = join(
    docs,
    locale,
    "projects",
    routes.projectId,
    "pages",
    routes.slugs.cli + ".json",
  );
  const previousPage = await readFile(path, "utf8");
  const page = JSON.parse(previousPage);
  const doc = page.document;
  const before = JSON.stringify(doc);
  const nodes = doc.content.content;
  const examples = (id) =>
    nodes.find((node) => node.attrs?.id === id).attrs.data.props.commands;
  for (const { command } of examples(sections[0].before)) {
    const declaration = findCommand(command.split(/\s+/));
    if (!declaration || declaration.actions?.includes("*"))
      throw new Error("Undeclared CLI example in " + path + ": " + command);
  }
  for (const { command } of examples(sections[1].before)) {
    if (!advertisedTools.has(command))
      throw new Error("Undeclared MCP tool in " + path + ": " + command);
  }
  for (const section of sections) {
    let toggle = nodes.find((node) => node.attrs?.id === section.id);
    if (!toggle) {
      const position = nodes.findIndex(
        (node) => node.attrs?.id === section.before,
      );
      const order = doc.surfaceViews[doc.content.attrs.id].readingOrder;
      const orderPosition = order.indexOf(section.before);
      if (position < 0 || orderPosition < 0)
        throw new Error("Missing reference section: " + section.before);
      toggle = { type: "toggle", attrs: { id: section.id, open: false } };
      nodes.splice(position, 0, toggle);
      order.splice(orderPosition, 0, section.id);
    }
    if (toggle.type !== "toggle")
      throw new Error("Expected an index disclosure: " + section.id);
    toggle.attrs.title = section.title;
    toggle.content = [
      {
        type: "codeBlock",
        attrs: { id: section.id + "-text", language: "text" },
        content: [{ type: "text", text: section.text }],
      },
    ];
  }
  const facts = nodes.find(
    (node) => node.attrs?.data?.componentId === "doc-hero",
  ).attrs.data.props.facts;
  facts[0] = {
    label: zh ? "CLI 命令族" : "CLI command groups",
    value: String(cli.count),
  };
  facts[1] = {
    label: zh ? "本机内容库工具" : "Local library tools",
    value: String(names[0].length),
  };
  if (JSON.stringify(doc) !== before) {
    if (check)
      throw new Error(
        locale +
          " App runtime reference is out of date. Run npm run docs:build.",
      );
    doc.updatedAt = new Date().toISOString();
    await withLibraryLock(join(docs, locale), () =>
      replaceFile(path, previousPage, JSON.stringify(page, null, 2)),
    );
  }

  const guide = join(
    repository,
    zh ? "docs/i18n/agent-usage.zh-CN.md" : "docs/agent-usage.md",
  );
  const previous = await readFile(guide, "utf8");
  const block = sections
    .map(({ title, text }) =>
      [
        "<details>",
        "<summary>" + title + "</summary>",
        "",
        "```text",
        text,
        "```",
        "",
        "</details>",
      ].join("\n"),
    )
    .join("\n\n");
  const start = "<!-- showai:runtime-index:start -->",
    end = "<!-- showai:runtime-index:end -->";
  const startAt = previous.indexOf(start),
    endAt = previous.indexOf(end);
  if (startAt < 0 || endAt < startAt)
    throw new Error("Missing runtime index markers in " + guide);
  const next =
    previous.slice(0, startAt + start.length) +
    "\n" +
    block +
    "\n" +
    previous.slice(endAt);
  if (next !== previous) {
    if (check)
      throw new Error(
        locale +
          " Markdown runtime reference is out of date. Run npm run docs:build.",
      );
    await replaceFile(guide, previous, next);
  }
}
