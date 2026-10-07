// Actual Electron, real CLI/Git files, editing, undo and chart resizing.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { _electron } from "playwright";
const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, "output/performance"), { recursive: true });
const output = await mkdtemp(join(root, "output/performance/ui-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "library"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const run = async (...args) =>
  JSON.parse(
    (
      await promisify(execFile)(
        process.execPath,
        [join(root, "dist-runtime/scripts/cli.mjs"), ...args, "--json"],
        { env },
      )
    ).stdout,
  ).data;
const project = await run(
  "projects",
  "create",
  "--name",
  "Performance interaction",
);
const seed = await run(
  "pages",
  "create",
  "--project",
  project.id,
  "--title",
  "Large editor",
);
const document = structuredClone(seed.document);
document.content.content = Array.from({ length: 1500 }, (_, index) => ({
  type: "paragraph",
  attrs: { id: `evidence-${index}` },
  content: [
    {
      type: "text",
      text: `Evidence ${index}: actual editable content and saved history.`,
    },
  ],
}));
document.surfaceViews[document.content.attrs.id].readingOrder =
  document.content.content.map((node) => node.attrs.id);
const input = join(output, "large.json");
await writeFile(input, JSON.stringify(document));
const large = await run(
  "pages",
  "create",
  "--project",
  project.id,
  "--input",
  input,
);
const chartSeed = await run(
  "pages",
  "create",
  "--project",
  project.id,
  "--title",
  "Chart resize",
);
const charts = JSON.parse(
  await readFile(join(root, "resources/catalog/g2.json"), "utf8"),
);
const chart = charts.find((item) => item.kind === "g2-line") ?? charts[0];
const chartDocument = structuredClone(chartSeed.document);
chartDocument.content.content = [
  {
    type: "widget",
    attrs: { id: "chart", kind: chart.kind, data: chart.defaultData },
  },
];
chartDocument.surfaceViews[chartDocument.content.attrs.id].readingOrder = [
  "chart",
];
const chartInput = join(output, "chart.json");
await writeFile(chartInput, JSON.stringify(chartDocument));
const chartPage = await run(
  "pages",
  "create",
  "--project",
  project.id,
  "--input",
  chartInput,
);
const app = await _electron.launch({
  args: [join(root, "dist-desktop/main.mjs")],
  env,
});
const checks = [],
  measurements = {};
let failed = false;
try {
  const page = await app.firstWindow();
  await page
    .locator('[data-navigation-state="current"]')
    .waitFor({ timeout: 30000 });
  const url = (id) => {
    const url = pathToFileURL(join(root, "dist-desktop/index.html"));
    url.search = new URLSearchParams({
      project: project.id,
      page: id,
      focus: "1",
    }).toString();
    return url.href;
  };
  const opened = performance.now();
  await page.goto(url(large.document.id));
  const editor = page
    .getByRole("textbox", { name: "文档内容", exact: true })
    .first();
  await editor.waitFor({ timeout: 30000 });
  measurements.largePageReadyMs = Math.round(performance.now() - opened);
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.__longTasks.push(entry.duration);
    }).observe({ entryTypes: ["longtask"] });
  });
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  const edited = performance.now();
  await editor.pressSequentially("Performance edit retained", { delay: 20 });
  measurements.typingMs = Math.round(performance.now() - edited);
  const saving = performance.now();
  await page.locator(".studio-save-state.saved").waitFor({ timeout: 30000 });
  measurements.afterTypingSaveMs = Math.round(performance.now() - saving);
  measurements.typeAndSaveMs = Math.round(performance.now() - edited);
  const saved = await page.evaluate(
    ({ projectId, pageId }) =>
      window.showai.invoke("pages:get", { projectId, pageId }),
    { projectId: project.id, pageId: large.document.id },
  );
  assert.ok(
    JSON.stringify(saved.document.content).includes(
      "Performance edit retained",
    ),
  );
  await editor.press("ControlOrMeta+z");
  await page.locator(".studio-save-state.saved").waitFor({ timeout: 30000 });
  const undone = await page.evaluate(
    ({ projectId, pageId }) =>
      window.showai.invoke("pages:get", { projectId, pageId }),
    { projectId: project.id, pageId: large.document.id },
  );
  assert.ok(
    !JSON.stringify(undone.document.content).includes(
      "Performance edit retained",
    ),
  );
  measurements.longTasksMs = await page.evaluate(() => window.__longTasks);
  checks.push(
    "1500-paragraph editing saves actual content and preserves undo after saving",
  );
  const openedWindow = app.waitForEvent("window");
  await page.evaluate(
    ({ projectId, pageId }) =>
      window.showai.invoke("app:openPageWindow", { projectId, pageId }),
    { projectId: project.id, pageId: large.document.id },
  );
  const otherWindow = await openedWindow;
  const otherEditor = otherWindow
    .getByRole("textbox", { name: "文档内容", exact: true })
    .first();
  await otherEditor.waitFor({ timeout: 30000 });
  const prior = await otherWindow.evaluate(
    ({ projectId, pageId }) =>
      window.showai.invoke("pages:get", { projectId, pageId }),
    { projectId: project.id, pageId: large.document.id },
  );
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.pressSequentially("Native windows synchronize", { delay: 10 });
  await page.locator(".studio-save-state.saved").waitFor({ timeout: 30000 });
  await otherWindow.waitForFunction(
    () =>
      document
        .querySelector('[role="textbox"][aria-label="文档内容"]')
        ?.textContent?.includes("Native windows synchronize"),
    undefined,
    { timeout: 30000 },
  );
  const conflict = await otherWindow.evaluate(
    async ({ projectId, prior }) => {
      try {
        await window.showai.invoke("pages:save", {
          projectId,
          pageId: prior.document.id,
          document: prior.document,
          baseHash: prior.hash,
          baseRevision: prior.revision,
        });
        return "unexpected overwrite";
      } catch (error) {
        return error.code;
      }
    },
    { projectId: project.id, prior },
  );
  assert.equal(conflict, "CONFLICT");
  await otherWindow.close();
  checks.push("two native windows reconcile changes and reject stale writes");
  await page.goto(url(chartPage.document.id));
  await page
    .locator('.sb-g2-plot[aria-busy="false"] svg')
    .waitFor({ timeout: 30000 });
  const initialWidth = await page.locator(".sb-g2-plot").evaluate((node) => {
    window.__chartSvg = node.querySelector("svg");
    return node.clientWidth;
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.isVisible())
      .setSize(980, 820),
  );
  await page.waitForFunction(
    (width) => document.querySelector(".sb-g2-plot")?.clientWidth !== width,
    initialWidth,
  );
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(
      () => window.__chartSvg === document.querySelector(".sb-g2-plot svg"),
    ),
    true,
  );
  checks.push("G2 native-window resizing preserves the existing chart SVG");
  await page.screenshot({ path: join(output, "chart-resized.png") });
  console.log(JSON.stringify({ output, checks, measurements }, null, 2));
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ checks, measurements }, null, 2),
  );
} catch (error) {
  failed = true;
  for (const [index, window] of app.windows().entries()) {
    await window.screenshot({ path: join(output, `failure-${index}.png`) });
    console.error(
      "Fixture window",
      index,
      (await window.locator("body").innerText()).slice(-2000),
    );
  }
  console.error(error);
  throw error;
} finally {
  if (failed)
    await app
      .evaluate(({ app }) => app.exit(1))
      .catch((error) => console.error("Failed fixture cleanup", error));
  else await app.close();
}
