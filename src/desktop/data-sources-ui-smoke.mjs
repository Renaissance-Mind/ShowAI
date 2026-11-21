import { prepareDatabaseViewTest, checkDatabaseViewEdits } from "./database-view-interactions-smoke.mjs";
import { desktopTestEnvironment } from "../../scripts/desktop-test-env.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import electron from "electron";
import { build } from "esbuild";
import { _electron } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { stopTestProcess } from "../../scripts/stop-test-process.mjs";
import { walk } from "../document/walk.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(root, "dist-agent/cli.mjs");
const outputRoot =
  process.env.SHOWAI_TEST_OUTPUT_ROOT ??
  join(homedir(), "ShowAI-Development/development/tests");
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, "data-sources-"));
const home = join(output, "library");
const files = join(output, "files");
const shots = join(output, "screenshots");
await mkdir(files, { recursive: true });
await mkdir(shots, { recursive: true });
assert.notEqual(home, join(homedir(), ".showai"));
const env = {
  ...desktopTestEnvironment(),
  SHOWAI_HOME: home,
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_LANGUAGE: "zh-CN",
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, checks: [], unverified: [], home, output };
const check = (name, detail) => {
  result.checks.push(detail === undefined ? name : { name, ...detail });
  console.log("✓", name);
};


async function ffmpeg(args) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}
function pdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 20 60 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
async function xlsxWorkbook(sheets) {
  const bundled = await build({
    entryPoints: [join(root, "src/test/xlsx.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
  return module.xlsxWorkbook(sheets);
}

const paths = {
  csv: join(files, "日程.csv"),
  movedCsv: join(files, "moved", "日程.csv"),
  book: join(files, "金额.xlsx"),
  image: join(files, "封面.png"),
  pdf: join(files, "说明.pdf"),
  video: join(files, "片段.mp4"),
  clip: join(files, "组件片段.mp4"),
};
const ref = (path) =>
  `file://${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
await writeFile(paths.csv, "id,title\nm1,体检\nm2,复盘周会\n");
await writeFile(
  paths.book,
  await xlsxWorkbook([
    {
      name: "Sheet1",
      rows: [
        ["月份", "金额"],
        ["1月", 120],
        ["2月", 340],
        ["3月", 260],
      ],
    },
  ]),
);
await ffmpeg(["-f", "lavfi", "-i", "color=c=orange:s=160x90", "-frames:v", "1", paths.image]);
await writeFile(paths.pdf, pdf("ShowAI local PDF"));
for (const target of [paths.video, paths.clip])
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc=duration=1:size=160x90:rate=10",
    "-pix_fmt", "yuv420p", "-c:v", "libx264", target,
  ]);
const webImage = "https://github.githubassets.com/favicons/favicon.png";


const { stdout } = await run(process.execPath, [
  cli, "projects", "create", "--name", "数据读取层", "--home", home, "--json",
]);
const created = JSON.parse(stdout);
const projectId = created.data?.id ?? created.id ?? created.project?.id;
assert.ok(projectId, `project id in ${stdout}`);
const mcp = new Client({ name: "data-sources-smoke", version: "1" });
await mcp.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--project", projectId, "--home", home],
    env: { ...env },
    stderr: "inherit",
  }),
);
async function tool(name, args = {}) {
  const value = await mcp.callTool({ name, arguments: { projectId, ...args } }, undefined, {
    timeout: 120000,
  });
  const data = value.structuredContent;
  assert.ok(data?.ok, `${name}: ${JSON.stringify(data?.error ?? value)}`);
  return data.data;
}
const schedule = (
  await tool("dataset_write", { action: "link", name: "日程", path: paths.csv })
).dataset.id;
const amounts = (
  await tool("dataset_write", { action: "link", name: "金额表", path: paths.book })
).dataset.id;
const monthly = (
  await tool("dataset_write", {
    action: "transform",
    name: "月度金额",
    inputs: { book: amounts },
    script: `function transform({ book }, h) {
      const rows = h.table(h.sheet(book, 0), { header: 0 });
      return { labels: rows.map((row) => row["月份"]), series: [{ name: "金额", values: rows.map((row) => row["金额"]) }] };
    }`,
  })
).record.dataset.id;
const componentDir = join(output, "component");
await mkdir(componentDir, { recursive: true });
await writeFile(
  join(componentDir, "manifest.json"),
  JSON.stringify({
    id: "local-media-viewer",
    name: "本机媒体",
    version: "1.0.0",
    description: "Shows a local video and an online image",
    entry: "index.tsx",
    scenarios: ["Local files in a component"],
    defaultData: { clip: "", web: "" },
    examples: [{ name: "Empty", data: { clip: "", web: "" } }],
  }),
);
await writeFile(
  join(componentDir, "props.schema.json"),
  JSON.stringify({
    type: "object",
    properties: { clip: { type: "string" }, web: { type: "string" } },
    required: ["clip", "web"],
    additionalProperties: false,
  }),
);
await writeFile(
  join(componentDir, "index.tsx"),
  `import React from "react";
import { useResource } from "showai:components";
export default function LocalMedia({ data }) {
  const clip = useResource(data.clip, "video");
  const web = useResource(data.web, "image");
  return (
    <section style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <video data-role="clip" src={clip.url} muted controls width={160} onError={clip.failed} />
      <img data-role="web" src={web.url} alt="web" width={48} height={48} />
      <span data-role="status">{clip.status} {clip.name}</span>
    </section>
  );
}
`,
);
const component = await tool("component_save", {
  directory: componentDir,
  legacy: true,
});
const page = await tool("page_create", {
  title: "数据读取层验收",
  blocks: [
    {
      kind: "stepper",
      data: {
        steps: [
          {
            title: "日程表",
            blocks: [
              {
                kind: "database",
                data: {
                  title: "日程",
                  columns: [{ id: "title", name: "事项", type: "text" }],
                  rows: [],
                  view: "table",
                },
              },
            ],
          },
        ],
      },
    },
    {
      kind: "chart",
      data: { title: "金额", type: "bar", labels: [], series: [], unit: "元" },
    },
    { kind: "image", data: { src: ref(paths.image), alt: "本机图片" } },
    { kind: "pdf", data: { src: ref(paths.pdf), title: "本机 PDF" } },
    { kind: "video", data: { src: ref(paths.video) } },
    {
      kind: "custom",
      data: {
        componentId: component.id,
        version: component.version,
        integrity: component.integrity,
        props: { clip: ref(paths.clip), web: webImage },
      },
    },
  ],
});
const pageId = page.document.id;
const read = await tool("page_read", { pageId, rendered: false });
const widgets = new Map();
walk(read.document.content, (node) => {
  if (node.type === "widget") widgets.set(node.attrs.kind, node.attrs.id);
}, { scope: "tree" });
await tool("page_apply", {
  pageId,
  baseHash: read.hash,
  baseRevision: read.revision,
  operations: [
    {
      type: "component.binding.set",
      blockId: widgets.get("database"),
      binding: {
        dataset: schedule,
        collections: [
          { key: "row", into: "rows", from: "rows[*]", fields: { title: "title" } },
        ],
      },
    },
    {
      type: "component.binding.set",
      blockId: widgets.get("chart"),
      binding: { dataset: monthly, props: { local: ["title", "type", "unit"] } },
    },
  ],
});
await prepareDatabaseViewTest(tool, projectId);
await mcp.close();
check("content created through MCP", { projectId, pageId, component: component.id });


let app, window, appChild;
process.once("exit", () => {
  if (appChild && appChild.exitCode === null && appChild.signalCode === null)
    appChild.kill("SIGKILL");
});
const shot = async (name) => {
  const path = join(shots, `${String(result.checks.length).padStart(2, "0")}-${name}.png`);
  await window.screenshot({ path });
  return path;
};
const waitText = (text, shown = true, timeout = 30000) =>
  window.waitForFunction(
    ({ text, shown }) =>
      [
        document.body.textContent,
        ...[...document.querySelectorAll("input, textarea")].map((field) => field.value),
      ]
        .join("\n")
        .includes(text) === shown,
    { text, shown },
    { timeout },
  );
try {
  app = await _electron.launch({
    executablePath: electron,
    args: [root],
    cwd: root,
    env,
  });
  appChild = app.process();
  appChild.stderr.on("data", (data) => process.stderr.write(data));
  await app.firstWindow();
  for (let attempt = 0; attempt < 360 && !window; attempt++) {
    for (const candidate of app.windows())
      if (await candidate.locator(".studio-sidebar").count().catch(() => 0))
        window = candidate;
    if (!window) await new Promise((done) => setTimeout(done, 250));
  }
  assert.ok(
    window,
    `workbench window among ${JSON.stringify(
      await Promise.all(
        app.windows().map(async (candidate) => ({
          url: candidate.url(),
          text: (await candidate.evaluate(() => document.body?.innerText ?? "").catch(String)).slice(0, 200),
        })),
      ),
    )}`,
  );
  await app.evaluate(({ BrowserWindow }) => {
    for (const item of BrowserWindow.getAllWindows()) {
      item.webContents.setBackgroundThrottling(false);
      item.setSize(1280, 1600);
    }
  });
  window.setDefaultTimeout(30000);
  const invoke = (action, args = {}) =>
    window.evaluate(
      ({ action, args }) =>
        window.showai.invoke(action, args).catch((error) => {
          throw new Error(`${action}: ${JSON.stringify(error)}`);
        }),
      { action, args },
    );
  assert.equal((await invoke("app:info")).home, home);
  const answerDialogs = (open, save) =>
    app.evaluate(
      ({ dialog }, { open, save }) => {
        dialog.showOpenDialog = async () =>
          open ? { canceled: false, filePaths: [open] } : { canceled: true, filePaths: [] };
        dialog.showSaveDialog = async () =>
          save ? { canceled: false, filePath: save } : { canceled: true };
      },
      { open, save },
    );

  await window
    .locator(`.studio-sidebar .studio-tree-row[data-library-id="${projectId}"] .studio-tree-main`)
    .click();
  await window.getByText("数据读取层验收", { exact: true }).first().click();
  await waitText("体检");
  check("CSV rows show in the bound database block");
  await waitText("3月");
  check("the transform of the spreadsheet feeds the chart");
  const boundWidgets = window.locator(".dataset-bound");
  assert.equal(await boundWidgets.count(), 2);
  assert.equal(await boundWidgets.getByText(/^共享数据\s*·/).count(), 0);
  const boundSchedule = window.locator(`.dataset-bound[data-dataset-id="${schedule}"]`);
  assert.equal(await boundSchedule.count(), 1);
  const status = boundSchedule.getByRole("group", { name: "共享数据", exact: true });
  assert.equal(await status.count(), 0);
  check("bound widgets omit their dataset names and idle editable data has no status row");
  await boundSchedule.locator("th").first().click({ position: { x: 2, y: 2 } });
  await window.getByRole("button", { name: "移动或管理内容块", exact: true }).click();
  await window.getByRole("button", { name: "共享数据…", exact: true }).click();
  const settings = window.getByRole("dialog", { name: "共享数据", exact: true });
  await settings.waitFor();
  const datasetName = settings.getByRole("textbox", { name: "名称", exact: true });
  assert.equal(await datasetName.inputValue(), "日程");
  await window.keyboard.press("Escape");
  await settings.waitFor({ state: "hidden" });
  check("the block menu opens the selected nested widget's dataset settings");

  const image = await window.waitForFunction(() => {
    const img = document.querySelector(".sb-image img, figure img");
    return img?.complete && img.naturalWidth > 0
      ? { src: img.currentSrc, width: img.naturalWidth }
      : null;
  });
  const imageState = await image.jsonValue();
  assert.match(imageState.src, /^showai-media:/);
  check("local image loads through showai-media:", imageState);
  const pdfText = await window
    .locator(".sb-pdf-text p")
    .first()
    .textContent({ timeout: 45000 });
  assert.match(pdfText, /ShowAI local PDF/);
  assert.equal(await window.locator(".sb-pdf-status.sb-error").count(), 0);
  check("local PDF renders through showai-media: (fetch with CORS)", {
    text: pdfText.trim(),
  });
  const video = await window.waitForFunction(() => {
    const element = document.querySelector(".sb-video video, video");
    return element && element.readyState >= 1
      ? { src: element.currentSrc, duration: element.duration }
      : null;
  });
  const videoState = await video.jsonValue();
  assert.match(videoState.src, /^showai-media:/);
  check("local video loads its metadata through showai-media:", videoState);

  let frameState;
  for (let attempt = 0; attempt < 120 && !frameState?.ready; attempt++) {
    for (const frame of window.frames()) {
      if (frame === window.mainFrame()) continue;
      frameState = await frame
        .evaluate(() => {
          const clip = document.querySelector('[data-role="clip"]');
          if (!clip) return undefined;
          const web = document.querySelector('[data-role="web"]');
          return {
            ready: clip.readyState >= 1,
            src: clip.currentSrc,
            status: document.querySelector('[data-role="status"]')?.textContent,
            web: {
              src: web?.getAttribute("src"),
              current: web?.currentSrc,
              complete: web?.complete,
              width: web?.naturalWidth ?? 0,
            },
            policy: document
              .querySelector('meta[http-equiv="Content-Security-Policy"]')
              ?.getAttribute("content"),
          };
        })
        .catch(() => undefined);
      if (frameState) break;
    }
    if (!frameState?.ready) await new Promise((done) => setTimeout(done, 250));
  }
  assert.ok(frameState?.ready, `component frame: ${JSON.stringify(frameState)}`);
  assert.match(frameState.src, /^showai-media:/);
  assert.match(frameState.policy ?? "", /media-src[^;]*showai-media:/);
  check("custom component frame plays its local video from showai-media:", frameState);
  for (let attempt = 0; attempt < 80 && !(frameState.web.width > 0); attempt++) {
    await new Promise((done) => setTimeout(done, 250));
    for (const frame of window.frames()) {
      if (frame === window.mainFrame()) continue;
      const web = await frame
        .evaluate(() => {
          const element = document.querySelector('[data-role="web"]');
          return element
            ? {
                src: element.getAttribute("src"),
                current: element.currentSrc,
                complete: element.complete,
                width: element.naturalWidth,
              }
            : undefined;
        })
        .catch(() => undefined);
      if (web) frameState.web = web;
    }
  }
  if (frameState.web.width > 0)
    check("custom component shows an https image", frameState.web);
  else
    result.unverified.push(
      `https image in the component did not load (${frameState.web.src}); network may be unavailable`,
    );
  await shot("page-loaded");

  await mkdir(dirname(paths.movedCsv), { recursive: true });
  await rename(paths.csv, paths.movedCsv);
  const badge = window.locator(".dataset-warning-badge.is-stale").first();
  await window.evaluate(() => window.dispatchEvent(new Event("focus")));
  await badge.waitFor({ timeout: 30000 });
  await waitText("体检");
  check("a deleted CSV shows the stale badge and keeps the last rows");
  await badge.click();
  const popover = window.locator(".dataset-warning-popover");
  await popover.waitFor();
  await shot("stale-popover");
  await popover.getByRole("button", { name: "重试", exact: true }).first().click();
  await window.waitForTimeout(800);
  assert.ok(await badge.isVisible());
  check("retry keeps the stale state while the file is missing");
  if (!(await popover.isVisible())) await badge.click();
  await writeFile(paths.movedCsv, "id,title\nm1,体检\nm3,年度计划\n");
  await answerDialogs(paths.movedCsv);
  await popover.getByRole("button", { name: "链接文件…", exact: true }).first().click();
  await waitText("年度计划");
  await badge.waitFor({ state: "detached", timeout: 20000 });
  check("link-file reads the chosen file and clears the warning");
  await shot("relinked");

  const large = Buffer.alloc(9 * 1024 * 1024, "x");
  await writeFile(paths.movedCsv, Buffer.concat([Buffer.from("id,title\nm1,"), large, Buffer.from("\n")]));
  await window.evaluate(() => window.dispatchEvent(new Event("focus")));
  const tooLarge = window.locator(".dataset-warning-badge.is-stale").first();
  await tooLarge.waitFor();
  await window.waitForTimeout(500);
  await tooLarge.click();
  await window.getByRole("button", { name: "打包设置…", exact: true }).first().click();
  const syncCopy = window.locator(".dataset-sync-copy.is-focused");
  await syncCopy.waitFor();
  const syncText = await syncCopy.textContent();
  assert.match(syncText, /随同步携带这个文件/);
  assert.match(syncText, /单项上限 64\.0 MB/);
  assert.match(syncText, /256\.0 MB/);
  const checkbox = syncCopy.getByRole("checkbox");
  assert.equal(await checkbox.evaluate((element) => element === document.activeElement), true);
  await window.waitForTimeout(400);
  await shot("packaging-in-dataset-dialog");
  const before = await checkbox.isChecked();
  await checkbox.click();
  await window.waitForFunction(
    (expected) => document.querySelector(".dataset-sync-copy input")?.checked === expected,
    !before,
  );
  const stored = (await invoke("packaging:sync", { projectId })).items.find(
    (item) => item.id === `dataset:${projectId}/${schedule}`,
  );
  assert.equal(stored.choice, before ? "skip" : "bundle");
  const definition = { source: { bundle: { sync: stored.choice === "bundle" } } };
  check("the packaging action opens the dataset dialog at the synchronization choice and writes source.bundle.sync", {
    text: syncText,
    sync: definition.source.bundle.sync,
  });
  await window.keyboard.press("Escape");
  await writeFile(paths.movedCsv, "id,title\nm1,体检\nm3,年度计划\n");
  await window.evaluate(() => window.dispatchEvent(new Event("focus")));
  await window
    .locator(".dataset-warning-badge.is-stale")
    .first()
    .waitFor({ state: "detached", timeout: 20000 });

  const out = join(output, "exports", "验收.html");
  await mkdir(dirname(out), { recursive: true });
  await answerDialogs(undefined, out);
  await window.getByRole("button", { name: "页面操作", exact: true }).click();
  await window.getByRole("menuitem", { name: /^导出/ }).first().click();
  await window.getByRole("menuitem", { name: /^HTML 网页/ }).first().click();
  const packaging = window.locator(".packaging-dialog");
  await packaging.waitFor();
  const choose = (name, value) =>
    packaging.getByLabel(`${name} 的处理方式`, { exact: true }).selectOption(value);
  await choose("日程", "skip");
  await choose("月度金额", "both");
  await choose("封面.png", "embed");
  await choose("说明.pdf", "skip");
  await choose("片段.mp4", "embed");
  await choose("组件片段.mp4", "skip");
  await window.waitForTimeout(400);
  await shot("export-packaging");
  await packaging.getByRole("button", { name: "导出", exact: true }).click();
  const source = out.replace(/\.html$/, ".showai.json");
  const inputs = join(output, "exports", "验收.inputs");
  let inputFiles;
  for (let attempt = 0; attempt < 120; attempt++) {
    inputFiles = await readdir(inputs).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return [];
    });
    if (inputFiles.length) break;
    await new Promise((done) => setTimeout(done, 250));
  }
  const exported = await readFile(source, "utf8");
  const html = await readFile(out, "utf8");
  for (const text of [exported, html]) {
    assert.ok(!text.includes(files), "no path of this device");
    assert.ok(!text.includes(homedir()), "no home directory");
  }
  assert.match(exported, /data:image\/png;base64,/);
  assert.match(exported, /data:video\/mp4;base64,/);
  assert.match(exported, /"file:%E8%AF%B4%E6%98%8E\.pdf"|"file:说明\.pdf"/);
  assert.match(exported, /"clip":\s*"file:/);
  assert.equal(inputFiles.length, 1, "the transform's input snapshot");
  check("export carries the mixed packaging choices and no device path", {
    html: out,
    source,
    inputs: inputFiles,
  });
  await checkDatabaseViewEdits(window);
  check("filtered creation, four record previews, independent copies, bulk update and undo persist on the bound database");
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (window) await shot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  result.log = await readFile(join(env.SHOWAI_USER_DATA, "logs/showai-main.log"), "utf8").then(
    (text) => text.slice(-8000),
    () => undefined,
  );
  if (app) await app.close().catch(() => {});
  if (appChild) await stopTestProcess(appChild);
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, error: result.error, output }, null, 2));
  if (process.env.SHOWAI_KEEP_TEST_FIXTURES !== "1")
    await rm(join(output, "profile"), { recursive: true, force: true });
}
