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
    banner: {
      js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
    },
  });
}, 30000);

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(bundleDirectory, { recursive: true, force: true });
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
  expect(catalog.some((item: { id: string }) => item.id === "blank")).toBe(
    true,
  );
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
  expect(builtin.propsSchema).toBeDefined();
  const component = await run([
    "catalog",
    "import",
    "--project",
    project.id,
    "--input",
    join(repository, "resources/catalog/value-slider"),
  ]);
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
              props: component.defaultData,
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
            props: { ...component.defaultData, value: "invalid number" },
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
