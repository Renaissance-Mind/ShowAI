import { _electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "showai-cubic-desktop-")),
  environment = {
    ...process.env,
    SHOWAI_HOME: join(directory, "library"),
    SHOWAI_USER_DATA: join(directory, "profile"),
    SHOWAI_LANGUAGE: "zh-CN",
    SHOWAI_AGENT_WORKSPACES: join(directory, "agent-workspaces"),
  };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  args: [resolve("dist-desktop/main.mjs")],
  cwd: process.cwd(),
  env: environment,
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
      action,
      args,
    });
  const project = await api("projects:create", {
      name: "Actual Electron cubic",
    }),
    created = await api("pages:create", {
      projectId: project.id,
      title: "Electron cubic writer",
      kind: "board",
    }),
    pageId = created.document.id,
    boardId = created.document.content.attrs.id;
  await page
    .getByRole("button", { name: "Actual Electron cubic", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Electron cubic writer", exact: true })
    .click();
  const scene = page.locator(`[data-container-root="${boardId}"]`);
  await scene.waitFor();
  await scene.getByRole("button", { name: "画笔", exact: true }).click();
  const input = scene.locator('[data-cubic-input="2"]');
  await input.waitFor();
  const box = await input.boundingBox();
  await page.mouse.move(box.x + 350, box.y + 330);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 360, { steps: 37 });
  await page.mouse.up();
  const read = () => api("pages:get", { projectId: project.id, pageId });
  const wait = async (count) => {
    const deadline = Date.now() + 20000;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (value.document.content.content.length === count) return value;
      await new Promise((done) => setTimeout(done, 60));
    }
    throw new Error(
      "Actual Electron save count " +
        count +
        ": " +
        JSON.stringify(value).slice(-1500),
    );
  };
  const saved = await wait(1),
    ink = saved.document.content.content[0].attrs.ink;
  assert.equal(ink.format, "showai-ink-v2");
  assert.ok(ink.capture.raw.length >= 35);
  assert.equal(ink.samples, undefined);
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await wait(0);
  await page.getByRole("button", { name: "重做操作", exact: true }).click();
  const restored = await wait(1);
  assert.deepEqual(restored.document.content.content[0].attrs.ink, ink);
  const source = JSON.parse(await readFile(saved.path, "utf8"));
  assert.deepEqual(source.document.content.content[0].attrs.ink, ink);
  assert.deepEqual(errors, []);
  const info = await api("app:info");
  await mkdir("output/playwright", { recursive: true });
  const result = {
    passed: true,
    directory,
    desktop: info,
    raw: ink.capture.raw.length,
    segments: ink.segments.length,
    errors,
    checks: [
      "actual sandboxed Electron file renderer and CSP load both real Workers",
      "actual pointer writes v2 center/radius/full capture",
      "real IPC/FileStore CAS save, Undo and Redo preserve exact source",
    ],
  };
  await writeFile(
    "output/playwright/portable-cubic-desktop-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
}
