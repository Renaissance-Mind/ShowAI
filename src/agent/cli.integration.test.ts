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
import { parseArtifact } from "../portable/validation.mjs";
import { GitLibrary } from "../core/git-library";
import { FileStore } from "../core/store";

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

async function run(
  args: string[],
  options: { cwd?: string; home?: string } = {},
) {
  const output = await execute(process.execPath, [cli, ...args, "--json"], {
    env: { ...environment(), SHOWAI_HOME: options.home ?? home },
    cwd: options.cwd,
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
  // This shared fixture exercises the retained file-library protocol. New empty
  // homes have separate versioned tests and now initialize history automatically.
  await new FileStore(home).createProject({ name: "Legacy protocol fixture" });
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

test("CLI prepares and activates an old library, and MCP restores an imported checkpoint with project scope and retry identity", async () => {
  const old = join(home, "legacy-import-source"),
    target = join(home, "legacy-import-target");
  await new FileStore(old).createProject({ name: "Legacy import fixture" });
  const local = (args: string[], root = old) => run(args, { home: root });
  const project = await local([
    "projects",
    "create",
    "--name",
    "Import API project",
  ]);
  const original = await local([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "旧的可恢复内容",
  ]);
  const originalBytes = await readFile(original.path);
  const report = await local(
    [
      "library",
      "import",
      "--source",
      old,
      "--harness",
      "codex",
      "--session",
      "import-api-session",
    ],
    target,
  );
  const repeated = await local(["library", "import", "--source", old], target);
  expect(repeated.id).toBe(report.id);
  await local(["library", "activate", report.id], target);
  const current = await local(
    ["pages", "read", original.document.id, "--project", project.id],
    target,
  );
  expect(current.revision).toBeTruthy();
  expect(await readFile(original.path)).toEqual(originalBytes);
  expect((await new GitLibrary(target).history())[0].actor).toMatchObject({
    kind: "agent",
    harness: "codex",
    sessionId: "import-api-session",
  });
  const snapshots = await local(
    [
      "history",
      "imported",
      "--project",
      project.id,
      "--page",
      original.document.id,
    ],
    target,
  );
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots[0].editTime).toBeNull();
  const readSnapshot = await local(
    [
      "history",
      "snapshot",
      original.document.id,
      "--project",
      project.id,
      "--import",
      report.id,
      "--snapshot",
      snapshots[0].id,
    ],
    target,
  );
  expect(readSnapshot.document.title).toBe(original.document.title);
  const client = new Client({ name: "import-api-client", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        cli,
        "mcp",
        "--home",
        target,
        "--project",
        project.id,
        "--harness",
        "codex",
        "--session",
        "import-mcp-session",
      ],
      env: Object.fromEntries(
        Object.entries(environment()).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    }),
  );
  const unpack = (result: unknown) =>
    JSON.parse((result as { content: { text: string }[] }).content[0].text);
  try {
    const inputs = {
      pageId: original.document.id,
      importId: report.id,
      snapshotId: snapshots[0].id,
      baseRevision: current.revision,
      operationId: "import-restore-retry",
    };
    const restored = unpack(
      await client.callTool({
        name: "history_restore_imported_snapshot",
        arguments: inputs,
      }),
    );
    expect(restored.ok).toBe(true);
    expect(
      unpack(
        await client.callTool({
          name: "history_restore_imported_snapshot",
          arguments: inputs,
        }),
      ),
    ).toEqual(restored);
    const entries = await new GitLibrary(target).history();
    expect(entries[0].actor).toMatchObject({
      kind: "agent",
      sessionId: "import-mcp-session",
    });
    expect(entries[0].restoredSnapshot).toEqual({
      importId: report.id,
      snapshotId: snapshots[0].id,
    });
    const other = await local(
      ["projects", "create", "--name", "Foreign project"],
      target,
    );
    const foreign = await local(
      ["pages", "create", "--project", other.id, "--title", "Private"],
      target,
    );
    expect(
      unpack(
        await client.callTool({
          name: "history_imported_page",
          arguments: {
            pageId: foreign.document.id,
            importId: report.id,
            snapshotId: snapshots[0].id,
          },
        }),
      ).ok,
    ).toBe(false);
  } finally {
    await client.close();
  }
}, 30000);

test("external runtime records an executable launch and exposes only relevant guides", async () => {
  const info = await run(["runtime", "info"]);
  expect(info.protocol).toBe(1);
  expect(info.projectResolution.mode).toBe("directory");
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

test("native catalog guides insert Page and Board through the common component operation", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Native components",
  ]);
  const created = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Nested components",
  ]);
  let page = created;
  for (const kind of ["board", "page"]) {
    const guide = await run([
      "catalog",
      "describe",
      kind,
      "--scope",
      "builtin",
      "--view",
      "guide",
    ]);
    expect(guide.usage.nodeType).toBe("surface");
    expect(guide.next.source).toBeUndefined();
    const operations = join(home, "native-component-operations.json");
    const destination =
      kind === "board"
        ? page.document.content
        : page.document.content.content.find(
            (node: { type: string }) => node.type === "surface",
          );
    await writeFile(
      operations,
      JSON.stringify([
        {
          ...guide.usage.operation,
          parentId: destination.attrs.id,
        },
      ]),
    );
    page = await run([
      "pages",
      "apply",
      created.document.id,
      "--project",
      project.id,
      "--input",
      operations,
      "--base-hash",
      page.hash,
    ]);
  }
  const board = page.document.content.content.find(
    (node: { type: string }) => node.type === "surface",
  );
  expect(board.attrs.kind).toBe("board");
  expect(
    board.content.find((node: { type: string }) => node.type === "surface")
      .attrs.kind,
  ).toBe("page");
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
  const defaultProject = await run(["projects", "current"]);
  expect(await run(["pages", "list"])).toEqual(
    await run(["pages", "list", "--project", defaultProject.project.id]),
  );
});

test("real CLI and MCP export selected components and repeat focused updates without changing the full page", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Partial monitor",
  ]);
  const component = await run([
    "catalog",
    "import",
    "--project",
    project.id,
    "--input",
    join(repository, "resources/catalog/value-slider"),
  ]);
  const examples = await run([
    "catalog",
    "describe",
    component.id,
    "--project",
    project.id,
    "--view",
    "examples",
  ]);
  const input = join(home, "partial-page-input.json");
  await writeFile(
    input,
    JSON.stringify({
      id: "partial-monitor",
      title: "Complete monitoring report",
      comments: [],
      content: {
        type: "surface",
        content: [
          {
            type: "region",
            attrs: { id: "status", name: "Progress" },
            content: [
              {
                type: "widget",
                attrs: {
                  id: "progress",
                  kind: "metrics",
                  data: {
                    title: "Processing progress",
                    items: [{ label: "Completed", value: 62, unit: "%" }],
                  },
                },
              },
              {
                type: "paragraph",
                attrs: { id: "explanation" },
                content: [{ type: "text", text: "UNRELATED EXPLANATION" }],
              },
            ],
          },
          {
            type: "widget",
            attrs: {
              id: "control",
              kind: "custom",
              data: {
                componentId: component.id,
                version: component.version,
                integrity: component.integrity,
                props: examples.defaultData,
              },
            },
          },
        ],
      },
      layout: {
        status: { x: 2000, y: 900, width: 700, mode: "flow" },
        control: { x: 4000, y: 900, width: 400 },
      },
      views: { initial: null, saved: [], readingOrder: ["control", "status"] },
    }),
  );
  const page = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--input",
    input,
  ]);
  const pagePath = join(
    home,
    "projects",
    project.id,
    "pages",
    `${page.document.id}.json`,
  );
  const before = await readFile(pagePath, "utf8");
  const args = ["export", "--project", project.id, "--page", page.document.id];
  const out = join(home, "progress-only.html");
  const exported = await run([
    ...args,
    "--blocks",
    "progress",
    "--format",
    "inline",
    "--out",
    out,
  ]);
  expect(exported.blockIds).toEqual(["progress"]);
  const artifact = parseArtifact(
    await readFile(exported.sourcePaths[0], "utf8"),
  );
  expect(artifact.presentation).toBe("reading");
  expect(artifact.selection).toEqual({ blockIds: ["progress"] });
  expect(artifact.components).toBeUndefined();
  expect(JSON.stringify(artifact.document.content)).not.toContain("UNRELATED");
  expect(JSON.stringify(artifact.document.content)).not.toContain('"control"');
  expect(Object.keys(artifact.document.layout!)).toEqual(["status"]);
  expect(await readFile(pagePath, "utf8")).toBe(before);
  const inline = await readFile(out, "utf8");
  expect(inline).toContain("data-showai-inline-root");
  expect(inline).not.toContain("UNRELATED EXPLANATION");

  const ops = join(home, "partial-update-ops.json");
  await writeFile(
    ops,
    JSON.stringify([
      {
        type: "block.attrs.set",
        blockId: "progress",
        attrs: {
          data: {
            title: "Processing progress",
            items: [{ label: "Completed", value: 78, unit: "%" }],
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
    "--base-hash",
    page.hash,
    "--input",
    ops,
  ]);
  await run([
    ...args,
    "--blocks",
    "progress",
    "--format",
    "inline",
    "--out",
    out,
    "--overwrite",
  ]);
  const refreshed = parseArtifact(
    await readFile(exported.sourcePaths[0], "utf8"),
  );
  expect(
    refreshed.document.content.content?.[0].content?.[0].attrs?.data.items[0]
      .value,
  ).toBe(78);
  expect(JSON.stringify(updated.document.content)).toContain(
    "UNRELATED EXPLANATION",
  );

  const chosen = await run([
    ...args,
    "--blocks",
    "progress,control",
    "--format",
    "inline",
    "--out",
    join(home, "selected-components.html"),
  ]);
  const selected = parseArtifact(await readFile(chosen.sourcePaths[0], "utf8"));
  expect(selected.components).toHaveLength(1);
  expect(selected.components?.[0].inline?.script).toBeTruthy();
  expect(selected.document.views?.readingOrder).toEqual(["control", "status"]);
  expect(
    selected.document.content.content?.map((node) => node.attrs?.id),
  ).toEqual(["status", "control"]);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--project", project.id],
    env: environment() as Record<string, string>,
  });
  const client = new Client({ name: "partial-export-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "page_export",
      arguments: {
        pageId: page.document.id,
        blockIds: ["control"],
        format: "html",
        out: join(home, "mcp-selected.html"),
      },
    });
    expect(result.isError).not.toBe(true);
    const data = JSON.parse(
      (result.content as { text: string }[])[0].text,
    ).data;
    expect(data.blockIds).toEqual(["control"]);
    const selected = parseArtifact(await readFile(data.sourcePaths[0], "utf8"));
    expect(selected.document.content.content).toHaveLength(1);
    expect(selected.components).toHaveLength(1);
  } finally {
    await client.close();
  }

  for (const ids of [
    "missing",
    "progress,missing",
    "progress,",
    "progress,progress",
    " ",
  ])
    await expect(
      run([
        ...args,
        "--blocks",
        ids,
        "--format",
        "html",
        "--out",
        join(home, "invalid-partial.html"),
      ]),
    ).rejects.toThrow();
  await expect(
    run([
      ...args,
      "--blocks",
      "progress",
      "--format",
      "site",
      "--out",
      join(home, "invalid-site"),
    ]),
  ).rejects.toThrow("not site");
  await expect(access(join(home, "invalid-partial.html"))).rejects.toThrow();
}, 30000);

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

test("directory projects are shared across sessions, canonical paths and concurrent first use", async () => {
  const library = await mkdtemp(join(home, "directory-library-"));
  const workspace = await mkdtemp(join(home, "directory-workspace-"));
  const other = await mkdtemp(join(home, "other-workspace-"));
  const nested = join(workspace, "src");
  await mkdir(nested);
  await execute("git", ["init", "--quiet", workspace]);
  const runHere = (args: string[], cwd = workspace) =>
    run(args, { home: library, cwd });
  const firstUse = await Promise.all([
    runHere(["projects", "current", "--harness", "codex", "--session", "one"]),
    runHere(["projects", "current", "--harness", "codex", "--session", "two"]),
  ]);
  expect(firstUse[0].project.id).toBe(firstUse[1].project.id);
  expect(firstUse.filter((item) => item.created)).toHaveLength(1);
  const root = firstUse[0];
  expect(root).toMatchObject({
    bound: true,
    resolution: "directory",
    home: library,
  });
  expect((await runHere(["projects", "current"], nested)).project.id).toBe(
    root.project.id,
  );
  const alias = join(home, "directory-alias");
  await symlink(workspace, alias, "dir");
  expect(
    (await runHere(["projects", "current", "--source-directory", alias]))
      .project.id,
  ).toBe(root.project.id);
  const exact = await runHere([
    "projects",
    "current",
    "--source-directory",
    nested,
  ]);
  expect(exact.project.id).not.toBe(root.project.id);
  const elsewhere = await runHere(
    ["projects", "current", "--harness", "codex", "--session", "one"],
    other,
  );
  expect(elsewhere.project.id).not.toBe(root.project.id);
  const page = await runHere([
    "pages",
    "create",
    "--title",
    "Directory report",
  ]);
  expect(
    (await runHere(["pages", "list"], nested)).map(
      (item: { id: string }) => item.id,
    ),
  ).toContain(page.document.id);
  expect(await runHere(["pages", "list"], other)).toEqual([]);
  const manual = await runHere([
    "projects",
    "create",
    "--name",
    "Explicit destination",
  ]);
  expect(
    await runHere([
      "projects",
      "current",
      "--project",
      manual.id,
      "--source-directory",
      "/does-not-exist",
    ]),
  ).toMatchObject({
    resolution: "explicit",
    created: false,
    project: { id: manual.id },
  });
  await runHere([
    "pages",
    "create",
    "--project",
    manual.id,
    "--title",
    "Explicit page",
  ]);
  expect(await runHere(["pages", "list"])).toHaveLength(1);
  expect(await runHere(["pages", "list", "--project", manual.id])).toHaveLength(
    1,
  );
  expect(await runHere(["projects", "list"])).toHaveLength(4);
  const client = new Client({ name: "directory-client", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp"],
      cwd: nested,
      env: Object.fromEntries(
        Object.entries({ ...environment(), SHOWAI_HOME: library }).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    }),
  );
  try {
    const context = await client.callTool({
      name: "project_context",
      arguments: {},
    });
    const payload = JSON.parse(
      (context.content as { text: string }[])[0].text,
    ).data;
    expect(payload.project.id).toBe(root.project.id);
    expect(payload.root).toBe(library);
  } finally {
    await client.close();
  }
  const { pageCount: _count, ...archivedProject } = (
    await new FileStore(library).listProjects()
  ).find((item) => item.id === root.project.id)!;
  await new GitLibrary(library).writeFiles(
    new Map([
      [
        `projects/${root.project.id}/project.json`,
        Buffer.from(JSON.stringify({ ...archivedProject, archived: true })),
      ],
    ]),
    { actor: { kind: "human" }, channel: "system" },
  );
  await expect(runHere(["projects", "current"])).rejects.toThrow("archived");
}, 20000);

test("progressive CLI discovery is paginated and keeps detailed content opt-in", async () => {
  const project = await run([
    "projects",
    "create",
    "--name",
    "Progressive discovery",
  ]);
  expect(
    (await run(["projects", "current", "--project", project.id])).project.id,
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
  const imported = await run([
    "catalog",
    "import",
    "--input",
    join(repository, "resources/catalog/value-slider"),
  ]);
  expect(imported.scope).toBe("project");
  expect(
    (
      await run([
        "catalog",
        "list",
        "--scope",
        "global",
        "--query",
        "value-slider",
      ])
    ).items,
  ).toEqual([]);
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
      /padding:\s*(?:["'][^"']*["']|\d+)/,
      `padding: ${padding}`,
    );
    expect(revision.source).not.toBe(source.source);
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
  resolved.source = source.source.replace(
    /padding:\s*(?:["'][^"']*["']|\d+)/,
    "padding: 32",
  );
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

test("versioned CLI and MCP propagate identities, conditional revisions and replay completed requests", async () => {
  const root = await mkdtemp(join(home, "versioned-cli-"));
  const workspace = await mkdtemp(join(home, "versioned-workspace-"));
  const library = new GitLibrary(root);
  await library.initialize();
  const runHere = (args: string[], session = "versioned-one") =>
    run(
      [
        ...args,
        "--source-directory",
        workspace,
        "--harness",
        "codex",
        "--session",
        session,
      ],
      { home: root, cwd: workspace },
    );
  const create = [
    "pages",
    "create",
    "--title",
    "Versioned report",
    "--operation-id",
    "create-report",
  ];
  const initial = await runHere(create);
  const project = (await runHere(["projects", "current"])).project;
  expect(initial.revision).toBeTruthy();
  expect(await library.history()).toHaveLength(1);
  const operations = join(home, "versioned-edit.json");
  await writeFile(
    operations,
    JSON.stringify([{ type: "page.set", fields: { title: "Edited report" } }]),
  );
  const edited = await runHere(
    [
      "pages",
      "apply",
      initial.document.id,
      "--input",
      operations,
      "--base-hash",
      initial.hash,
      "--base-revision",
      initial.revision,
    ],
    "versioned-two",
  );
  expect(edited.revision).not.toBe(initial.revision);
  expect(await runHere(create)).toEqual(initial);
  expect(await runHere(["pages", "list"])).toHaveLength(1);
  expect((await library.history())[0].actor.sessionId).toBe("versioned-two");
  const read = await runHere([
    "pages",
    "read",
    initial.document.id,
    "--rendered",
    "false",
  ]);
  expect(read.revision).toBe(edited.revision);
  await expect(
    runHere([
      "pages",
      "apply",
      initial.document.id,
      "--input",
      operations,
      "--base-hash",
      edited.hash,
      "--base-revision",
      initial.revision,
    ]),
  ).rejects.toThrow("newer revision");
  const client = new Client({ name: "versioned-mcp-client", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        cli,
        "mcp",
        "--home",
        root,
        "--project",
        project.id,
        "--harness",
        "codex",
        "--session",
        "mcp-versioned",
      ],
      env: Object.fromEntries(
        Object.entries(environment()).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    }),
  );
  const unpack = (value: unknown) =>
    JSON.parse((value as { content: { text: string }[] }).content[0].text);
  try {
    const input = {
      pageId: initial.document.id,
      baseHash: edited.hash,
      baseRevision: edited.revision,
      operations: [{ type: "page.set", fields: { title: "MCP report" } }],
      operationId: "mcp-edit-report",
      message: "Update title",
    };
    const saved = unpack(
      await client.callTool({ name: "page_apply", arguments: input }),
    );
    expect(saved.ok).toBe(true);
    expect(
      unpack(await client.callTool({ name: "page_apply", arguments: input })),
    ).toEqual(saved);
    expect((await library.history())[0]).toMatchObject({
      actor: { kind: "agent", harness: "codex", sessionId: "mcp-versioned" },
      channel: "mcp",
      message: "Update title",
    });
    expect(
      unpack(
        await client.callTool({
          name: "page_apply",
          arguments: {
            ...input,
            operations: [{ type: "page.set", fields: { title: "different" } }],
          },
        }),
      ).error.code,
    ).toBe("CONFLICT");
  } finally {
    await client.close();
  }
});

test("versioned history/search/merge/restore are reachable from CLI and project-bound MCP", async () => {
  const root = await mkdtemp(join(home, "history-api-"));
  const local = (args: string[]) => run(args, { home: root });
  await local(["library", "init"]);
  const project = await local(["projects", "create", "--name", "History API"]);
  const first = await local([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Historical report",
  ]);
  const ops = join(home, "history-body.json");
  await writeFile(
    ops,
    JSON.stringify([
      {
        type: "block.text.set",
        blockId: first.document.content.content[0].attrs.id,
        text: "论文图表检索证据",
      },
    ]),
  );
  const second = await local([
    "pages",
    "apply",
    first.document.id,
    "--project",
    project.id,
    "--input",
    ops,
    "--base-hash",
    first.hash,
    "--base-revision",
    first.revision,
  ]);
  expect(
    (await local(["search", "--query", "图表", "--project", project.id]))
      .items[0].blockId,
  ).toBe(first.document.content.content[0].attrs.id);
  const history = await local([
    "history",
    "list",
    "--project",
    project.id,
    "--page",
    first.document.id,
  ]);
  expect(history.items).toHaveLength(2);
  const comparison = await local([
    "history",
    "compare",
    "--project",
    project.id,
    "--page",
    first.document.id,
    "--before",
    first.revision,
    "--after",
    second.revision,
  ]);
  expect(comparison.changes.length).toBeGreaterThan(0);
  expect(
    (
      await local([
        "history",
        "read",
        first.document.id,
        "--project",
        project.id,
        "--revision",
        first.revision,
      ])
    ).document,
  ).toEqual(first.document);
  const html = await local([
    "history",
    "read",
    first.document.id,
    "--project",
    project.id,
    "--revision",
    first.revision,
    "--view",
    "html",
  ]);
  expect(html.reader.integrity).toMatch(/^[a-f0-9]{64}$/);
  expect(html.html).toContain("showai-data");
  const historicOut = join(root, "historical-reader-export.html");
  await local([
    "export",
    "--project",
    project.id,
    "--page",
    first.document.id,
    "--revision",
    first.revision,
    "--format",
    "html",
    "--out",
    historicOut,
  ]);
  expect(await readFile(historicOut, "utf8")).toContain("Historical report");
  const stats = await local(["library", "stats"]);
  expect(stats.categories.repository.bytes).toBeGreaterThan(0);
  const currentHead = await new GitLibrary(root).head();
  await local(["library", "compact"]);
  expect(await new GitLibrary(root).head()).toBe(currentHead);
  const cleanPlan = await local(["library", "cleanup-plan"]);
  await local(["library", "cleanup", cleanPlan.id]);
  const restoreArgs = [
    "history",
    "restore",
    first.document.id,
    "--project",
    project.id,
    "--revision",
    first.revision,
    "--base-revision",
    second.revision,
    "--operation-id",
    "restore-history-api",
  ];
  const restored = await local(restoreArgs);
  expect(await local(restoreArgs)).toEqual(restored);
  expect(
    (
      await local([
        "history",
        "list",
        "--project",
        project.id,
        "--page",
        first.document.id,
      ])
    ).items[0].restoredFrom,
  ).toBe(first.revision);
  const client = new Client({ name: "history-api-client", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--home", root, "--project", project.id],
      env: Object.fromEntries(
        Object.entries(environment()).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    }),
  );
  const unpack = (result: unknown) =>
    JSON.parse((result as { content: { text: string }[] }).content[0].text);
  try {
    expect(
      unpack(
        await client.callTool({
          name: "history_list",
          arguments: { pageId: first.document.id },
        }),
      ).data.items,
    ).toHaveLength(3);
    expect(
      unpack(
        await client.callTool({
          name: "history_page",
          arguments: { pageId: first.document.id, revision: second.revision },
        }),
      ).data.document.content.content[0].content[0].text,
    ).toBe("论文图表检索证据");
    const rendered = unpack(
      await client.callTool({
        name: "history_html",
        arguments: { pageId: first.document.id, revision: second.revision },
      }),
    ).data;
    expect(rendered.html).toContain("论文图表检索证据");
    expect(rendered.reader.integrity).toMatch(/^[a-f0-9]{64}$/);
    expect(
      unpack(
        await client.callTool({
          name: "library_search",
          arguments: { query: "图表" },
        }),
      ).data.items,
    ).toEqual([]);
    expect(
      unpack(
        await client.callTool({ name: "workspace_conflicts", arguments: {} }),
      ).data,
    ).toEqual([]);
  } finally {
    await client.close();
  }
});
