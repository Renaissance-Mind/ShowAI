import { rawSourcePlugin } from "../../scripts/raw-source-plugin.mjs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import {
  copyFile,
  cp,
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
import { gunzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseArtifact } from "../portable/validation.mjs";
import { ContentLibrary as GitLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { readAgentConnections } from "./mcp-connections";

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
  await copyFile(
    join(repository, "dist-agent/index-worker.mjs"),
    join(bundleDirectory, "index-worker.mjs"),
  );
}, 30000);

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(bundleDirectory, { recursive: true, force: true });
});

test("public CLI and stdio render customized content without creating a personal project or sync connection", async () => {
  const isolated = await mkdtemp(join(tmpdir(), "showai-public-cli-"));
  const output = join(isolated, "output", "page.html");
  const library = join(isolated, "library");
  try {
    const templates = await run(["public", "list", "--kind", "template"], {
      home: library,
    });
    expect(
      templates.items.some(
        (item: { id: string }) => item.id === "paper-explainer",
      ),
    ).toBe(true);
    const rendered = await run(
      [
        "render",
        "--template",
        "paper-explainer",
        "--title",
        "A standalone presentation",
        "--out",
        output,
      ],
      { home: library },
    );
    expect(rendered.persistence).toEqual({
      savedToProject: false,
      synchronized: false,
    });
    expect(await readFile(rendered.delivery.html, "utf8")).toContain(
      "A standalone presentation",
    );
    expect(await readFile(rendered.delivery.inline, "utf8")).toContain(
      "data-showai-inline-root",
    );
    expect(
      await access(library).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    const client = new Client({ name: "public-stdio-test", version: "1.0.0" });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [cli, "mcp", "--public", "--home", library],
          env: environment() as Record<string, string>,
        }),
      );
      const tools = await client.listTools();
      expect(tools.tools.map((item) => item.name)).toContain("render_document");
      expect(tools.tools.map((item) => item.name)).not.toContain("page_save");
      const response = await client.callTool({
        name: "render_document",
        arguments: {
          templateId: "system-presentation",
          title: "Public MCP rendering",
        },
      });
      expect(response.isError).not.toBe(true);
      const receipt = (
        response.structuredContent as {
          data: { delivery: { html: string }; persistence: unknown };
        }
      ).data;
      expect(receipt.persistence).toEqual({
        savedToProject: false,
        synchronized: false,
      });
      expect(await readFile(receipt.delivery.html, "utf8")).toContain(
        "Public MCP rendering",
      );
    } finally {
      await client.close();
    }
    expect((await new FileStore(library).listProjects()).length).toBe(0);
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}, 60_000);

test("show_component shows conversation components without a project and saves the same blocks later", async () => {
  const isolated = await mkdtemp(join(tmpdir(), "showai-show-component-"));
  const library = join(isolated, "library");
  const hostDirectory = join(isolated, "host");
  const chart = {
    kind: "chart",
    data: {
      title: "p95 延迟",
      type: "line",
      unit: "ms",
      labels: ["周一", "周二", "周三"],
      series: [{ name: "API", values: [182, 240, 196] }],
    },
  };
  const connect = async (args: string[], env: Record<string, string> = {}) => {
    const client = new Client({
      name: "show-component-test",
      version: "1.0.0",
    });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cli, "mcp", ...args, "--home", library],
        env: {
          ...(Object.fromEntries(
            Object.entries(environment()).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          ) as Record<string, string>),
          ...env,
        },
      }),
    );
    return client;
  };
  type Shown = {
    data: {
      delivery: { mode: string; inline?: string; compact?: string };
      persistence: { savedToProject: boolean; files: string };
      components: { kind: string }[];
      warnings?: string[];
    };
  };
  try {
    const publicClient = await connect(["--public"]);
    try {
      const tools = await publicClient.listTools();
      const show = tools.tools.find((item) => item.name === "show_component");
      expect(show?._meta?.ui).toEqual({
        resourceUri: "ui://showai/component-v1.html",
      });
      const resource = await publicClient.readResource({
        uri: "ui://showai/component-v1.html",
      });
      expect(
        String((resource.contents[0] as { text?: string }).text),
      ).toContain("ShowAI 组件");
      const shown = await publicClient.callTool({
        name: "show_component",
        arguments: { ...chart, title: "延迟" },
      });
      expect(shown.isError).not.toBe(true);
      const receipt = (shown.structuredContent as Shown).data;
      expect(receipt.delivery.mode).toBe("mcp-app");
      expect(receipt.persistence).toEqual({
        savedToProject: false,
        files: "none",
      });
      expect(receipt.components).toEqual([{ kind: "chart" }]);
      expect(receipt.warnings?.[0]).toContain("declared no host display");
      expect(
        (shown._meta as { showai: { inline: string } }).showai.inline,
      ).toContain("data-showai-inline-root");
      const image = await publicClient.callTool({
        name: "show_component",
        arguments: { ...chart, delivery: "image", theme: "dark" },
      });
      expect(image.isError).not.toBe(true);
      expect((image.structuredContent as Shown).data.delivery.mode).toBe(
        "image",
      );
      const png = (image.content as { type: string; data?: string }[]).find(
        (item) => item.type === "image",
      );
      expect(Buffer.from(png!.data!, "base64").subarray(1, 4).toString()).toBe(
        "PNG",
      );
      // Compact text needs a CDN reader; without one the host gets an image.
      const compact = (
        (
          await publicClient.callTool({
            name: "show_component",
            arguments: { ...chart, delivery: "compact" },
          })
        ).structuredContent as Shown
      ).data;
      if (compact.delivery.mode === "compact")
        expect(compact.delivery.compact).toContain("data-showai");
      else expect(compact.warnings?.join(" ")).toContain("image");
      const tooMany = await publicClient.callTool({
        name: "show_component",
        arguments: { blocks: Array(6).fill(chart) },
      });
      expect(tooMany.isError).toBe(true);
      const document = await publicClient.callTool({
        name: "show_component",
        arguments: { kind: "page", data: {} },
      });
      expect(document.isError).toBe(true);
      expect(JSON.stringify(document.content)).toContain("page_present");
    } finally {
      await publicClient.close();
    }
    expect(
      await access(library).then(
        () => true,
        () => false,
      ),
    ).toBe(false);

    const project = await run(["projects", "create", "--name", "Show"], {
      home: library,
    });
    // The plugin launcher passes SHOWAI_PRESENTATION_DIR as this option.
    const codex = await connect(["--presentation-directory", hostDirectory], {
      SHOWAI_HOST_DISPLAY: "codex-visualize",
    });
    try {
      const capabilities = await codex.callTool({
        name: "showai_capabilities",
        arguments: {},
      });
      const presentation = (
        capabilities.structuredContent as {
          data: {
            presentation: {
              declaredHostDisplay: string;
              show: { maxComponents: number };
            };
          };
        }
      ).data.presentation;
      expect(presentation.declaredHostDisplay).toBe("codex-visualize");
      expect(presentation.show.maxComponents).toBe(5);
      const shown = await codex.callTool({
        name: "show_component",
        arguments: {
          blocks: [
            chart,
            {
              kind: "metrics",
              data: { items: [{ label: "峰值", value: 240, unit: "ms" }] },
            },
          ],
        },
      });
      expect(shown.isError).not.toBe(true);
      const receipt = (shown.structuredContent as Shown).data;
      expect(receipt.delivery.mode).toBe("fragment-file");
      expect(receipt.delivery.inline).toContain(
        join(hostDirectory, "show-components"),
      );
      expect(await readFile(receipt.delivery.inline!, "utf8")).toContain(
        "data-showai-inline-root",
      );
      expect(receipt.persistence.files).toBe("preview-directory");
      expect(receipt.warnings).toBeUndefined();
      const pages = await codex.callTool({
        name: "pages_list",
        arguments: { projectId: project.id },
      });
      expect(
        (pages.structuredContent as { data: unknown[] }).data,
      ).toHaveLength(0);
      // Keeping a shown component reuses the same blocks unchanged.
      const saved = await codex.callTool({
        name: "page_create",
        arguments: { projectId: project.id, title: "延迟", blocks: [chart] },
      });
      expect(saved.isError).not.toBe(true);
      const page = (
        saved.structuredContent as {
          data: {
            document: {
              content: {
                content: { attrs: { kind: string; data: unknown } }[];
              };
            };
          };
        }
      ).data.document;
      expect(page.content.content[0].attrs).toMatchObject(chart);
      // Saved project components are read from the library, never written.
      const component = await run(
        [
          "catalog",
          "import",
          "--project",
          project.id,
          "--input",
          join(repository, "resources/catalog/value-slider"),
        ],
        { home: library },
      );
      const custom = {
        kind: "custom",
        data: {
          componentId: component.id,
          version: component.version,
          props: { label: "阈值", value: 0.4, min: 0, max: 1 },
        },
      };
      const anonymous = await codex.callTool({
        name: "show_component",
        arguments: custom,
      });
      expect(anonymous.isError).toBe(true);
      const projectComponent = await codex.callTool({
        name: "show_component",
        arguments: { ...custom, projectId: project.id, delivery: "mcp-app" },
      });
      expect(projectComponent.isError).not.toBe(true);
      expect(
        (projectComponent.structuredContent as Shown).data.components,
      ).toEqual([
        expect.objectContaining({
          kind: "custom",
          componentId: component.id,
          version: component.version,
          integrity: expect.stringMatching(/^sha256-/),
        }),
      ]);
      const after = await codex.callTool({
        name: "pages_list",
        arguments: { projectId: project.id },
      });
      expect(
        (after.structuredContent as { data: unknown[] }).data,
      ).toHaveLength(1);
    } finally {
      await codex.close();
    }
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}, 90_000);

// Content history and checkpoint restore were replaced by current-state
// storage; importing and activating an old library remains supported.
test("CLI prepares and activates an old library and the bound MCP reads it within project scope", async () => {
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
  expect(current.document.title).toBe(original.document.title);
  expect(await readFile(original.path)).toEqual(originalBytes);
  const client = new Client({ name: "import-api-client", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--home", target, "--project", project.id],
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
    const read = unpack(
      await client.callTool({
        name: "page_read",
        arguments: {
          projectId: project.id,
          pageId: original.document.id,
          response: "source",
          rendered: false,
        },
      }),
    );
    expect(read.ok).toBe(true);
    expect(JSON.stringify(read.data)).toContain("旧的可恢复内容");
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
          name: "page_read",
          arguments: { projectId: other.id, pageId: foreign.document.id },
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
  expect(info.support).toMatchObject({
    reportUrl: "https://github.com/Renaissance-Mind/ShowAI/issues/new",
    appPath: "设置 → 关于与反馈",
  });
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
  ).toBe(false);
  expect(
    catalog.items.some((item: { id: string }) => item.id === "paper-explainer"),
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

test(
  "directory projects are shared across sessions, canonical paths and concurrent first use",
  async () => {
    const library = await mkdtemp(join(home, "directory-library-"));
    const workspace = await mkdtemp(join(home, "directory-workspace-"));
    const other = await mkdtemp(join(home, "other-workspace-"));
    const nested = join(workspace, "src");
    await mkdir(nested);
    await execute("git", ["init", "--quiet", workspace]);
    const runHere = (args: string[], cwd = workspace) =>
      run(args, { home: library, cwd });
    const firstUse = await Promise.all([
      runHere([
        "projects",
        "current",
        "--harness",
        "codex",
        "--session",
        "one",
      ]),
      runHere([
        "projects",
        "current",
        "--harness",
        "codex",
        "--session",
        "two",
      ]),
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
    await symlink(
      workspace,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
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
    expect(
      await runHere(["pages", "list", "--project", manual.id]),
    ).toHaveLength(1);
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
      expect(payload.scope).toBe("library");
      expect(payload.componentCatalog.complete).toBe(true);
      expect(payload.root).toBe(library);
      const selected = await client.callTool({
        name: "project_context",
        arguments: { projectId: root.project.id },
      });
      expect(
        JSON.parse((selected.content as { text: string }[])[0].text).data
          .project.id,
      ).toBe(root.project.id);
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
  },
  process.platform === "win32" ? 60000 : 20000,
);

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
    "blank",
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
    "blank",
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
    "blank",
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
    "blank",
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
  // The value-slider fixture is at 1.2.0; both revisions must be newer.
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
  const ours = await makeRevision("1.3.0", 24);
  const theirs = await makeRevision("1.4.0", 28);
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
    JSON.stringify({ ...input, version: "1.5.0", resolved }),
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
  expect(merged).toMatchObject({ scope: "project", version: "1.5.0" });
  const code = await run([
    "catalog",
    "describe",
    merged.id,
    "--project",
    project.id,
    "--scope",
    "project",
    "--version",
    "1.5.0",
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
    "1.5.0",
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
      join(home, "revision-1.3.0.json"),
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
        name: "catalog_version",
        arguments: {
          action: "fork",
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
    [
      "guide",
      "development",
      "parameters",
      "schema",
      "examples",
      "dependencies",
      "source",
    ].sort(),
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

// Session identities were recorded in content history, which current-state
// storage removed; conditional revisions and request replay remain.
test("versioned CLI and MCP enforce conditional revisions and replay completed requests", async () => {
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
  // A retry before newer edits returns the original response.
  expect(await runHere(create)).toEqual(initial);
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
  // After newer edits a retry is refused instead of replaying stale content.
  await expect(runHere(create)).rejects.toThrow(
    "already completed before newer edits",
  );
  expect(await runHere(["pages", "list"])).toHaveLength(1);
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

// Current-state storage keeps search, storage maintenance and conflict
// listing; page history, comparison and restore were removed.
test("search, storage maintenance and conflicts are reachable from CLI and project-bound MCP", async () => {
  const root = await mkdtemp(join(home, "storage-api-"));
  const local = (args: string[]) => run(args, { home: root });
  await local(["library", "init"]);
  const project = await local(["projects", "create", "--name", "Storage API"]);
  const first = await local([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Searchable report",
  ]);
  const ops = join(home, "storage-body.json");
  await writeFile(
    ops,
    JSON.stringify([
      {
        type: "block.text.set",
        blockId: first.document.content.content[0].content[0].attrs.id,
        text: "论文图表检索证据",
      },
    ]),
  );
  await local([
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
  ).toBe(first.document.content.content[0].content[0].attrs.id);
  const stats = await local(["library", "stats"]);
  expect(stats.categories.repository.bytes).toBeGreaterThan(0);
  await local(["library", "compact"]);
  const cleanPlan = await local(["library", "cleanup-plan"]);
  await local(["library", "cleanup", cleanPlan.id]);
  expect(
    (await local(["pages", "read", first.document.id, "--project", project.id]))
      .document.content.content[0].content[0].content[0].text,
  ).toBe("论文图表检索证据");
  const client = new Client({ name: "storage-api-client", version: "1.0.0" });
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
          name: "library_search",
          arguments: { projectId: project.id, query: "图表" },
        }),
      ).data.items[0].blockId,
    ).toBe(first.document.content.content[0].content[0].attrs.id);
    expect(
      unpack(
        await client.callTool({
          name: "workspace_conflict",
          arguments: { action: "list", projectId: project.id },
        }),
      ).data,
    ).toEqual([]);
  } finally {
    await client.close();
  }
});

test("plugin launcher starts library MCP with explicit host delivery and refuses a mismatched library", async () => {
  const isolated = await mkdtemp(join(tmpdir(), "showai-plugin-mcp-"));
  const client = new Client({ name: "plugin-launch-acceptance", version: "1" });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    return (result.structuredContent as any).data;
  };
  try {
    await run(["runtime", "register"], { home: isolated });
    const output = join(isolated, "host-output");
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(repository, "plugins/showai/mcp/launch.mjs")],
        env: {
          ...environment(),
          SHOWAI_HOME: isolated,
          SHOWAI_PRESENTATION_DIR: output,
        } as Record<string, string>,
      }),
    );
    expect((await call("project_context")).root).toBe(isolated);
    expect(await call("projects_list")).toEqual([]);
    const project = await call("project_create", {
      name: "Launched through installed protocol",
    });
    const page = await call("page_create", {
      projectId: project.id,
      title: "Launch verified",
    });
    // Receipts name the project and link to the page in the App.
    const openUrl = `showai://project/${project.id}/page/${page.document.id}`;
    expect(page).toMatchObject({
      projectName: "Launched through installed protocol",
      openUrl,
    });
    const presentation = await call("page_present", {
      projectId: project.id,
      pageId: page.document.id,
    });
    expect(presentation).toMatchObject({
      projectName: "Launched through installed protocol",
      openUrl,
    });
    expect(presentation.delivery.inline.startsWith(output)).toBe(true);
    expect(await readFile(presentation.delivery.html, "utf8")).toContain(
      "Launch verified",
    );
    // The launcher passes the plugin version into the connection record and caches its probe.
    const { version: pluginVersion } = JSON.parse(
      await readFile(join(repository, "plugins/showai/plugin.json"), "utf8"),
    );
    const record = (await readAgentConnections(isolated)).find(
      (item) => item.client === "plugin-launch-acceptance",
    );
    expect(record).toMatchObject({
      pluginVersion,
      callPluginVersion: pluginVersion,
    });
    expect(
      JSON.parse(
        await readFile(join(isolated, "local/agent-runtime-probe.json"), "utf8"),
      ).info.ok,
    ).toBe(true);
    const capabilities = await call("showai_capabilities");
    expect(capabilities.support).toMatchObject({
      reportUrl: "https://github.com/Renaissance-Mind/ShowAI/issues/new",
      docsUrl: "https://showai.renaissancemind.ai/doc/agent-troubleshooting",
      appPath: "设置 → 关于与反馈",
    });
    // A mismatched library still answers the handshake, with only the diagnostic tool.
    const mismatch = new Client({ name: "codex-mcp-client", version: "1" });
    await mismatch.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(repository, "plugins/showai/mcp/launch.mjs")],
        env: {
          ...environment(),
          SHOWAI_HOME: join(isolated, "different"),
          SHOWAI_RUNTIME_CONFIG: join(isolated, "agent-runtime.json"),
        } as Record<string, string>,
        stderr: "pipe",
      }),
    );
    try {
      expect((await mismatch.listTools()).tools.map((tool) => tool.name)).toEqual(
        ["showai_connection_problem"],
      );
      const problem = await mismatch.callTool({
        name: "showai_connection_problem",
        arguments: {},
      });
      expect(problem.isError).toBe(true);
      expect((problem.structuredContent as any).error.code).toBe(
        "LIBRARY_MISMATCH",
      );
    } finally {
      await mismatch.close();
    }
  } finally {
    await client.close();
    await rm(isolated, { recursive: true, force: true });
  }
}, 60000);

test("Kimi installed package discovers tools, delivers offline previews and rejects another library", async () => {
  const isolated = await mkdtemp(join(tmpdir(), "showai-kimi-plugin-"));
  const plugin = join(isolated, "installed plugin");
  const client = new Client({ name: "kimi-plugin-acceptance", version: "1" });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    return (result.structuredContent as any).data;
  };
  try {
    await cp(join(repository, "plugins-kimi/showai"), plugin, {
      recursive: true,
    });
    const manifest = JSON.parse(
      await readFile(join(plugin, "kimi.plugin.json"), "utf8"),
    );
    const server = manifest.mcpServers.showai;
    expect(server.command).toBe("sh");
    expect(manifest.interface.mcpOverrides.showai.displayName).toBeTruthy();
    await run(["runtime", "register"], { home: isolated });
    const output = join(isolated, "host-output");
    await client.connect(
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        cwd: resolve(plugin, server.cwd ?? "."),
        env: {
          ...environment(),
          ...server.env,
          SHOWAI_HOME: isolated,
          SHOWAI_PRESENTATION_DIR: output,
        } as Record<string, string>,
      }),
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "showai_capabilities",
        "show_component",
        "project_context",
        "projects_list",
        "page_create",
        "page_read",
        "page_present",
        "template_context",
        "template_guide",
        "organization_update",
      ]),
    );
    const capabilities = await call("showai_capabilities");
    expect(capabilities.presentation.declaredHostDisplay).toBe("fragment-file");
    expect(capabilities.templateWorkflow.protocol).toBe(
      "showai-template-workflow-v2",
    );
    expect((await call("project_context")).root).toBe(isolated);
    const shown = await call("show_component", {
      kind: "text",
      data: { format: "markdown", content: "Kimi offline preview" },
    });
    expect(shown.delivery.mode).toBe("fragment-file");
    expect(shown.persistence.savedToProject).toBe(false);
    expect(shown.delivery.inline.startsWith(output)).toBe(true);
    const inline = await readFile(shown.delivery.inline, "utf8");
    const packed = inline.match(/data-showai-packed-data="gzip">([^<]+)</);
    expect(packed).not.toBeNull();
    const offline = JSON.parse(
      gunzipSync(Buffer.from(JSON.parse(packed![1]).data, "base64")).toString(),
    );
    expect(offline.artifact).toContain("Kimi offline preview");
    expect(offline.modules.length).toBeGreaterThan(0);
    expect(await call("projects_list")).toEqual([]);
    const project = await call("project_create", { name: "Kimi saved page" });
    const page = await call("page_create", {
      projectId: project.id,
      title: "Kimi launch verified",
      blocks: [
        {
          kind: "text",
          data: { format: "markdown", content: "Saved from Kimi protocol" },
        },
      ],
    });
    const presentation = await call("page_present", {
      projectId: project.id,
      pageId: page.document.id,
    });
    expect(presentation.delivery.inline.startsWith(output)).toBe(true);
    expect(await readFile(presentation.delivery.html, "utf8")).toContain(
      "Kimi launch verified",
    );
    await expect(
      execute(server.command, server.args, {
        cwd: resolve(plugin, server.cwd ?? "."),
        env: {
          ...environment(),
          SHOWAI_HOME: join(isolated, "other"),
          SHOWAI_RUNTIME_CONFIG: join(isolated, "agent-runtime.json"),
        },
        timeout: 10000,
      }),
    ).rejects.toThrow(/library mismatch/);
  } finally {
    await client.close();
    await rm(isolated, { recursive: true, force: true });
  }
}, 60000);
