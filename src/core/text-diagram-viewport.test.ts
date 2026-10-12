import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { chromium, type Frame } from "playwright-core";
import { ContentLibrary } from "./content-library";
import { FileStore } from "./store";
import { importComponent } from "./catalog";
import { buildPageHtml } from "../agent/exporter";
import {
  diagramSize,
  fitScale,
  zoomScroll,
} from "../../resources/catalog/text-diagram/viewport";
import { renderDiagram } from "../../resources/catalog/text-diagram/engine.js";

it("fits large diagrams without enlarging small ones and preserves a zoom anchor", () => {
  expect(fitScale(432, 2000)).toBe(0.2);
  expect(fitScale(1000, 200)).toBe(1);
  expect(zoomScroll(300, 200, 432, 2000, 0.5, 1)).toBe(784);
  // A centered small diagram crosses into horizontal overflow during zoom.
  expect(zoomScroll(0, 216, 432, 200, 1, 4)).toBe(200);
  expect(
    diagramSize(renderDiagram({ type: "flow", source: "A -> B" }, "sizes").html)
      .width,
  ).toBeGreaterThan(0);
});

async function geometry(frame: Frame) {
  return frame.locator(".sd-viewport").evaluate((element) => {
    const viewport = element as HTMLElement;
    const svg = viewport.querySelector("svg")!;
    return {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      scrollWidth: viewport.scrollWidth,
      scrollHeight: viewport.scrollHeight,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      scale: svg.getBoundingClientRect().width / svg.viewBox.baseVal.width,
      natural: svg.viewBox.baseVal.width,
      rootWidth: document.documentElement.scrollWidth,
    };
  });
}

it("runs the compiled viewport in a real saved Page and retains view state across host updates", async () => {
  const directory = resolve(
    process.env.SHOWAI_DIAGRAM_TEST_ROOT ??
      join(tmpdir(), "showai-text-diagram-tests"),
  );
  await mkdir(directory, { recursive: true });
  const home = await mkdtemp(join(directory, "viewport-"));
  const browser = await chromium.launch({
    executablePath: process.env.SHOWAI_BROWSER_EXECUTABLE,
  });
  const server = createServer();
  try {
    await new ContentLibrary(home).initialize();
    const store = new FileStore(home);
    const project = await store.createProject({ name: "Diagram viewport" });
    const component = await importComponent(
      home,
      resolve("resources/catalog/text-diagram"),
      project.id,
    );
    const participants = Array.from({ length: 12 }, (_, i) => `参与者${i}`);
    const props = {
      title: "大型时序图",
      type: "sequence",
      source:
        `participants: ${participants.join(", ")}\n` +
        Array.from(
          { length: 45 },
          (_, i) =>
            `${participants[i % 12]} -> ${participants[(i + 5) % 12]}: 消息${i}`,
        ).join("\n"),
    };
    let page = await store.createPage(project.id, {
      title: "Diagram viewport",
    });
    page = await store.applyPage(project.id, page.document.id, {
      baseHash: page.hash,
      baseRevision: page.revision,
      operations: [
        {
          type: "block.insert",
          parentId: page.document.content.attrs!.id,
          node: {
            type: "widget",
            attrs: {
              id: "diagram",
              kind: "custom",
              data: {
                componentId: component.id,
                version: component.version,
                integrity: component.integrity,
                props,
              },
            },
          },
        },
      ],
    });
    const html = await buildPageHtml(page.document, undefined, [component]);
    server.on("request", (_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server missing");
    await writeFile(
      join(directory, "viewport-fixture.json"),
      JSON.stringify({ home, projectId: project.id, pageId: page.document.id }),
    );
    const tab = await browser.newPage({
      viewport: { width: 800, height: 900 },
    });
    await tab.goto(`http://127.0.0.1:${address.port}`);
    await tab.locator("iframe").waitFor();
    const frame = tab
      .frames()
      .find((candidate) => candidate !== tab.mainFrame())!;
    await frame.locator("svg").waitFor();
    await expect
      .poll(
        async () =>
          (await geometry(frame)).scrollWidth - (await geometry(frame)).width,
      )
      .toBeLessThanOrEqual(1);
    const initial = await geometry(frame);
    expect(initial.scale).toBeLessThan(1);
    const contentBefore = await store.readPage(project.id, page.document.id);
    await frame.getByRole("button", { name: "放大", exact: true }).click();
    await frame.getByRole("button", { name: "放大", exact: true }).click();
    await expect
      .poll(async () => (await geometry(frame)).scale)
      .toBeGreaterThan(initial.scale * 1.5);
    const enlarged = await geometry(frame);
    expect(enlarged.height).toBe(initial.height);
    expect(enlarged.left).toBeGreaterThan(0);
    expect(enlarged.top).toBeGreaterThan(0);
    expect(enlarged.rootWidth).toBe(initial.rootWidth);
    const viewport = frame.locator(".sd-viewport");
    await viewport.focus();
    await viewport.press("ArrowRight");
    expect((await geometry(frame)).left).toBeGreaterThan(enlarged.left);
    const beforeDrag = await geometry(frame);
    const box = (await viewport.boundingBox())!;
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.mouse.down();
    await tab.mouse.move(
      box.x + box.width / 2 - 80,
      box.y + box.height / 2 - 60,
      { steps: 5 },
    );
    await tab.mouse.up();
    expect((await geometry(frame)).left).toBeGreaterThan(beforeDrag.left + 70);
    expect((await geometry(frame)).top).toBeGreaterThan(beforeDrag.top + 50);
    const beforeWheel = await geometry(frame);
    const anchor = { x: beforeWheel.width * 0.7, y: beforeWheel.height * 0.6 };
    const diagramPoint = {
      x: (beforeWheel.left + anchor.x - 16) / beforeWheel.scale,
      y: (beforeWheel.top + anchor.y - 16) / beforeWheel.scale,
    };
    await tab.mouse.move(box.x + anchor.x, box.y + anchor.y);
    await tab.keyboard.down("Control");
    await tab.mouse.wheel(0, -100);
    await tab.keyboard.up("Control");
    await expect
      .poll(async () => (await geometry(frame)).scale)
      .toBeGreaterThan(beforeWheel.scale);
    const afterWheel = await geometry(frame);
    expect(
      Math.abs(
        (afterWheel.left + anchor.x - 16) / afterWheel.scale - diagramPoint.x,
      ),
    ).toBeLessThan(2);
    expect(
      Math.abs(
        (afterWheel.top + anchor.y - 16) / afterWheel.scale - diagramPoint.y,
      ),
    ).toBeLessThan(2);
    // A real host message clones props, even when the content is unchanged.
    await tab.locator("iframe").evaluate((element, props) => {
      const iframe = element as HTMLIFrameElement;
      // The channel is supplied by the actual generated host source.
      const config = iframe.srcdoc.match(
        /<script id="showai-component-data" type="application\/json">([^<]+)<\/script>/,
      );
      if (!config) throw new Error("Component bootstrap missing");
      iframe.contentWindow!.postMessage(
        {
          ...JSON.parse(config[1]),
          type: "showai:props",
          props,
          readOnly: true,
        },
        "*",
      );
    }, props);
    await frame.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect
      .poll(async () => (await geometry(frame)).scale)
      .toBeCloseTo(afterWheel.scale, 2);
    const atZoom = await geometry(frame);
    await tab.setViewportSize({ width: 480, height: 900 });
    await expect
      .poll(async () => (await geometry(frame)).width)
      .toBeLessThan(initial.width);
    expect((await geometry(frame)).scale).toBeCloseTo(atZoom.scale, 2);
    await frame.getByRole("button", { name: "适应宽度", exact: true }).click();
    await expect.poll(async () => (await geometry(frame)).left).toBe(0);
    await expect
      .poll(
        async () =>
          (await geometry(frame)).scrollWidth - (await geometry(frame)).width,
      )
      .toBeLessThanOrEqual(1);
    const narrow = await geometry(frame);
    await tab.setViewportSize({ width: 1000, height: 900 });
    await expect
      .poll(async () => (await geometry(frame)).scale)
      .toBeGreaterThan(narrow.scale);
    expect((await store.readPage(project.id, page.document.id)).hash).toBe(
      contentBefore.hash,
    );
    expect(await frame.getByRole("button", { name: "编辑图形" }).count()).toBe(
      0,
    );
    await tab.emulateMedia({ media: "print" });
    await expect
      .poll(
        async () =>
          (await geometry(frame)).scrollHeight - (await geometry(frame)).height,
      )
      .toBeLessThanOrEqual(1);
  } finally {
    await browser.close();
    if (server.listening)
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    if (process.env.SHOWAI_KEEP_TEST_FIXTURES !== "1")
      await rm(home, { recursive: true, force: true });
  }
}, 30000);
