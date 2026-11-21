import { chromium, _electron, type Page, type Locator } from "playwright-core";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import pixelmatch from "pixelmatch";
import { uiFeatures } from "./registry";
import { checkMotion } from "./check-motion";
import motionMessages from "../i18n/messages/uiMotion";
import { messages, motionSummary } from "./messages";
import type {
  LabSession,
  MotionObservation,
  SceneContext,
  UiDriver,
  UiTarget,
} from "./types";
import { sourceIdentity } from "./source";
import { uiFlow } from "./flow";
import type { UiScene } from "./types";
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

export interface UiRunOptions {
  origin: string;
  output: string;
  repository: string;
  feature?: string;
  scenes?: string[];
  flow?: boolean;
  nodes?: string[];
  annotations?: boolean;
  theme?: "light" | "dark";
  locale?: "zh-CN" | "en";
  width?: number;
  height?: number;
  scale?: number;
  renderer?: "chromium" | "electron";
  baseline?: string;
  updateBaseline?: boolean;
}
export function playwrightDriver(page: Page): UiDriver {
  const escape = (value: string) =>
    [...value]
      .map((character) =>
        "\\^$.*+?()[]{}|".includes(character) ? "\\" + character : character,
      )
      .join("");
  function locate(target: UiTarget): Locator {
    const root = target.within ? locate(target.within) : page;
    if (target.role)
      return root.getByRole(target.role, { name: target.name, exact: true });
    if (target.testId) return root.getByTestId(target.testId);
    if (target.selector) {
      const locator = root.locator(target.selector);
      return target.name
        ? locator.filter({
            hasText: new RegExp(`^${escape(target.name)}$`),
          })
        : locator;
    }
    if (target.name) return root.getByText(target.name, { exact: true });
    throw new Error("UI target requires a role, test ID or selector.");
  }
  return {
    click: async (target) => {
      await locate(target).click();
    },
    fill: async (target, value) => {
      await locate(target).fill(value);
    },
    select: async (target, value) => {
      const locator = locate(target);
      if ((await locator.evaluate((el) => el.tagName)) === "SELECT")
        await locator.selectOption(value);
      else {
        await locator.click();
        await page
          .locator(`[role="listbox"] [role="option"][data-value=${JSON.stringify(value)}]`)
          .click();
      }
    },
    async expect(target, state = "visible") {
      const locator = locate(target);
      await locator.waitFor({
        state: state === "hidden" ? "hidden" : "visible",
      });
      if (state !== "hidden") await locator.scrollIntoViewIfNeeded();
      if (
        (state === "disabled" && !(await locator.isDisabled())) ||
        (state === "enabled" && !(await locator.isEnabled()))
      )
        throw new Error(`Unexpected control state: ${state}`);
    },
  };
}

export async function comparePng(
  actual: Buffer,
  baseline: string,
  difference: string,
  update = false,
) {
  if (update) {
    await mkdir(resolve(baseline, ".."), { recursive: true });
    await writeFile(baseline, actual);
    return { state: "updated", differentPixels: 0 };
  }
  const expected = await readFile(baseline).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (!expected) return { state: "missing", differentPixels: 0 };
  const a = PNG.sync.read(actual),
    b = PNG.sync.read(expected);
  if (a.width !== b.width || a.height !== b.height)
    return { state: "size-changed", differentPixels: a.width * a.height };
  const diff = new PNG({ width: a.width, height: a.height });
  const count = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.1,
  });
  if (count) await writeFile(difference, PNG.sync.write(diff));
  return {
    state: count / (a.width * a.height) > 0.001 ? "changed" : "passed",
    differentPixels: count,
    ratio: count / (a.width * a.height),
  };
}

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images].filter(
      (image) => image.getClientRects().length && image.currentSrc,
    );
    await Promise.all(
      images.map((image) =>
        image.complete
          ? image.naturalWidth
            ? Promise.resolve()
            : Promise.reject(new Error(`Image failed: ${image.currentSrc}`))
          : image.decode(),
      ),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
async function layout(page: Page) {
  return page.evaluate(() => {
    const rect = (element: Element) => {
      const b = element.getBoundingClientRect();
      return {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        right: b.right,
        bottom: b.bottom,
      };
    };
    const visible = (element: Element) =>
      element.getClientRects().length &&
      getComputedStyle(element).visibility !== "hidden";
    const luminance = (color: string) => {
      const rgb = color
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number) ?? [0, 0, 0];
      const linear = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const studio = document.querySelector(".studio"),
      main = document.querySelector(".studio-settings");
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter(visible)
      .map((element) => {
        const bounds = rect(element),
          controls = [...element.querySelectorAll("input,select,textarea")]
            .filter(visible)
            .map((control) => rect(control));
        return {
          name: element.getAttribute("aria-label"),
          bounds,
          minimumInset: controls.length
            ? Math.min(
                ...controls.map((control) =>
                  Math.min(control.x - bounds.x, bounds.right - control.right),
                ),
              )
            : null,
        };
      });
    const primaryButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".settings-button.primary,.studio-button.primary,.rm-button.primary",
      ),
    ]
      .filter((element) => visible(element) && !element.disabled)
      .map((element) => {
        const css = getComputedStyle(element),
          a = luminance(css.color),
          b = luminance(css.backgroundColor);
        return {
          text: element.textContent?.trim(),
          color: css.color,
          background: css.backgroundColor,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
      },
      root: studio ? rect(studio) : null,
      settings: main ? rect(main) : null,
      horizontalOverflow:
        document.documentElement.scrollWidth > innerWidth + 1 ||
        [
          ...document.querySelectorAll(
            ".studio-settings,.remote-flow,.remote-settings,.studio-modal",
          ),
        ].some((element) => element.scrollWidth > element.clientWidth + 1),
      dialogs,
      primaryButtons,
      fonts: document.fonts.status,
      styleSheets: document.styleSheets.length,
    };
  });
}
export async function runUiScenes(options: UiRunOptions) {
  const theme = options.theme ?? "light",
    locale = options.locale ?? "zh-CN",
    width = options.width ?? 1440,
    height = options.height ?? 1000,
    scale = options.scale ?? 2,
    renderer = options.renderer ?? "chromium";
  if (
    ![width, height, scale].every(Number.isFinite) ||
    ![width, height].every(Number.isInteger) ||
    ![1, 2].includes(scale) ||
    width < 760 ||
    width > 2560 ||
    height < 560 ||
    height > 1800 ||
    scale < 1 ||
    scale > 2
  )
    throw new Error("Unsupported UI capture dimensions.");
  if (
    !["light", "dark"].includes(theme) ||
    !["zh-CN", "en"].includes(locale) ||
    !["chromium", "electron"].includes(renderer)
  )
    throw new Error("Unsupported UI capture environment.");
  const runId =
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      Math.random().toString(16).slice(2, 8),
    directory = join(options.output, runId);
  await mkdir(directory, { recursive: true });
  const cases = uiFeatures(locale)
    .filter((feature) => !options.feature || feature.id === options.feature)
    .flatMap((feature) =>
      (options.flow
        ? uiFlow(feature.id, locale)
            .nodes.filter(
              (node) =>
                !options.nodes?.length || options.nodes.includes(node.id),
            )
            .map((node): UiScene => ({
              id: node.id,
              description: node.title,
              title: `${node.screenTitle} · ${node.title}`,
              fixture: feature.scenes.find((scene) => scene.id === node.scene)!
                .fixture,
              prepare: node.enter,
              steps: [
                {
                  id: "state",
                  title: node.title,
                  run: async (ctx) => {
                    for (const match of node.matches)
                      await ctx.ui.expect(match.target, match.state);
                    if (node.when)
                      ctx.assert(
                        node.when(await ctx.inspect()),
                        "The requested UI condition must be active.",
                      );
                  },
                },
                ...(node.checks ?? []),
              ],
            }))
        : feature.scenes
      )
        .filter(
          (scene) =>
            options.flow ||
            !options.scenes?.length ||
            options.scenes.includes(scene.id),
        )
        .flatMap((scene) => {
          const preferences: ("no-preference" | "reduce" | undefined)[] =
            scene.steps.some((step) => step.motion)
              ? ["no-preference", "reduce"]
              : [undefined];
          return preferences.map((preference) => ({
            feature: feature.id,
            scene,
            preference,
          }));
        }),
    );
  if (!cases.length) throw new Error("No matching UI scenes.");
  const report = {
    schemaVersion: 1,
    status: "running",
    id: runId,
    passed: true,
    renderer,
    theme,
    locale,
    viewport: { width, height, scale },
    source: "src/main.tsx → App → Studio",
    sourceIdentity: sourceIdentity(options.repository),
    backendSource: (
      await fetch(options.origin + "/__ui-lab/api/catalog").then((response) =>
        response.json(),
      )
    ).backendSource,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    results: [] as Array<Record<string, unknown>>,
    errors: [] as string[],
    focus: {
      strategy: renderer === "electron" ? "hidden-window" : "headless",
      visible: false,
      focused: false,
      violations: [] as string[],
    },
  };
  const saveReport = async () => {
    const path = join(directory, "report.json");
    await writeFile(path + ".tmp", JSON.stringify(report, null, 2));
    await rename(path + ".tmp", path);
  };
  const browser =
    renderer === "chromium"
      ? await chromium.launch({ headless: true })
      : undefined;
  try {
    for (const item of cases) {
      const prefix = [item.feature, item.scene.id, item.preference]
        .filter(Boolean)
        .join("--");
      const response = await fetch(options.origin + "/__ui-lab/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          feature: item.feature,
          scene: item.scene.id,
          theme,
          locale,
          mode: "test",
          ...(options.flow
            ? {
                flow: true,
                node: item.scene.id,
                annotations: options.annotations ?? false,
              }
            : {}),
        }),
      });
      const session = (await response.json()) as LabSession;
      if (!response.ok) throw new Error(JSON.stringify(session));
      const headers = {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`,
      };
      const call = async (path: string, input?: unknown) => {
        const result = await fetch(
          `${options.origin}/__ui-lab/api/sessions/${session.id}/${path}`,
          {
            method: input === undefined ? "GET" : "POST",
            headers,
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
          },
        );
        const data = await result.json();
        if (!result.ok) throw new Error(data.error);
        return data;
      };
      const context = browser
        ? await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: scale,
            locale,
            reducedMotion: item.preference ?? "reduce",
          })
        : undefined;
      const electron =
        renderer === "electron"
          ? await _electron.launch({
              executablePath: require("electron"),
              args: [join(options.repository, "scripts/ui-lab-electron.cjs")],
              cwd: options.repository,
              env: {
                ...Object.fromEntries(
                  Object.entries(process.env).filter(
                    (entry): entry is [string, string] =>
                      entry[1] !== undefined &&
                      entry[0] !== "ELECTRON_RUN_AS_NODE",
                  ),
                ),
                SHOWAI_BACKGROUND: "1",
                SHOWAI_UI_LAB_PROFILE: join(directory, prefix + "-profile"),
                SHOWAI_UI_LAB_URL: session.appUrl + "&prepare=0",
                SHOWAI_UI_LAB_WIDTH: String(width),
                SHOWAI_UI_LAB_HEIGHT: String(height),
                SHOWAI_UI_LAB_SCALE: String(scale),
              },
            })
          : undefined;
      const page = context
        ? await context.newPage()
        : await electron!.firstWindow();
      page.setDefaultTimeout(15000);
      const errors: string[] = [],
        consoleErrors: string[] = [],
        checkpoints: Array<Record<string, unknown>> = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const result: Record<string, unknown> = {
        feature: item.feature,
        scene: item.scene.id,
        title: item.preference
          ? item.scene.title +
            " · " +
            messages(
              motionMessages,
              locale,
            )(item.preference === "reduce" ? "motionOff" : "motionOn")
          : item.scene.title,
        ...(item.preference ? { motionPreference: item.preference } : {}),
        passed: true,
        checkpoints,
        errors,
        consoleErrors,
        simulatedService: item.scene.fixture !== "none",
      };
      report.results.push(result);
      try {
        if (electron && item.preference)
          await page.emulateMedia({ reducedMotion: item.preference });
        if (context) await page.goto(session.appUrl + "&prepare=0");
        await page.waitForFunction(
          () =>
            document.documentElement.dataset.uiLabReady === "true" ||
            !!document.documentElement.dataset.uiLabError,
        );
        const bootError = await page.getAttribute("html", "data-ui-lab-error");
        if (bootError) throw new Error(bootError);
        const uiContext: SceneContext = {
          locale: session.locale,
          ui: playwrightDriver(page),
          event: (name, input = {}) => call("events", { name, input }),
          inspect: () => call("inspect"),
          assert(value, message) {
            if (!value) throw new Error(message);
          },
        };
        await item.scene.prepare(uiContext);
        if (options.flow)
          await page.waitForFunction(
            (id) => document.documentElement.dataset.uiLabNode === id,
            item.scene.id,
          );
        if (
          options.flow &&
          uiFlow(item.feature, locale).nodes.find(
            (node) => node.id === item.scene.id,
          )!.actions.length
        )
          if (!Number(await page.getAttribute("html", "data-ui-lab-actions")))
            throw new Error(
              "No declared test action is available on this state.",
            );
        for (const step of item.scene.steps) {
          let motion;
          if (step.motion && item.preference) {
            motion = await checkMotion(page, step.motion, item.preference, () =>
              step.run(uiContext),
            );
          } else await step.run(uiContext);
          await settled(page);
          const metrics = await layout(page);
          if (
            !metrics.root ||
            metrics.root.x !== 0 ||
            metrics.root.y !== 0 ||
            metrics.root.width !== width ||
            metrics.root.height !== height ||
            metrics.horizontalOverflow
          )
            throw new Error(
              "The actual application viewport is missing or overflowing.",
            );
          for (const dialog of metrics.dialogs)
            if (
              dialog.minimumInset !== null &&
              dialog.minimumInset < (item.scene.layout?.dialogPadding ?? 0)
            )
              throw new Error(
                `Dialog content touches its edge: ${dialog.name} (${dialog.minimumInset}px)`,
              );
          for (const button of metrics.primaryButtons)
            if (button.contrast < (item.scene.layout?.primaryContrast ?? 0))
              throw new Error(
                `Primary action contrast is too low: ${button.text} (${button.contrast.toFixed(2)})`,
              );
          if (errors.length) throw new Error(errors.join("\n"));
          const name = `${prefix}--${step.id}`,
            file = name + ".png";
          const bytes = await page.screenshot({
            animations: "disabled",
            caret: "hide",
            fullPage: false,
            scale: scale === 1 ? "css" : "device",
          });
          await writeFile(join(directory, file), bytes);
          const image = PNG.sync.read(bytes);
          if (image.width !== width * scale || image.height !== height * scale)
            throw new Error(
              "Screenshot pixel dimensions do not match its declared viewport.",
            );
          let visual = { state: "unreviewed", differentPixels: 0 };
          let baselineFile: string | undefined,
            differenceFile: string | undefined;
          if (options.baseline)
            visual = await comparePng(
              bytes,
              join(
                options.baseline,
                `${process.platform}-${process.arch}-${renderer}-${locale}-${theme}-${width}x${height}-${scale}`,
                file,
              ),
              join(directory, name + ".diff.png"),
              options.updateBaseline,
            );
          if (options.baseline && visual.state !== "missing") {
            baselineFile = name + ".baseline.png";
            await writeFile(
              join(directory, baselineFile),
              await readFile(
                join(
                  options.baseline,
                  `${process.platform}-${process.arch}-${renderer}-${locale}-${theme}-${width}x${height}-${scale}`,
                  file,
                ),
              ),
            );
            if (visual.state === "changed") differenceFile = name + ".diff.png";
          }
          if (["changed", "size-changed", "missing"].includes(visual.state)) {
            result.passed = false;
            report.passed = false;
          }
          checkpoints.push({
            id: step.id,
            title: step.title,
            file,
            width: image.width,
            height: image.height,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            visual,
            baselineFile,
            differenceFile,
            metrics,
            ...(motion ? { motion } : {}),
          });
          await writeFile(
            join(directory, name + ".dom.txt"),
            await page.locator("body").ariaSnapshot(),
          );
          if (step.capture) {
            const target = step.capture.role
              ? page.getByRole(step.capture.role, {
                  name: step.capture.name,
                  exact: true,
                })
              : page.locator(step.capture.selector!);
            await target.screenshot({
              path: join(directory, name + ".detail.png"),
              animations: "disabled",
              scale: scale === 1 ? "css" : "device",
            });
          }
          if (electron) {
            const state = await electron.evaluate(({ BrowserWindow }) => ({
              windows: BrowserWindow.getAllWindows().map((window) => ({
                visible: window.isVisible(),
                focused: window.isFocused(),
              })),
              events: (
                globalThis as unknown as { __SHOWAI_UI_LAB_FOCUS__: unknown[] }
              ).__SHOWAI_UI_LAB_FOCUS__,
            }));
            report.focus.visible ||= state.windows.some(
              (window) => window.visible,
            );
            report.focus.focused ||= state.windows.some(
              (window) => window.focused,
            );
            if (
              state.events.length ||
              state.windows.some((window) => window.visible || window.focused)
            ) {
              report.focus.violations.push(name);
              throw new Error("A UI test window became visible or focused.");
            }
          }
        }
      } catch (error) {
        result.passed = false;
        report.passed = false;
        result.error = error instanceof Error ? error.stack : String(error);
        result.failureMetrics = await layout(page);
        await writeFile(
          join(directory, prefix + "--failure.dom.txt"),
          await page.locator("body").ariaSnapshot(),
        );
        await page
          .screenshot({
            path: join(directory, prefix + "--failure.png"),
            animations: "disabled",
          })
          .catch(() => {});
      } finally {
        try {
          const inspected = await call("inspect");
          await writeFile(
            join(directory, prefix + "--trace.json"),
            JSON.stringify(inspected, null, 2),
          );
          if (electron) {
            result.nativeFocusEvents = await electron.evaluate(
              () =>
                (
                  globalThis as unknown as {
                    __SHOWAI_UI_LAB_FOCUS__: unknown[];
                  }
                ).__SHOWAI_UI_LAB_FOCUS__,
            );
            if ((result.nativeFocusEvents as unknown[]).length) {
              result.passed = false;
              report.passed = false;
              report.focus.violations.push(item.feature + "--" + item.scene.id);
            }
          }
        } finally {
          await context?.close();
          await electron?.close();
          if (electron) await rmProfile(join(directory, prefix + "-profile"));
          await fetch(`${options.origin}/__ui-lab/api/sessions/${session.id}`, {
            method: "DELETE",
            headers,
          });
        }
      }
      await saveReport();
    }
  } finally {
    await browser?.close();
  }
  report.finishedAt = new Date().toISOString();
  const finalSource = sourceIdentity(options.repository);
  if (finalSource.hash !== report.sourceIdentity.hash) {
    report.passed = false;
    report.errors.push(
      "Source changed during the UI run. Run it again against a stable revision.",
    );
  }
  report.status = report.passed ? "passed" : "failed";
  await saveReport();
  const escape = (value: unknown) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character]!,
    );
  const cards = report.results
    .map(
      (result) =>
        `<section><h2>${escape(result.title)} · ${result.passed ? "PASS" : "FAIL"}</h2>${result.error ? `<pre>${escape(result.error)}</pre>` : ""}${(
          result.checkpoints as Array<Record<string, unknown>>
        )
          .map(
            (point) =>
              `<figure><h3>${escape(point.title)}</h3><div class="shots">${[
                ["Actual", point.file],
                ["Baseline", point.baselineFile],
                ["Difference", point.differenceFile],
              ]
                .filter(([, file]) => file)
                .map(
                  ([label, file]) =>
                    `<a href="${escape(file)}">${escape(label)}<img loading="lazy" src="${escape(file)}"></a>`,
                )
                .join(
                  "",
                )}</div><figcaption>${escape((point.visual as { state: string }).state)}${point.motion ? " · " + escape(motionSummary(point.motion as MotionObservation, locale)) : ""}</figcaption></figure>`,
          )
          .join("")}</section>`,
    )
    .join("");
  await writeFile(
    join(directory, "index.html"),
    `<!doctype html><html><meta charset="utf-8"><title>ShowAI UI Lab</title><style>body{font:16px system-ui;max-width:1200px;margin:32px auto;padding:0 24px}img{width:100%;border:1px solid #ddd}figure{margin:24px 0 40px}.shots{display:flex;gap:12px}.shots>a{flex:1;min-width:0}pre{white-space:pre-wrap;color:#a33}figcaption{color:#666}</style><h1>ShowAI UI Lab · ${report.passed ? "PASS" : "FAIL"}</h1><p>${escape(renderer)} · ${width}×${height} @${scale} · ${theme}</p>${report.errors.map((error) => `<pre>${escape(error)}</pre>`).join("")}${cards}</html>`,
  );
  return { ...report, directory };
}
async function rmProfile(path: string) {
  const { rm } = await import("node:fs/promises");
  await rm(path, { recursive: true, force: true });
}
