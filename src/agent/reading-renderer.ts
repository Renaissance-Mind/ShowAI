import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { measureReadingLayout, type ReadingLayout } from "./reading-layout";
import { pathToFileURL } from "node:url";
import type { Browser, Frame, Locator, Page } from "playwright-core";
import type { ReadingAction, ReadingOptions } from "./page-reading";
import type { Locale } from "../i18n";
import {
  fetchPublicMedia,
  remoteFetchRestricted,
} from "../core/dataset-sources";

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
  capture: {
    mode: "full" | "viewport";
    requestedViewport: { width: number; height: number };
    renderedViewport: { width: number; height: number };
    expanded: boolean;
  };
  layout?: ReadingLayout;
}
const require = createRequire(import.meta.url);
export async function readingBrowserExecutable(): Promise<string> {
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
  let target = action.selector
    ? owner.locator(action.selector)
    : owner.getByRole(action.role!, { name: action.name!, exact: true });
  const message = `Action target is missing or ambiguous: ${action.selector ?? `${action.role} ${action.name}`}. Read the HTML view and specify its blockId.`;
  let matches = await target.count();
  if (matches === 0 && !action.selector) {
    const partial = owner.getByRole(action.role!, { name: action.name! });
    if ((await partial.count()) === 1) {
      target = partial;
      matches = 1;
    }
  }
  if (matches === 0) {
    await target.waitFor({ state: "attached" }).catch((error) => {
      throw new Error(message, { cause: error });
    });
    matches = await target.count();
  }
  if (matches !== 1) throw new Error(message);
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
async function settleFramePaint(frame: Frame): Promise<void> {
  await frame.evaluate(
    () =>
      new Promise<void>((done) => {
        let animation = 0;
        const finish = () => {
          clearTimeout(timer);
          cancelAnimationFrame(animation);
          done();
        };
        const timer = setTimeout(finish, 100);
        animation = requestAnimationFrame(() => {
          animation = requestAnimationFrame(finish);
        });
      }),
  );
}

const PENDING_SELECTOR = '[data-preview-pending="true"]';
const PENDING_TIMEOUT = 10000;
async function settleComponents(page: Page): Promise<void> {
  const { errors } =
    require("playwright-core") as typeof import("playwright-core");
  const deadline = Date.now() + PENDING_TIMEOUT;
  for (const frame of page.frames()) {
    const timedOut = await frame
      .waitForFunction(
        (selector) => !document.querySelector(selector),
        PENDING_SELECTOR,
        { polling: 50, timeout: Math.max(1, deadline - Date.now()) },
      )
      .then(
        () => false,
        (error) => {
          if (error instanceof errors.TimeoutError) return true;
          throw error;
        },
      );
    if (!timedOut) continue;
    const pending = new Set<string>();
    for (const owner of page.frames()) {
      const frameId = await frameBlock(owner);
      const ids = await owner.evaluate(
        (selector) =>
          Array.from(document.querySelectorAll(selector), (node) => {
            const block = node.closest<HTMLElement>("[data-block-id]");
            return block?.dataset.blockId ?? "";
          }),
        PENDING_SELECTOR,
      );
      for (const id of ids) pending.add(id || frameId || "unidentified block");
    }
    throw new Error(
      `Components were still loading after ${PENDING_TIMEOUT / 1000}s: ${[...pending].join(", ")}. The capture would only show a loading placeholder; read them again or use the structured view.`,
    );
  }
}

function contentHeight() {
  let hidden = 0;
  for (const element of document.querySelectorAll<HTMLElement>("body *")) {
    if (element.clientHeight < window.innerHeight / 2) continue;
    if (!/auto|scroll/.test(getComputedStyle(element).overflowY)) continue;
    hidden = Math.max(hidden, element.scrollHeight - element.clientHeight);
  }
  return document.documentElement.scrollHeight + hidden;
}

export async function renderReading(
  htmlPath: string,
  options: ReadingOptions,
  locale?: Locale,
  { image = true }: { image?: boolean } = {},
): Promise<ReadingCapture> {
  const { chromium } =
    require("playwright-core") as typeof import("playwright-core");
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      executablePath: await readingBrowserExecutable(),
      headless: true,
      timeout: 15000,
    });
    const context = await browser.newContext({
      viewport: options.viewport,
      colorScheme: options.theme,
      reducedMotion: "reduce",
      acceptDownloads: false,
      ...(locale ? { locale } : {}),
    });
    const restrictedNetwork = remoteFetchRestricted();
    if (restrictedNetwork)
      await context.route(/^file:/, (route) =>
        route.request().isNavigationRequest() &&
        route.request().url() === pathToFileURL(htmlPath).href
          ? route.continue()
          : route.abort(),
      );
    await context.route(/^https?:/, async (route) => {
      const request = route.request();
      if (
        request.method() !== "GET" ||
        !["image", "media"].includes(request.resourceType())
      )
        return route.abort();
      if (!restrictedNetwork) return route.continue();
      try {
        const media = await fetchPublicMedia(request.url());
        return route.fulfill({ status: 200, ...media });
      } catch {
        return route.abort();
      }
    });
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
    await settleComponents(page);
    for (const frame of page.frames()) {
      await frame.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          Array.from(document.images).map((image) =>
            Promise.race([
              image.decode().catch(() => undefined),
              new Promise((done) => setTimeout(done, 8000)),
            ]),
          ),
        );
      });
      await settleFramePaint(frame);
    }
    for (const action of options.actions) {
      await act(page, action);
      await settleComponents(page);
      for (const frame of page.frames()) await settleFramePaint(frame);
    }
    for (const frame of page.frames()) await settleFramePaint(frame);
    if (options.scrollToBlockId) {
      const id = options.scrollToBlockId;
      const target = page
        .locator(
          `[data-block-id=${JSON.stringify(id)}],[data-surface-id=${JSON.stringify(id)}]`,
        )
        .first();
      if (!(await target.count()))
        throw new Error(`scrollToBlockId is not rendered: ${id}.`);
      await target.evaluate((element) =>
        element.scrollIntoView({
          block: "start",
          inline: "nearest",
          behavior: "instant",
        }),
      );
      for (const frame of page.frames()) await settleFramePaint(frame);
    }
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
    const layout = options.inspect?.layout
      ? await page.evaluate(measureReadingLayout, {
          blockIds: options.inspect.blockIds,
        })
      : undefined;
    const captureInfo = () => ({
      mode: options.capture,
      requestedViewport: options.viewport,
      renderedViewport: page.viewportSize()!,
      expanded: page.viewportSize()!.height !== options.viewport.height,
    });
    if (!image)
      return {
        png: Buffer.alloc(0),
        width: 0,
        height: 0,
        capturedAt: new Date().toISOString(),
        dom,
        components,
        capture: captureInfo(),
        ...(layout ? { layout } : {}),
      };
    let height = await page.evaluate(contentHeight);
    for (
      let attempt = 0;
      options.capture === "full" &&
      options.presentation === "reading" &&
      height > page.viewportSize()!.height &&
      height <= 16000 &&
      attempt < 3;
      attempt++
    ) {
      await page.setViewportSize({ width: options.viewport.width, height });
      await settleComponents(page);
      for (const frame of page.frames()) await settleFramePaint(frame);
      height = await page.evaluate(contentHeight);
    }
    if (options.capture === "full" && height > 16000)
      throw new Error(
        "The rendered page exceeds 16000 px. Read a component or region using blockIds.",
      );
    const png = await page.screenshot({
      fullPage: options.capture === "full",
      animations: "disabled",
    });
    return {
      png,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      capturedAt: new Date().toISOString(),
      dom,
      components,
      capture: captureInfo(),
      ...(layout ? { layout } : {}),
    };
  } finally {
    await browser?.close();
  }
}
