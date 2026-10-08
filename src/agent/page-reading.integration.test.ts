import { beforeAll, afterAll, expect, test } from "vitest";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rawSourcePlugin } from "../../scripts/raw-source-plugin.mjs";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
let home: string,
  cli: string,
  bundle: string,
  projectId: string,
  pageId: string,
  hash: string,
  pagePath: string;
const environment = () => ({
  ...process.env,
  SHOWAI_HOME: home,
  SHOWAI_VIEWER: join(root, "dist-portable/portable.html"),
});
async function run(args: string[]) {
  const output = await execute(process.execPath, [cli, ...args, "--json"], {
    env: environment(),
    maxBuffer: 12 * 1024 * 1024,
  }).catch((error) => {
    throw new Error(error.stdout || error.stderr || error.message, {
      cause: error,
    });
  });
  const result = JSON.parse(output.stdout);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data;
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-reading-test-"));
  await mkdir(join(root, "node_modules/.cache"), { recursive: true });
  bundle = await mkdtemp(join(root, "node_modules/.cache/showai-reading-"));
  cli = join(bundle, "cli.mjs");
  await build({
    entryPoints: [join(root, "src/agent/cli.ts")],
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
    join(root, "dist-agent/index-worker.mjs"),
    join(dirname(cli), "index-worker.mjs"),
  );
  const project = await run([
    "projects",
    "create",
    "--name",
    "Reading contracts",
  ]);
  projectId = project.id;
  const component = await run([
    "catalog",
    "import",
    "--project",
    projectId,
    "--input",
    join(root, "resources/catalog/task-gantt"),
  ]);
  const data = JSON.parse(
    await readFile(join(root, "examples/task-gantt/data.json"), "utf8"),
  );
  const input = join(home, "page.json");
  await writeFile(
    input,
    JSON.stringify({
      id: "reading",
      title: "三种视图",
      comments: [],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "notes" },
            content: [{ type: "text", text: "原始值与派生值" }],
          },
          {
            type: "widget",
            attrs: {
              id: "gantt",
              kind: "custom",
              data: {
                componentId: component.id,
                version: component.version,
                integrity: component.integrity,
                props: data,
              },
            },
          },
        ],
      },
    }),
  );
  const page = await run([
    "pages",
    "create",
    "--project",
    projectId,
    "--input",
    input,
  ]);
  pageId = page.document.id;
  hash = page.hash;
  pagePath = page.path;
}, 30000);
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(bundle, { recursive: true, force: true });
});

test("structured reading retains source props and evaluates the matching component's derived model", async () => {
  const read = await run(["pages", "read", pageId, "--project", projectId]);
  expect(read.view).toBe("structured");
  expect(read.hash).toBe(hash);
  expect(
    read.computed[0].props.tasks.find(
      (task: { id: string }) => task.id === "planning",
    ).progress,
  ).toBe(0);
  expect(
    read.computed[0].data.tasks.find(
      (task: { id: string }) => task.id === "planning",
    ),
  ).toMatchObject({
    progress: 70,
    end: "2026-10-12",
    derived: ["start", "end", "progress"],
  });
  const markdown = await run([
    "pages",
    "read",
    pageId,
    "--project",
    projectId,
    "--format",
    "markdown",
  ]);
  expect(markdown.markdown).toContain("原始值与派生值");
  expect(markdown).not.toHaveProperty("document");
}, 30000);

test("outline and explicit source reading work without a renderer and keep source identity", async () => {
  const outline = await run([
    "pages",
    "read",
    pageId,
    "--project",
    projectId,
    "--detail",
    "outline",
  ]);
  expect(
    outline.outline.some((node: { id: string }) => node.id === "gantt"),
  ).toBe(true);
  expect(outline.hash).toBe(hash);
  const result = await execute(
    process.execPath,
    [
      cli,
      "pages",
      "read",
      pageId,
      "--project",
      projectId,
      "--rendered",
      "false",
      "--json",
    ],
    {
      env: {
        ...environment(),
        SHOWAI_BROWSER_EXECUTABLE: join(home, "missing-browser"),
      },
    },
  );
  expect(JSON.parse(result.stdout).data.computed).toEqual([]);
});

test("image, HTML and partial reads keep one hash and generate actual browser output", async () => {
  const image = await run([
    "pages",
    "read",
    pageId,
    "--project",
    projectId,
    "--view",
    "image",
    "--blocks",
    "gantt",
    "--theme",
    "dark",
    "--width",
    "736",
    "--height",
    "700",
    "--base-hash",
    hash,
  ]);
  const png = await readFile(image.path);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(image.image.width).toBe(736);
  expect(image.partial).toBe(true);
  expect(image.blockIds).toEqual(["gantt"]);
  expect(image.hash).toBe(hash);
  expect(
    JSON.parse(await readFile(image.metadataPath, "utf8")).state.theme,
  ).toBe("dark");
  const html = await run([
    "pages",
    "read",
    pageId,
    "--project",
    projectId,
    "--view",
    "html",
  ]);
  expect(await readFile(html.path, "utf8")).toContain("showai-read-options");
  expect(html.hash).toBe(hash);
  expect(html.componentRefs).toEqual(image.componentRefs);
  expect(
    html.dom.some((frame: { blockId?: string }) => frame.blockId === "gantt"),
  ).toBe(true);
}, 30000);

test("HTML actions edit a temporary draft while preserving the full Page bytes", async () => {
  const before = await readFile(pagePath, "utf8");
  const state = join(home, "state.json");
  await writeFile(
    state,
    JSON.stringify({
      draft: true,
      actions: [
        {
          type: "click",
          blockId: "gantt",
          role: "button",
          name: "查看任务 交互与视觉设计，第 3 层，进行中",
        },
        { type: "click", blockId: "gantt", role: "button", name: "编辑任务" },
        {
          type: "fill",
          blockId: "gantt",
          role: "textbox",
          name: "任务名称",
          value: "临时修改",
        },
        { type: "click", blockId: "gantt", role: "button", name: "保存任务" },
      ],
    }),
  );
  const preview = await run([
    "pages",
    "read",
    pageId,
    "--project",
    projectId,
    "--view",
    "html",
    "--state",
    state,
  ]);
  expect(
    preview.computed[0].props.tasks.find(
      (task: { id: string }) => task.id === "design",
    ).title,
  ).toBe("临时修改");
  expect(
    preview.dom.some((frame: { accessibility: string }) =>
      frame.accessibility.includes("临时修改"),
    ),
  ).toBe(true);
  expect(await readFile(pagePath, "utf8")).toBe(before);
}, 30000);

test("missing action targets and stale hashes fail instead of claiming a successful capture", async () => {
  const stale = await execute(
    process.execPath,
    [
      cli,
      "pages",
      "read",
      pageId,
      "--project",
      projectId,
      "--view",
      "image",
      "--base-hash",
      "0".repeat(64),
      "--json",
    ],
    { env: environment() },
  ).catch((error) => ({ stdout: error.stdout }));
  expect(JSON.parse(stale.stdout).error.code).toBe("CONFLICT");
  const state = join(home, "bad-state.json");
  await writeFile(
    state,
    JSON.stringify({
      actions: [
        {
          type: "click",
          blockId: "gantt",
          role: "button",
          name: "不存在的控件",
        },
      ],
    }),
  );
  const invalid = await execute(
    process.execPath,
    [
      cli,
      "pages",
      "read",
      pageId,
      "--project",
      projectId,
      "--view",
      "html",
      "--state",
      state,
      "--json",
    ],
    { env: environment() },
  ).catch((error) => ({ stdout: error.stdout }));
  expect(JSON.parse(invalid.stdout).error.message).toContain(
    "missing or ambiguous",
  );
}, 30000);

test("MCP exposes the reading modes and returns native PNG content for image reads", async () => {
  const client = new Client({ name: "reading-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "--home", home, "--project", projectId, "mcp"],
    env: Object.fromEntries(
      Object.entries(environment()).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const schema = tools.tools.find(
      (tool) => tool.name === "page_read",
    )!.inputSchema;
    expect(schema.properties).toHaveProperty("view");
    const result = await client.callTool({
      name: "page_read",
      arguments: {
        pageId,
        view: "image",
        blockIds: ["gantt"],
        viewport: { width: 736, height: 700 },
      },
    });
    expect(result.isError).not.toBe(true);
    const images = (
      result.content as { type: string; mimeType?: string; data?: string }[]
    ).filter((content) => content.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0].mimeType).toBe("image/png");
    expect(
      Buffer.from(images[0].data!, "base64").subarray(1, 4).toString(),
    ).toBe("PNG");
  } finally {
    await client.close();
  }
}, 30000);
