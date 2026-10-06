import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import type { Browser, Frame, Locator, Page } from "playwright-core";
import type { ReadingAction, ReadingOptions } from "./page-reading";

export interface ComponentReading {
  blockId: string;
  status: "computed" | "raw";
  props: Record<string, unknown>;
  data?: unknown;
}
export interface ReadingCapture {
  png: Buffer;
  width: number;
  height: number;
  capturedAt: string;
  dom: { blockId?: string; url: string; accessibility: string }[];
  components: ComponentReading[];
}
const require = createRequire(import.meta.url);
async function executable(): Promise<string> {
  const { chromium } =
    require("playwright-core") as typeof import("playwright-core");
  const supplied = process.env.SHOWAI_BROWSER_EXECUTABLE;
  const candidates = supplied
    ? [supplied]
    : [
        chromium.executablePath(),
        ...(process.platform === "darwin"
          ? [
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
              join(
                homedir(),
                "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              ),
            ]
          : process.platform === "win32"
            ? [
                join(
                  process.env.PROGRAMFILES ?? "C:/Program Files",
                  "Google/Chrome/Application/chrome.exe",
                ),
                join(
                  process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)",
                  "Microsoft/Edge/Application/msedge.exe",
                ),
                join(
                  process.env.LOCALAPPDATA ?? homedir(),
                  "Google/Chrome/Application/chrome.exe",
                ),
              ]
            : [
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
                "/usr/bin/google-chrome",
                "/opt/google/chrome/chrome",
              ]),
      ];
  for (const candidate of candidates) {
    const found = await access(candidate).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (found) return candidate;
  }
  throw new Error(
    supplied
      ? `SHOWAI_BROWSER_EXECUTABLE does not exist: ${supplied}`
      : "Rendered Page reading needs Chrome, Edge or Chromium. Install a browser or set SHOWAI_BROWSER_EXECUTABLE to its executable. Structured reading with --rendered false remains available.",
  );
}
async function frameBlock(frame: Frame): Promise<string | undefined> {
  if (!frame.parentFrame()) return undefined;
  const element = await frame.frameElement();
  return element.evaluate(
    (el) =>
      (el as Element).closest<HTMLElement>("[data-block-id]")?.dataset.blockId,
  );
}
async function actionTarget(
  page: Page,
  action: ReadingAction,
): Promise<Locator> {
  let scope: Page | Frame = page;
  let block: Locator | undefined;
  if (action.blockId) {
    block = page.locator(
      `[data-block-id=${JSON.stringify(action.blockId)}],[data-surface-id=${JSON.stringify(action.blockId)}]`,
    );
    if ((await block.count()) !== 1)
      throw new Error(
        `Action block is missing or ambiguous: ${action.blockId}`,
      );
    for (const frame of page.frames())
      if ((await frameBlock(frame)) === action.blockId) {
        scope = frame;
        block = undefined;
        break;
      }
  }
  const owner = block ?? scope;
  const target = action.selector
    ? owner.locator(action.selector)
    : owner.getByRole(action.role!, { name: action.name!, exact: true });
  if ((await target.count()) !== 1)
    throw new Error(
      `Action target is missing or ambiguous: ${action.selector ?? `${action.role} ${action.name}`}. Read the HTML view and specify its blockId.`,
    );
  return target;
}
async function act(page: Page, action: ReadingAction) {
  const target = await actionTarget(page, action);
  switch (action.type) {
    case "hover":
      await target.hover();
      break;
    case "click":
      await target.click();
      break;
    case "fill":
      await target.fill(action.value!);
      break;
    case "select":
      await target.selectOption(action.value!);
      break;
    case "check":
      await target.check();
      break;
    case "uncheck":
      await target.uncheck();
      break;
    case "drag": {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error("Drag target is not visible.");
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (action.dx ?? 0), y + (action.dy ?? 0), {
        steps: 8,
      });
      await page.mouse.up();
      break;
    }
  }
}
export async function renderReading(
  htmlPath: string,
  options: ReadingOptions,
): Promise<ReadingCapture> {
  const { chromium } =
    require("playwright-core") as typeof import("playwright-core");
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      executablePath: await executable(),
      headless: true,
      timeout: 15000,
    });
    const context = await browser.newContext({
      viewport: options.viewport,
      colorScheme: options.theme,
      reducedMotion: "reduce",
      acceptDownloads: false,
    });
    // The preview is self-contained. Component code stays in its browser sandbox.
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(htmlPath).href, {
      waitUntil: "load",
      timeout: 15000,
    });
    await page
      .locator(".portable-app")
      .waitFor()
      .catch((error) => {
        if (errors.length)
          throw new Error(`Page preview failed: ${errors.join("; ")}`, {
            cause: error,
          });
        throw error;
      });
    for (const frame of page.frames()) {
      if (!frame.parentFrame()) continue;
      await frame.waitForFunction(
        () =>
          !!document.getElementById("component-root") &&
          (document.getElementById("component-root")!.childElementCount > 0 ||
            !!(
              window as unknown as {
                __SHOWAI_COMPONENT_READING__?: { ready: boolean };
              }
            ).__SHOWAI_COMPONENT_READING__?.ready),
      );
    }
    for (const frame of page.frames())
      await frame.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          Array.from(document.images).map((image) => image.decode()),
        );
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
    for (const action of options.actions) await act(page, action);
    for (const frame of page.frames())
      await frame.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
    if (errors.length)
      throw new Error(`Page preview failed: ${errors.join("; ")}`);
    const visibleError = await page
      .locator(".portable-error,.sb-unavailable,.custom-error")
      .allTextContents();
    if (visibleError.some((value) => value.trim()))
      throw new Error(`Page preview failed: ${visibleError.join("; ")}`);
    const dom: ReadingCapture["dom"] = [];
    const components: ComponentReading[] = [];
    for (const frame of page.frames()) {
      const blockId = await frameBlock(frame);
      dom.push({
        ...(blockId ? { blockId } : {}),
        url: frame.parentFrame() ? "component-sandbox" : frame.url(),
        accessibility: await frame
          .locator("body")
          .ariaSnapshot({ timeout: 5000 }),
      });
      if (blockId) {
        const reading = await frame.evaluate(
          () =>
            (
              window as unknown as {
                __SHOWAI_COMPONENT_READING__?: {
                  status: string;
                  props: Record<string, unknown>;
                  data?: unknown;
                  error?: string;
                };
              }
            ).__SHOWAI_COMPONENT_READING__,
        );
        if (reading?.status === "error")
          throw new Error(
            `Component readData failed in ${blockId}: ${reading.error}`,
          );
        if (reading)
          components.push({
            blockId,
            status: reading.status === "computed" ? "computed" : "raw",
            props: reading.props,
            ...(reading.data !== undefined ? { data: reading.data } : {}),
          });
      }
    }
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    if (height > 16000)
      throw new Error(
        "The rendered page exceeds 16000 px. Read a component or region using blockIds.",
      );
    const png = await page.screenshot({
      fullPage: true,
      animations: "disabled",
    });
    return {
      png,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      capturedAt: new Date().toISOString(),
      dom,
      components,
    };
  } finally {
    await browser?.close();
  }
}
