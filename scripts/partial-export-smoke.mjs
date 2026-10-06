import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, "artifacts"), { recursive: true });
const output = await mkdtemp(join(root, "artifacts/partial-export-"));
const execute = promisify(execFile);
const cli = resolve(
  process.env.SHOWAI_PARTIAL_CLI ?? join(root, "dist-runtime/scripts/cli.mjs"),
);
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
};
async function run(...args) {
  const result = await execute(process.execPath, [cli, ...args, "--json"], {
    env,
  });
  return JSON.parse(result.stdout).data;
}
const project = await run(
  "projects",
  "create",
  "--name",
  "Partial display verification",
);
const component = await run(
  "catalog",
  "import",
  "--project",
  project.id,
  "--input",
  join(root, "resources/catalog/value-slider"),
);
const input = join(output, "input.json");
const progress = {
  type: "widget",
  attrs: {
    id: "progress",
    kind: "metrics",
    data: {
      title: "Processing progress",
      items: [{ label: "Completed", value: 62, unit: "%" }],
    },
  },
};
const notes = {
  type: "paragraph",
  attrs: { id: "notes" },
  content: [{ type: "text", text: "UNRELATED EXPLANATION" }],
};
await writeFile(
  input,
  JSON.stringify({
    id: "monitor",
    title: "Complete monitoring report",
    content: {
      type: "surface",
      content: [
        {
          type: "region",
          attrs: { id: "status", name: "Status" },
          content: [progress, notes],
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
              props: { label: "Progress slider", value: 37, min: 0, max: 100 },
            },
          },
        },
      ],
    },
  }),
);
const page = await run(
  "pages",
  "create",
  "--project",
  project.id,
  "--input",
  input,
);
const base = ["export", "--project", project.id, "--page", page.document.id];
await run(
  ...base,
  "--blocks",
  "progress",
  "--format",
  "html",
  "--out",
  join(output, "progress.html"),
);
await run(
  ...base,
  "--blocks",
  "status",
  "--format",
  "html",
  "--out",
  join(output, "region.html"),
);
await run(
  ...base,
  "--blocks",
  "control",
  "--format",
  "inline",
  "--out",
  join(output, "control-inline.html"),
);
await run(
  ...base,
  "--blocks",
  "progress",
  "--presentation",
  "spatial",
  "--format",
  "html",
  "--out",
  join(output, "spatial.html"),
);
await execute(
  process.execPath,
  [
    join(root, "scripts/render-artifact.mjs"),
    join(output, "progress.showai.json"),
    join(output, "rerendered.html"),
  ],
  { env },
);
await writeFile(
  input,
  JSON.stringify({
    id: "legacy",
    title: "Legacy full report",
    content: {
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { id: "details", title: "Details", open: false },
          content: [progress, notes],
        },
      ],
    },
  }),
);
const legacy = await run(
  "pages",
  "create",
  "--project",
  project.id,
  "--input",
  input,
);
await run(
  "export",
  "--project",
  project.id,
  "--page",
  legacy.document.id,
  "--blocks",
  "progress",
  "--format",
  "html",
  "--out",
  join(output, "legacy.html"),
);

const routes = new Map();
for (const name of ["progress", "region", "spatial", "rerendered", "legacy"])
  routes.set(`/${name}`, await readFile(join(output, `${name}.html`), "utf8"));
routes.set(
  "/inline",
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${await readFile(join(output, "control-inline.html"), "utf8")}</body></html>`,
);
const server = createServer((request, response) => {
  const html = routes.get(request.url);
  response.writeHead(html ? 200 : 404, {
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(html ?? "Not found");
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const reader = await browser.newPage({ viewport: { width: 880, height: 620 } });
const errors = [];
reader.on("pageerror", (error) => errors.push(error.message));
try {
  for (const name of ["progress", "rerendered", "legacy", "spatial"]) {
    await reader.goto(`${url}/${name}`);
    await reader.getByText("Completed", { exact: true }).waitFor();
    const text = await reader.locator("body").innerText();
    assert(!text.includes("UNRELATED EXPLANATION"));
    assert(!text.includes("Complete monitoring report"));
    assert(!text.includes("Legacy full report"));
    await reader.screenshot({
      path: join(output, `${name}.png`),
      fullPage: true,
    });
  }
  await reader.goto(`${url}/region`);
  await reader.getByText("UNRELATED EXPLANATION", { exact: true }).waitFor();
  await reader.goto(`${url}/inline`);
  const slider = reader.getByRole("slider", { name: "Progress slider" });
  await slider.waitFor();
  assert.equal(await slider.inputValue(), "37");
  await slider.fill("78");
  assert.equal(await slider.inputValue(), "78");
  assert.equal(await reader.locator("iframe").count(), 0);
  assert(
    !(await reader.locator("body").innerText()).includes(
      "Complete monitoring report",
    ),
  );
  await reader.screenshot({
    path: join(output, "inline-custom.png"),
    fullPage: true,
  });
  await reader.setViewportSize({ width: 390, height: 700 });
  await reader.goto(`${url}/progress`);
  await reader.getByText("Completed", { exact: true }).waitFor();
  const dimensions = await reader.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert(
    dimensions.width <= dimensions.viewport,
    "Partial reading layout overflows on mobile",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      output,
      checks: [
        "partial HTML",
        "selected region",
        "legacy hidden ancestor",
        "spatial selection",
        "artifact rerender",
        "inline custom interaction",
        "mobile layout",
      ],
    }),
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
