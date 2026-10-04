import { rawSourcePlugin } from "../../scripts/raw-source-plugin.mjs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execute = promisify(execFile);
let home: string;
let bundleDirectory: string;
let cli: string;
const repository = resolve(import.meta.dirname, "../..");
const environment = () => ({
  ...process.env,
  SHOWAI_HOME: home,
  SHOWAI_VIEWER: join(repository, "dist-portable/portable.html"),
});

async function run(args: string[]) {
  const output = await execute(process.execPath, [cli, ...args, "--json"], {
    env: environment(),
  }).catch((error) => {
    throw new Error(
      `CLI ${args.join(" ")} failed: ${error.stdout || error.stderr || error.message}`,
      { cause: error },
    );
  });
  return JSON.parse(output.stdout).data;
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-agent-test-"));
  await mkdir(join(repository, "node_modules/.cache"), { recursive: true });
  bundleDirectory = await mkdtemp(
    join(repository, "node_modules/.cache/showai-agent-"),
  );
  cli = join(bundleDirectory, "cli.mjs");
  await build({
    entryPoints: [join(repository, "src/agent/cli.ts")],
    outfile: cli,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["esbuild"],
    plugins: [rawSourcePlugin],
    banner: {
      js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
    },
  });
}, 30000);

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(bundleDirectory, { recursive: true, force: true });
});

test("external runtime records an executable launch and exposes only relevant guides", async () => {
  const info = await run(["runtime", "info"]);
  expect(info.protocol).toBe(1);
  expect(info.launch.args).toEqual([cli]);
  expect(info.guideTopics).toContain("template-extraction");
  const registration = await run(["runtime", "register"]);
  const config = JSON.parse(await readFile(registration.path, "utf8"));
  const output = await execute(
    config.launch.command,
    [...config.launch.args, "guide", "component", "--json"],
    { env: { ...environment(), ...config.launch.env } },
  );
  const guide = JSON.parse(output.stdout).data;
  expect(guide.topic).toBe("component");
  expect(guide.commands).toContain(
    "showai catalog import --project PROJECT --input ./component-package --json",
  );
});

test("real CLI binds sessions, detects user changes and rejects stale writes", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Research",
    "--harness",
    "codex",
    "--session",
    "test-session-one",
  ]);
  const reused = await run([
    "projects",
    "create",
    "--name",
    "Repeated",
    "--harness",
    "codex",
    "--session",
    "test-session-one",
  ]);
  expect(reused.id).toBe(project.id);
  const page = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Before",
  ]);
  const read = await run([
    "pages",
    "read",
    page.document.id,
    "--project",
    project.id,
  ]);
  const operations = join(home, "operations.json");
  await writeFile(
    operations,
    JSON.stringify([
      { type: "page.set", fields: { title: "Manual revision" } },
    ]),
  );
  const changed = await run([
    "pages",
    "apply",
    page.document.id,
    "--project",
    project.id,
    "--input",
    operations,
    "--base-hash",
    read.hash,
  ]);
  expect(changed.document.title).toBe("Manual revision");
  const diff = await run([
    "pages",
    "diff",
    page.document.id,
    "--project",
    project.id,
    "--since",
    read.hash,
  ]);
  expect(diff.changed).toBe(true);
  expect(diff.changes[0].fields).toContainEqual({
    field: "title",
    before: "Before",
    after: "Manual revision",
  });
  const stale = await execute(
    process.execPath,
    [
      cli,
      "pages",
      "apply",
      page.document.id,
      "--project",
      project.id,
      "--input",
      operations,
      "--base-hash",
      read.hash,
      "--json",
    ],
    { env: environment() },
  ).then(
    () => {
      throw new Error("Stale write unexpectedly succeeded.");
    },
    (error) => error,
  );
  expect(stale.code).toBe(3);
  expect(JSON.parse(stale.stdout).error).toMatchObject({
    code: "CONFLICT",
    currentHash: changed.hash,
  });
  const absentProject = await execute(
    process.execPath,
    [cli, "pages", "list", "--json"],
    { env: environment() },
  ).then(
    () => {
      throw new Error("Implicit project unexpectedly accepted.");
    },
    (error) => error,
  );
  expect(JSON.parse(absentProject.stdout).error.message).toContain("--project");
});

test("real exports include readable source and working relative multi-page site assets", async () => {
  const project = await run(["projects", "create", "--name", "Export checks"]);
  const first = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "First <page>",
  ]);
  const second = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Second page",
  ]);
  const artifact = await run([
    "export",
    "--project",
    project.id,
    "--page",
    first.document.id,
    "--format",
    "html",
    "--out",
    join(home, "report.html"),
  ]);
  const html = await readFile(artifact.path, "utf8");
  expect(html).toContain('id="showai-data"');
  expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
  expect(
    JSON.parse(await readFile(artifact.sourcePaths[0], "utf8")).document.id,
  ).toBe(first.document.id);
  const site = await run([
    "export",
    "--project",
    project.id,
    "--format",
    "site",
    "--out",
    join(home, "site"),
  ]);
  const index = await readFile(site.path, "utf8");
  const manifest = JSON.parse(
    await readFile(join(dirname(site.path), "showai-site.json"), "utf8"),
  );
  expect(site.pageIds).toContain(second.document.id);
  expect(index).toContain('src="./assets/viewer.js"');
  expect(index).toContain("First &lt;page&gt;");
  for (const route of manifest.pages) {
    expect(index).toContain(`href="./${route.file}"`);
    expect(
      await readFile(join(dirname(site.path), route.file), "utf8"),
    ).toContain('aria-current="page"');
  }
  expect(
    (await readFile(join(dirname(site.path), "assets/viewer.js"), "utf8"))
      .length,
  ).toBeGreaterThan(1000);
});

test("real MCP subprocess shares CLI writes and remains bound to one project", async () => {
  const project = await run(["projects", "create", "--name", "MCP project"]);
  const other = await run(["projects", "create", "--name", "Other project"]);
  const otherPage = await run([
    "pages",
    "create",
    "--project",
    other.id,
    "--title",
    "Not this session",
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--project", project.id],
    env: Object.fromEntries(
      Object.entries(environment()).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    stderr: "pipe",
  });
  const client = new Client({
    name: "showai-integration-test",
    version: "1.0.0",
  });
  const data = (result: unknown) =>
    JSON.parse(
      (result as { content: { type: string; text: string }[] }).content[0].text,
    );
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("page_diff");
    const created = data(
      await client.callTool({
        name: "page_create",
        arguments: { title: "Shared page" },
      }),
    ).data;
    const initial = data(
      await client.callTool({
        name: "page_read",
        arguments: { pageId: created.document.id },
      }),
    ).data;
    const operations = join(home, "mcp-operations.json");
    await writeFile(
      operations,
      JSON.stringify([
        { type: "page.set", fields: { title: "Edited by another client" } },
      ]),
    );
    await run([
      "pages",
      "apply",
      created.document.id,
      "--project",
      project.id,
      "--input",
      operations,
      "--base-hash",
      initial.hash,
    ]);
    const diff = data(
      await client.callTool({
        name: "page_diff",
        arguments: { pageId: created.document.id, sinceHash: initial.hash },
      }),
    ).data;
    expect(diff.changed).toBe(true);
    const conflict = data(
      await client.callTool({
        name: "page_apply",
        arguments: {
          pageId: created.document.id,
          baseHash: initial.hash,
          operations: [
            { type: "page.set", fields: { title: "Stale overwrite" } },
          ],
        },
      }),
    );
    expect(conflict.error.code).toBe("CONFLICT");
    const outside = data(
      await client.callTool({
        name: "page_read",
        arguments: { pageId: otherPage.document.id, projectId: other.id },
      }),
    );
    expect(outside.ok).toBe(false);
    const context = data(
      await client.callTool({ name: "project_context", arguments: {} }),
    ).data;
    expect(context.project.id).toBe(project.id);
  } finally {
    await client.close();
  }
}, 30000);

test("CLI templates create independent pages and save reusable project templates", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Template author",
  ]);
  const catalog = await run([
    "catalog",
    "list",
    "--kind",
    "template",
    "--project",
    project.id,
  ]);
  expect(
    catalog.items.some((item: { id: string }) => item.id === "blank"),
  ).toBe(true);
  const first = await run([
    "template",
    "apply",
    "blank",
    "--project",
    project.id,
    "--title",
    "First template use",
  ]);
  const template = await run([
    "template",
    "save",
    "--project",
    project.id,
    "--page",
    first.document.id,
    "--name",
    "Reusable composition",
    "--description",
    "A personal composition",
  ]);
  const second = await run([
    "template",
    "apply",
    template.id,
    "--project",
    project.id,
    "--title",
    "Second template use",
  ]);
  expect(second.document.id).not.toBe(first.document.id);
  expect(second.document.title).toBe("Second template use");
  expect(second.document.content.content[0].attrs.id).not.toBe(
    first.document.content.content[0].attrs.id,
  );
  const original = await run([
    "pages",
    "read",
    first.document.id,
    "--project",
    project.id,
  ]);
  expect(original.document.title).toBe("First template use");
});

test("CLI discovers built-ins and roundtrips custom component artifacts to another project", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Custom component author",
  ]);
  const builtin = await run([
    "catalog",
    "describe",
    "chart",
    "--kind",
    "component",
  ]);
  expect(builtin.scope).toBe("builtin");
  expect(builtin).not.toHaveProperty("propsSchema");
  expect(builtin).not.toHaveProperty("schema");
  expect(builtin).not.toHaveProperty("defaultData");
  const builtinSchema = await run([
    "catalog",
    "describe",
    "chart",
    "--view",
    "schema",
  ]);
  expect(builtinSchema.schema).toBeDefined();
  const component = await run([
    "catalog",
    "import",
    "--project",
    project.id,
    "--input",
    join(repository, "resources/catalog/value-slider"),
  ]);
  expect(component).not.toHaveProperty("html");
  expect(component).not.toHaveProperty("inline");
  expect(component).not.toHaveProperty("defaultData");
  const examples = await run([
    "catalog",
    "describe",
    component.id,
    "--project",
    project.id,
    "--view",
    "examples",
  ]);

  const description = await run([
    "catalog",
    "describe",
    component.id,
    "--project",
    project.id,
  ]);
  expect(description).not.toHaveProperty("html");
  expect(description).not.toHaveProperty("inline");
  const listed = await run([
    "catalog",
    "list",
    "--kind",
    "component",
    "--project",
    project.id,
  ]);
  for (const metadata of listed.items) {
    expect(metadata).not.toHaveProperty("html");
    expect(metadata).not.toHaveProperty("inline");
  }
  const page = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Custom controls",
  ]);
  const operations = join(home, "custom-ops.json");
  await writeFile(
    operations,
    JSON.stringify([
      {
        type: "block.insert",
        node: {
          type: "widget",
          attrs: {
            kind: "custom",
            data: {
              componentId: component.id,
              version: component.version,
              integrity: component.integrity,
              props: examples.defaultData,
            },
          },
        },
      },
    ]),
  );
  const updated = await run([
    "pages",
    "apply",
    page.document.id,
    "--project",
    project.id,
    "--input",
    operations,
    "--base-hash",
    page.hash,
  ]);
  const output = await run([
    "export",
    "--project",
    project.id,
    "--page",
    page.document.id,
    "--format",
    "html",
    "--out",
    join(home, "custom.html"),
  ]);
  const artifact = JSON.parse(await readFile(output.sourcePaths[0], "utf8"));
  expect(artifact.components).toHaveLength(1);
  expect(artifact.components[0].integrity).toBe(component.integrity);
  const reader = await run([
    "projects",
    "create",
    "--name",
    "Another project without components",
  ]);
  const imported = await run([
    "pages",
    "create",
    "--project",
    reader.id,
    "--input",
    output.sourcePaths[0],
  ]);
  const again = await run([
    "export",
    "--project",
    reader.id,
    "--page",
    imported.document.id,
    "--format",
    "html",
    "--out",
    join(home, "custom-roundtrip.html"),
  ]);
  expect(
    JSON.parse(await readFile(again.sourcePaths[0], "utf8")).components[0]
      .integrity,
  ).toBe(component.integrity);
  const widget = updated.document.content.content.find(
    (node: { type: string }) => node.type === "widget",
  );
  await writeFile(
    operations,
    JSON.stringify([
      {
        type: "block.attrs.set",
        blockId: widget.attrs.id,
        attrs: {
          data: {
            ...widget.attrs.data,
            props: { ...examples.defaultData, value: "invalid number" },
          },
        },
      },
    ]),
  );
  const invalid = await execute(
    process.execPath,
    [
      cli,
      "pages",
      "apply",
      page.document.id,
      "--project",
      project.id,
      "--input",
      operations,
      "--base-hash",
      updated.hash,
      "--json",
    ],
    { env: environment() },
  ).then(
    () => {
      throw new Error("Invalid custom props unexpectedly succeeded.");
    },
    (error) => error,
  );
  expect(JSON.parse(invalid.stdout).ok).toBe(false);
  expect(
    (await run(["pages", "read", page.document.id, "--project", project.id]))
      .hash,
  ).toBe(updated.hash);
});

test("exports stay in the selected project's output subtree and skip archived site pages", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Export boundaries",
  ]);
  const other = await run([
    "projects",
    "create",
    "--name",
    "Other export boundaries",
  ]);
  const first = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Keep",
  ]);
  const removed = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Removed",
  ]);
  const out = join(home, "projects", project.id, "exports", "site");
  await run([
    "export",
    "--project",
    project.id,
    "--format",
    "site",
    "--out",
    out,
  ]);
  const previous = JSON.parse(
    await readFile(join(out, "showai-site.json"), "utf8"),
  );
  const operations = join(home, "archive-operations.json");
  await writeFile(
    operations,
    JSON.stringify([{ type: "page.set", fields: { archived: true } }]),
  );
  await run([
    "pages",
    "apply",
    removed.document.id,
    "--project",
    project.id,
    "--input",
    operations,
    "--base-hash",
    removed.hash,
  ]);
  const exported = await run([
    "export",
    "--project",
    project.id,
    "--format",
    "site",
    "--out",
    out,
    "--overwrite",
  ]);
  expect(exported.pageIds).toEqual([first.document.id]);
  expect(
    JSON.parse(await readFile(join(out, "showai-site.json"), "utf8")).pages,
  ).toHaveLength(1);
  const stale = previous.pages.find(
    (route: { id: string }) => route.id === first.document.id,
  );
  if (stale.file !== "index.html")
    await expect(access(join(out, stale.file))).rejects.toThrow();
  await expect(
    access(join(out, "sources", `${removed.document.id}.showai.json`)),
  ).rejects.toThrow();
  const single = await run([
    "export",
    "--project",
    project.id,
    "--page",
    first.document.id,
    "--format",
    "html",
    "--out",
    join(home, "projects", project.id, "exports", "page.html"),
  ]);
  expect(single.bytes).toBeGreaterThan(0);
  const forbidden = [
    first.path,
    join(home, "projects", project.id, "project.json"),
    join(home, "projects", other.id, "exports", "page.html"),
  ];
  const alias = join(home, "authoring-alias");
  await symlink(join(home, "projects", project.id), alias, "junction");
  forbidden.push(join(alias, "pages", "overwrite.html"));
  const escaped = join(home, "projects", project.id, "exports", "redirect");
  await symlink(join(home, "projects", other.id), escaped, "junction");
  forbidden.push(join(escaped, "pages", "overwrite.html"));
  for (const destination of forbidden) {
    const rejected = await execute(
      process.execPath,
      [
        cli,
        "export",
        "--project",
        project.id,
        "--page",
        first.document.id,
        "--format",
        "html",
        "--out",
        destination,
        "--overwrite",
        "--json",
      ],
      { env: environment() },
    ).then(
      () => {
        throw new Error("Unsafe export unexpectedly succeeded.");
      },
      (error) => error,
    );
    expect(JSON.parse(rejected.stdout).ok).toBe(false);
  }
  expect(
    (await run(["pages", "read", first.document.id, "--project", project.id]))
      .hash,
  ).toBe(first.hash);
});

test("progressive CLI discovery is paginated and keeps detailed content opt-in", async () => {
  const before = await run([
    "projects",
    "current",
    "--harness",
    "codex",
    "--session",
    "progressive-discovery",
  ]);
  expect(before).toMatchObject({ bound: false, project: null });
  const project = await run([
    "projects",
    "create",
    "--name",
    "Progressive discovery",
    "--harness",
    "codex",
    "--session",
    "progressive-discovery",
  ]);
  expect(
    (
      await run([
        "projects",
        "current",
        "--harness",
        "codex",
        "--session",
        "progressive-discovery",
      ])
    ).project.id,
  ).toBe(project.id);
  const guide = await run(["guide"]);
  expect(guide.topics.map((item: { topic: string }) => item.topic)).toContain(
    "versions",
  );
  expect(guide).not.toHaveProperty("source");
  const first = await run([
    "catalog",
    "list",
    "--kind",
    "component",
    "--project",
    project.id,
    "--limit",
    "2",
  ]);
  expect(first.items).toHaveLength(2);
  expect(first.nextCursor).toBeTruthy();
  const second = await run([
    "catalog",
    "list",
    "--kind",
    "component",
    "--project",
    project.id,
    "--limit",
    "2",
    "--cursor",
    first.nextCursor,
  ]);
  const keys = (items: { id: string; scope: string; version?: string }[]) =>
    items.map((item) => `${item.scope}:${item.id}:${item.version}`);
  expect(
    keys(second.items).some((key) => keys(first.items).includes(key)),
  ).toBe(false);
  for (const summary of [...first.items, ...second.items])
    for (const field of [
      "schema",
      "propsSchema",
      "defaultData",
      "examples",
      "html",
      "inline",
      "source",
      "document",
    ])
      expect(summary).not.toHaveProperty(field);
  const template = await run([
    "catalog",
    "describe",
    "research",
    "--kind",
    "template",
    "--project",
    project.id,
  ]);
  expect(template.scenarios.length).toBeGreaterThan(0);
  for (const field of [
    "document",
    "composition",
    "contentGuide",
    "examples",
    "source",
  ])
    expect(template).not.toHaveProperty(field);
  const detail = await run([
    "catalog",
    "describe",
    "research",
    "--kind",
    "template",
    "--view",
    "guide",
    "--project",
    project.id,
  ]);
  expect(detail.contentGuide).toBeDefined();
  expect(detail).not.toHaveProperty("document");
  const full = await run([
    "catalog",
    "describe",
    "research",
    "--kind",
    "template",
    "--view",
    "full",
    "--project",
    project.id,
  ]);
  expect(full.examples).toBeDefined();
  expect(full).not.toHaveProperty("document");
  const source = await run([
    "catalog",
    "describe",
    "research",
    "--kind",
    "template",
    "--view",
    "source",
    "--project",
    project.id,
  ]);
  expect(source.source.document || source.source.composition).toBeTruthy();
  const rejected = await execute(
    process.execPath,
    [
      cli,
      "catalog",
      "import",
      "--input",
      join(repository, "resources/catalog/value-slider"),
      "--json",
    ],
    { env: environment() },
  ).then(
    () => {
      throw new Error("Implicit global import unexpectedly succeeded.");
    },
    (error) => error,
  );
  expect(JSON.parse(rejected.stdout).error.message).toContain("--project");
});

test("real catalog versions promote explicitly, fork and resolve an immutable source merge", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Revision author",
  ]);
  const imported = await run([
    "catalog",
    "import",
    "--project",
    project.id,
    "--input",
    join(repository, "resources/catalog/value-slider"),
  ]);
  const baseRefPath = join(home, "revision-base.json");
  await writeFile(baseRefPath, JSON.stringify(imported.ref));
  const promoted = await run([
    "catalog",
    "promote",
    "--project",
    project.id,
    "--input",
    baseRefPath,
    "--to",
    "global",
  ]);
  expect(promoted.ref.scope).toBe("global");
  const globalSource = await run([
    "catalog",
    "describe",
    imported.id,
    "--scope",
    "global",
    "--version",
    imported.version,
    "--view",
    "source",
    "--file",
    "*",
  ]);
  const forkProject = await run([
    "projects",
    "create",
    "--name",
    "Revision fork",
  ]);
  const globalRefPath = join(home, "revision-global.json");
  await writeFile(globalRefPath, JSON.stringify(promoted.ref));
  const fork = await run([
    "catalog",
    "fork",
    "--project",
    forkProject.id,
    "--input",
    globalRefPath,
    "--id",
    "slider-fork",
    "--version",
    "1.0.0",
  ]);
  expect(fork).toMatchObject({
    id: "slider-fork",
    scope: "project",
    version: "1.0.0",
  });
  const source = globalSource.source;
  const makeRevision = async (version: string, padding: number) => {
    const path = join(home, `revision-${version}.json`);
    const revision = structuredClone(source);
    revision.manifest.version = version;
    revision.source = source.source.replace(
      "padding: 20",
      `padding: ${padding}`,
    );
    await writeFile(path, JSON.stringify(revision));
    return run(["catalog", "save", "--project", project.id, "--input", path]);
  };
  const ours = await makeRevision("1.2.0", 24);
  const theirs = await makeRevision("1.3.0", 28);
  const input = { base: imported.ref, ours: ours.ref, theirs: theirs.ref };
  const inputPath = join(home, "merge-input.json");
  const previewPath = join(home, "merge-candidate.json");
  await writeFile(inputPath, JSON.stringify(input));
  const summary = await run([
    "catalog",
    "merge",
    "preview",
    "--project",
    project.id,
    "--input",
    inputPath,
    "--out",
    previewPath,
  ]);
  expect(summary.conflictCount).toBeGreaterThan(0);
  expect(summary).not.toHaveProperty("merged");
  expect(
    summary.conflicts.every(
      (conflict: object) => !Object.hasOwn(conflict, "ours"),
    ),
  ).toBe(true);
  const preview = JSON.parse(await readFile(previewPath, "utf8"));
  const resolved = preview.merged;
  resolved.source = source.source.replace("padding: 20", "padding: 32");
  const resolutionPath = join(home, "merge-resolution.json");
  await writeFile(
    resolutionPath,
    JSON.stringify({ ...input, version: "1.4.0", resolved }),
  );
  const merged = await run([
    "catalog",
    "merge",
    "resolve",
    "--project",
    project.id,
    "--input",
    resolutionPath,
  ]);
  expect(merged).toMatchObject({ scope: "project", version: "1.4.0" });
  const code = await run([
    "catalog",
    "describe",
    merged.id,
    "--project",
    project.id,
    "--scope",
    "project",
    "--version",
    "1.4.0",
    "--view",
    "source",
  ]);
  expect(code.source).toContain("padding: 32");
  const dependencies = await run([
    "catalog",
    "describe",
    merged.id,
    "--project",
    project.id,
    "--scope",
    "project",
    "--version",
    "1.4.0",
    "--view",
    "dependencies",
  ]);
  expect(dependencies.parents).toHaveLength(2);
  expect(dependencies.mergeBase.integrity).toBe(imported.integrity);
  const unchanged = await run([
    "catalog",
    "describe",
    imported.id,
    "--scope",
    "global",
    "--version",
    imported.version,
    "--view",
    "source",
    "--file",
    "*",
  ]);
  expect(unchanged.integrity).toBe(globalSource.integrity);
  expect(unchanged.source.source).toBe(source.source);
  const reject = await execute(
    process.execPath,
    [
      cli,
      "catalog",
      "save",
      "--project",
      project.id,
      "--input",
      join(home, "revision-1.2.0.json"),
      "--json",
    ],
    { env: environment() },
  );
  expect(JSON.parse(reject.stdout).data.integrity).toBe(ours.integrity);
}, 30000);

test("CLI creates descriptive and composed templates and applies their exact dependencies", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Template composition",
  ]);
  const definition = {
    id: "evidence-part",
    version: "1.0.0",
    name: "Evidence",
    description: "An evidence section",
    scenarios: ["Explain one supported finding"],
    contentGuide: [
      {
        title: "Evidence",
        instructions: ["Name the source and the supported finding."],
      },
    ],
    related: [
      {
        kind: "component",
        id: "chart",
        purpose: "Show measured values when available.",
      },
    ],
    examples: [
      {
        name: "One finding",
        request: "Explain a finding",
        steps: [
          {
            kind: "component",
            id: "chart",
            purpose: "Present available measurements",
          },
        ],
      },
    ],
    composition: [
      {
        type: "content",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Inner evidence" }],
            },
          ],
        },
      },
    ],
  };
  const input = join(home, "template-evidence.json");
  await writeFile(input, JSON.stringify(definition));
  const inner = await run([
    "template",
    "save",
    "--project",
    project.id,
    "--input",
    input,
  ]);
  expect(inner.scenarios).toEqual(definition.scenarios);
  expect(inner).not.toHaveProperty("document");
  const outerInput = join(home, "template-report.json");
  await writeFile(
    outerInput,
    JSON.stringify({
      id: "composed-report",
      version: "1.0.0",
      name: "Composed report",
      description: "Evidence and conclusion",
      scenarios: ["Join reusable sections"],
      composition: [
        { type: "template", ref: inner.ref },
        {
          type: "content",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Outer conclusion" }],
              },
            ],
          },
        },
      ],
    }),
  );
  const outer = await run([
    "template",
    "save",
    "--project",
    project.id,
    "--input",
    outerInput,
  ]);
  const dependencies = await run([
    "catalog",
    "describe",
    outer.id,
    "--kind",
    "template",
    "--project",
    project.id,
    "--view",
    "dependencies",
  ]);
  expect(dependencies.dependencies).toContainEqual(
    expect.objectContaining({
      id: inner.id,
      integrity: inner.integrity,
      version: inner.version,
    }),
  );
  const page = await run([
    "template",
    "apply",
    outer.id,
    "--project",
    project.id,
    "--version",
    outer.version,
  ]);
  expect(JSON.stringify(page.document.content)).toContain("Inner evidence");
  expect(JSON.stringify(page.document.content)).toContain("Outer conclusion");
  const changed = {
    ...definition,
    description: "A changed section using an occupied revision",
  };
  await writeFile(input, JSON.stringify(changed));
  const conflict = await execute(
    process.execPath,
    [
      cli,
      "template",
      "save",
      "--project",
      project.id,
      "--input",
      input,
      "--json",
    ],
    { env: environment() },
  ).then(
    () => {
      throw new Error("A template revision was overwritten");
    },
    (error) => error,
  );
  expect(JSON.parse(conflict.stdout).ok).toBe(false);
  const reread = await run([
    "catalog",
    "describe",
    inner.id,
    "--kind",
    "template",
    "--project",
    project.id,
    "--view",
    "source",
  ]);
  expect(reread.source.description).toBe(definition.description);
});

test("bound MCP discloses catalog details on demand and cannot mutate shared or foreign libraries", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Bound catalog project",
  ]);
  const other = await run([
    "projects",
    "create",
    "--name",
    "Private catalog project",
  ]);
  const privateComponent = await run([
    "catalog",
    "import",
    "--project",
    other.id,
    "--input",
    join(repository, "resources/catalog/value-slider"),
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--project", project.id],
    env: Object.fromEntries(
      Object.entries(environment()).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    stderr: "pipe",
  });
  const client = new Client({
    name: "showai-progressive-test",
    version: "1.0.0",
  });
  const data = (result: unknown) =>
    JSON.parse((result as { content: { text: string }[] }).content[0].text);
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(
      tools.tools.some(
        (tool) =>
          tool.name.includes("promote") ||
          tool.name.includes("verify") ||
          tool.name.includes("register"),
      ),
    ).toBe(false);
    const guide = data(
      await client.callTool({ name: "guide", arguments: { topic: "catalog" } }),
    ).data;
    expect(guide.purpose).toContain("summaries");
    const summary = data(
      await client.callTool({
        name: "catalog_describe",
        arguments: { id: "chart" },
      }),
    ).data;
    expect(summary).not.toHaveProperty("schema");
    expect(summary).not.toHaveProperty("defaultData");
    expect(
      data(
        await client.callTool({
          name: "catalog_describe",
          arguments: { id: "chart", view: "schema" },
        }),
      ).data.schema,
    ).toBeDefined();
    const listing = data(
      await client.callTool({
        name: "catalog_list",
        arguments: { kind: "component", limit: 2 },
      }),
    ).data;
    expect(listing.items).toHaveLength(2);
    expect(listing.nextCursor).toBeTruthy();
    const escaped = data(
      await client.callTool({
        name: "catalog_fork",
        arguments: {
          ref: privateComponent.ref,
          version: "1.0.0",
          id: "escape-attempt",
        },
      }),
    );
    expect(escaped.error.code).toBe("INVALID_PATH");
    const unchanged = data(
      await client.callTool({
        name: "catalog_list",
        arguments: { kind: "component", scope: "project" },
      }),
    ).data;
    expect(unchanged.items).toHaveLength(0);
    const privateSource = await run([
      "catalog",
      "describe",
      privateComponent.id,
      "--project",
      other.id,
      "--scope",
      "project",
      "--view",
      "source",
      "--file",
      "*",
    ]);
    const created = data(
      await client.callTool({
        name: "component_save",
        arguments: {
          source: {
            ...privateSource.source,
            manifest: {
              ...privateSource.source.manifest,
              id: "bound-component",
              version: "1.0.0",
            },
          },
        },
      }),
    );
    expect(created.ok).toBe(true);
    expect(created.data.scope).toBe("project");
    const full = data(
      await client.callTool({
        name: "catalog_describe",
        arguments: { id: "bound-component", scope: "project", view: "full" },
      }),
    ).data;
    expect(full.schema).toBeDefined();
    for (const key of ["source", "html", "inline", "files"])
      expect(full).not.toHaveProperty(key);
    const explicit = data(
      await client.callTool({
        name: "catalog_describe",
        arguments: { id: "bound-component", scope: "project", view: "source" },
      }),
    ).data;
    expect(explicit.source).toContain("export default");
  } finally {
    await client.close();
  }
}, 30000);

test("catalog search indexes descriptive examples while returning only summaries", async () => {
  const rectangle = await run([
    "catalog",
    "list",
    "--kind",
    "component",
    "--query",
    "矩形",
    "--limit",
    "5",
  ]);
  expect(
    rectangle.items.some((item: { id: string }) => item.id === "playground"),
  ).toBe(true);
  const project = await run([
    "projects",
    "create",
    "--name",
    "Metadata search",
  ]);
  const requestOnly = "专用陀螺仪请求案例";
  const bodyOnly = "unindexed-template-body-sentinel";
  const input = join(home, "request-search-template.json");
  await writeFile(
    input,
    JSON.stringify({
      id: "metadata-search-template",
      version: "1.0.0",
      name: "Metadata search template",
      description: "A section for checking discovery",
      scenarios: ["Review a small supported finding"],
      contentGuide: [{ title: "Evidence", instructions: ["检查校准温度标签"] }],
      related: [
        { kind: "component", id: "playground", purpose: "展示传感器误差边界" },
      ],
      examples: [{ name: "Example one", request: requestOnly, steps: [] }],
      composition: [
        {
          type: "content",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: bodyOnly }],
              },
            ],
          },
        },
      ],
    }),
  );
  const saved = await run([
    "template",
    "save",
    "--project",
    project.id,
    "--input",
    input,
  ]);
  for (const query of [requestOnly, "校准温度", "传感器误差"]) {
    const result = await run([
      "catalog",
      "list",
      "--kind",
      "template",
      "--scope",
      "project",
      "--project",
      project.id,
      "--query",
      query,
    ]);
    expect(result.items.map((item: { id: string }) => item.id)).toEqual([
      saved.id,
    ]);
    for (const field of [
      "examples",
      "contentGuide",
      "related",
      "schema",
      "propsSchema",
      "defaultData",
      "document",
      "composition",
      "source",
      "html",
      "inline",
    ])
      expect(result.items[0]).not.toHaveProperty(field);
  }
  const hidden = await run([
    "catalog",
    "list",
    "--project",
    project.id,
    "--query",
    bodyOnly,
  ]);
  expect(hidden.items).toHaveLength(0);
  const runtimeOnly = await run([
    "catalog",
    "list",
    "--project",
    project.id,
    "--query",
    "fontVariantNumeric",
  ]);
  expect(runtimeOnly.items).toHaveLength(0);
  const builtin = await run(["catalog", "describe", "playground"]);
  expect(Object.keys(builtin.next).sort()).toEqual(
    ["guide", "schema", "examples", "dependencies", "source"].sort(),
  );
  const unavailable = await run([
    "catalog",
    "describe",
    "playground",
    "--view",
    "source",
  ]);
  expect(unavailable.source).toContain("showai:components");
  expect(unavailable.next).toHaveProperty("source");
});
