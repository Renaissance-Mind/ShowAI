import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import {
  skills,
  fileNotes,
  scenarios,
  concepts,
  standards,
} from "./content.mjs";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const output = process.argv[2];
if (!output || !output.startsWith("/"))
  throw new Error("Provide an absolute task-owned output directory.");
const out = resolve(output),
  plugin = join(root, "plugins/showai");
await mkdir(out, { recursive: true });
await mkdir(join(out, "component"), { recursive: true });
const pluginStatus = execFileSync(
  "git",
  ["status", "--porcelain", "--", "plugins/showai"],
  { cwd: root, encoding: "utf8" },
).trim();
if (pluginStatus)
  throw new Error(
    "Commit plugin changes before building a source-linked atlas.",
  );
const manifest = JSON.parse(
  await readFile(join(plugin, "plugin.json"), "utf8"),
);
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
        ),
    )
  ).flat();
}
const files = await Promise.all(
  (await walk(plugin)).map(async (path) => {
    const content = await readFile(path, "utf8"),
      rel = relative(plugin, path),
      base = rel.split("/").at(-1),
      skill = skills.find((s) => rel === `skills/${s.id}/SKILL.md`);
    const note = skill
      ? [skill.label + " · Skill 入口", skill.summary, "Skill"]
      : fileNotes[rel] || fileNotes[base];
    if (!note) throw new Error("Missing documented file: " + rel);
    let headings = content
      .split("\n")
      .filter((l) => /^#{1,3} /.test(l))
      .map((l) => l.replace(/^#+ /, ""));
    if (!headings.length)
      headings = skill
        ? [...skill.when, "运行入口、任务流程与交付边界"]
        : rel.endsWith(".json")
          ? Object.keys(JSON.parse(content))
          : ["SVG 品牌图形与宿主显示资源"];
    return {
      path: rel,
      title: note[0],
      summary: note[1],
      kind: note[2],
      content,
      headings,
      lines: content.trimEnd().split("\n").length,
      hash: createHash("sha256").update(content).digest("hex"),
    };
  }),
);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const data = {
  title: "读懂 ShowAI 插件",
  version: manifest.version,
  date: "2026-10-09",
  repository:
    "https://github.com/Renaissance-Mind/ShowAI/tree/" +
    sourceCommit +
    "/plugins/showai",
  sourceCommit,
  logo:
    "data:image/svg+xml;base64," +
    Buffer.from(await readFile(join(plugin, "assets/logo.svg"))).toString(
      "base64",
    ),
  skills,
  files,
  scenarios,
  concepts,
  standards,
};
const shared = {
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  loader: { ".css": "text" },
  jsx: "automatic",
  minify: true,
  logLevel: "warning",
};
const component = await build({
  ...shared,
  entryPoints: [join(here, "Atlas.jsx")],
  external: ["react", "react/jsx-runtime"],
});
const source = component.outputFiles[0].text;
const schema = {
  type: "object",
  required: [
    "title",
    "version",
    "date",
    "repository",
    "sourceCommit",
    "logo",
    "skills",
    "files",
    "scenarios",
    "concepts",
    "standards",
  ],
  properties: {
    title: { type: "string" },
    version: { type: "string" },
    date: { type: "string" },
    repository: { type: "string" },
    sourceCommit: { type: "string" },
    logo: { type: "string" },
    skills: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "id",
          "label",
          "icon",
          "summary",
          "when",
          "does",
          "refs",
          "guides",
          "result",
          "boundary",
          "example",
          "tagline",
        ],
      },
    },
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "path",
          "title",
          "summary",
          "kind",
          "content",
          "headings",
          "lines",
          "hash",
        ],
      },
    },
    scenarios: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "label", "request", "route", "steps", "result"],
      },
    },
    concepts: {
      type: "array",
      items: { type: "array", minItems: 3, maxItems: 3 },
    },
    standards: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "owner", "status", "current", "gap", "proposal"],
      },
    },
  },
};
for (const key of ["skills", "files", "scenarios", "standards"]) {
  const item = schema.properties[key].items;
  item.properties = Object.fromEntries(
    item.required.map((field) => [
      field,
      ["when", "does", "refs", "guides", "headings", "route"].includes(field)
        ? { type: "array", items: { type: "string" } }
        : field === "steps"
          ? {
              type: "array",
              items: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                items: { type: "string" },
              },
            }
          : field === "lines"
            ? { type: "integer", minimum: 1 }
            : { type: "string" },
    ]),
  );
}
const componentManifest = {
  id: "plugin-atlas",
  name: "插件导览",
  version: "1.0.3",
  description:
    "可复用的全宽插件文档组件：联动 Skill 地图、文件检索、原文阅读与任务路线。",
  scenarios: [
    "解释插件结构、工作流与参考文档",
    "以真实文件快照制作可离线阅读的交互说明",
  ],
  entry: "index.jsx",
  defaultData: data,
  examples: [{ name: "ShowAI 插件导览", data }],
};
await writeFile(join(out, "component/index.jsx"), source);
await writeFile(
  join(out, "component/manifest.json"),
  JSON.stringify(componentManifest, null, 2),
);
await writeFile(
  join(out, "component/props.schema.json"),
  JSON.stringify(schema, null, 2),
);
await writeFile(join(out, "atlas-data.json"), JSON.stringify(data, null, 2));
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import PluginAtlas from ${JSON.stringify(join(here, "Atlas.jsx"))};const data=${JSON.stringify(data)};createRoot(document.getElementById('plugin-atlas-root')).render(React.createElement(PluginAtlas,{data}));`;
const app = await build({
  ...shared,
  format: "iife",
  stdin: {
    contents: entry,
    resolveDir: root,
    sourcefile: "atlas-entry.jsx",
    loader: "jsx",
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const script = app.outputFiles[0].text.replaceAll("</script", "<\\/script");
await writeFile(
  join(out, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="ShowAI 插件结构、四个 Skill、参考文件与工作流的交互导览。"><title>ShowAI · 插件指南</title><style>html{scroll-behavior:smooth;scroll-padding-top:80px}body{margin:0}*{box-sizing:border-box}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}</style></head><body><div id="plugin-atlas-root"></div><script>${script}</script></body></html>`,
);
const document = {
  id: "showai-plugin-atlas",
  title: data.title,
  content: {
    type: "surface",
    attrs: { id: "atlas-page", kind: "page", name: "插件指南" },
    content: [
      {
        type: "widget",
        attrs: {
          id: "atlas-guide",
          kind: "custom",
          data: { componentId: "plugin-atlas", version: "1.0.3", props: data },
        },
      },
    ],
  },
  layout: { "atlas-guide": { x: 0, y: 0, width: 1536 } },
  surfaceViews: {},
};
await writeFile(
  join(out, "render-input.json"),
  JSON.stringify(
    {
      title: data.title,
      document,
      componentSources: [{ manifest: componentManifest, schema, source }],
    },
    null,
    2,
  ),
);
await writeFile(
  join(out, "build-receipt.json"),
  JSON.stringify(
    {
      sourceCommit,
      date: data.date,
      files: files.map(({ path, hash }) => ({ path, hash })),
      skillCount: skills.length,
      referenceCount: files.filter((f) => f.kind === "参考").length,
      htmlBytes: Buffer.byteLength(script),
      componentBytes: Buffer.byteLength(source),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    ok: true,
    out,
    files: files.length,
    skillCount: skills.length,
    referenceCount: files.filter((f) => f.kind === "参考").length,
    htmlBytes: Buffer.byteLength(script),
    componentBytes: Buffer.byteLength(source),
  }),
);
