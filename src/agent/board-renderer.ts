import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readingBrowserExecutable } from "./reading-renderer";
import type { BoardRect } from "./board-reading-geometry";

export interface CapturedElement {
  nodeId: string;
  bounds: BoardRect;
  visibleBounds: BoardRect | null;
  layerIndex: number;
}
export interface FrozenBoard {
  html: string;
  elements: CapturedElement[];
  warnings: string[];
  capturedAt: string;
  states: {
    nodeId: string;
    scrollX: number;
    scrollY: number;
    camera?: { x: number; y: number; scale: number };
  }[];
}
const require = createRequire(import.meta.url);

async function browser() {
  const { chromium } =
    require("playwright-core") as typeof import("playwright-core");
  return chromium.launch({
    executablePath: await readingBrowserExecutable(),
    headless: true,
    timeout: 15000,
  });
}

/** Freeze rendered DOM, canvases, form values, scrolling and iframe bodies once. */
export async function freezeBoard(
  htmlPath: string,
  boardId: string,
  nodeIds: string[],
  theme: "light" | "dark",
): Promise<FrozenBoard> {
  const instance = await browser();
  try {
    const context = await instance.newContext({
      viewport: { width: 2560, height: 2560 },
      colorScheme: theme,
      reducedMotion: "reduce",
      acceptDownloads: false,
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(pathToFileURL(htmlPath).href, {
      waitUntil: "load",
      timeout: 30000,
    });
    const root = page.locator(
      `[data-container-root=${JSON.stringify(boardId)}] > .container-board-scene > .page-surface > .surface-scroll > .surface-world`,
    );
    // The world is an origin with absolutely positioned children; its own box can be zero-sized.
    await root.waitFor({ state: "attached" });
    const warnings: string[] = [];
    for (const frame of page.frames()) {
      if (frame.parentFrame()) {
        await frame.waitForLoadState("load");
        const element = await frame.frameElement();
        const custom = (await element.getAttribute("srcdoc"))?.includes(
          "component-root",
        );
        if (custom)
          await frame.waitForFunction(() => {
            const root = document.getElementById("component-root");
            return (
              !!root &&
              (root.childElementCount > 0 ||
                !!(
                  window as unknown as {
                    __SHOWAI_COMPONENT_READING__?: { ready: boolean };
                  }
                ).__SHOWAI_COMPONENT_READING__?.ready)
            );
          });
      }
      await frame.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((image) =>
            image.decode().catch(() => undefined),
          ),
        );
        for (const media of document.querySelectorAll<HTMLMediaElement>(
          "video,audio",
        ))
          media.pause();
      });
    }
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}[data-surface-ui],.surface-metadata,.portable-options,.viewport-lock-toggle{visibility:hidden!important}",
    });
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    const serialize = () => {
      const doc = document;
      const keep = [
        "display",
        "position",
        "left",
        "top",
        "right",
        "bottom",
        "width",
        "height",
        "min-width",
        "max-width",
        "min-height",
        "max-height",
        "box-sizing",
        "margin",
        "padding",
        "border",
        "border-radius",
        "outline",
        "box-shadow",
        "background",
        "background-color",
        "background-image",
        "background-size",
        "background-position",
        "color",
        "opacity",
        "overflow",
        "overflow-x",
        "overflow-y",
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "line-height",
        "letter-spacing",
        "text-align",
        "text-decoration",
        "white-space",
        "word-break",
        "overflow-wrap",
        "vertical-align",
        "flex",
        "flex-direction",
        "flex-wrap",
        "align-items",
        "justify-content",
        "gap",
        "grid-template-columns",
        "grid-template-rows",
        "grid-column",
        "grid-row",
        "transform",
        "transform-origin",
        "z-index",
        "object-fit",
        "object-position",
        "fill",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "visibility",
        "clip-path",
      ];
      const clone = (source: Node): Node => {
        if (!(source instanceof Element)) return source.cloneNode();
        if (["SCRIPT", "STYLE", "LINK"].includes(source.tagName))
          return doc.createTextNode("");
        const style = getComputedStyle(source);
        if (
          source instanceof HTMLCanvasElement ||
          source instanceof HTMLVideoElement
        ) {
          const image = doc.createElement("img"),
            canvas =
              source instanceof HTMLCanvasElement
                ? source
                : doc.createElement("canvas");
          if (source instanceof HTMLVideoElement) {
            canvas.width = source.videoWidth || source.clientWidth;
            canvas.height = source.videoHeight || source.clientHeight;
            if (source.readyState >= 2)
              canvas
                .getContext("2d")!
                .drawImage(source, 0, 0, canvas.width, canvas.height);
            else if (source.poster) image.src = source.poster;
          }
          image.src ||= canvas.toDataURL();
          for (const key of keep)
            image.style.setProperty(key, style.getPropertyValue(key));
          image.setAttribute(
            "data-capture-rasterized",
            source.tagName.toLowerCase(),
          );
          return image;
        }
        const target = source.cloneNode(false) as HTMLElement;
        for (const attr of [...target.attributes])
          if (/^on/i.test(attr.name)) target.removeAttribute(attr.name);
        if (target.style)
          for (const key of keep)
            target.style.setProperty(key, style.getPropertyValue(key));
        if (source instanceof HTMLInputElement) {
          target.setAttribute("value", source.value);
          if (source.checked) target.setAttribute("checked", "");
          else target.removeAttribute("checked");
        }
        if (source instanceof HTMLOptionElement) {
          if (source.selected) target.setAttribute("selected", "");
          else target.removeAttribute("selected");
        }
        if (source instanceof HTMLTextAreaElement)
          target.textContent = source.value;
        else for (const child of source.childNodes) target.append(clone(child));
        if (
          source instanceof HTMLElement &&
          (source.scrollTop || source.scrollLeft)
        ) {
          const wrapper = doc.createElement("div");
          wrapper.style.cssText = `width:${source.scrollWidth}px;min-height:${source.scrollHeight}px;transform:translate(${-source.scrollLeft}px,${-source.scrollTop}px);transform-origin:0 0`;
          wrapper.setAttribute(
            "data-capture-scroll",
            `${source.scrollLeft},${source.scrollTop}`,
          );
          wrapper.append(...target.childNodes);
          target.append(wrapper);
        }
        return target;
      };
      const styles = [...doc.querySelectorAll("style")]
        .map((el) => el.outerHTML)
        .join("\n");
      return { body: (clone(doc.body) as HTMLElement).innerHTML, styles };
    };
    // Freeze child frames before parents so a component containing nested iframes
    // retains every frame body, without assuming a custom runtime's root marker.
    for (const frame of page.frames().reverse()) {
      if (!frame.parentFrame()) continue;
      const handle = await frame.frameElement();
      const frozen = await frame.evaluate(serialize);
      await handle.evaluate((el, html) => {
          (el as Element).setAttribute("srcdoc", html);
          (el as Element).removeAttribute("src");
      }, `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">${frozen.styles}<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body>${frozen.body}</body></html>`);
    }
    const measurement = await root.evaluate((world, ids) => {
      const origin = world.getBoundingClientRect(),
        matrix = new DOMMatrix(getComputedStyle(world).transform),
        scale = matrix.a;
      const known = new Set(ids),
        seen = new Set<string>(),
        elements: CapturedElement[] = [];
      const rect = (b: {
        left: number;
        top: number;
        width: number;
        height: number;
      }): BoardRect => ({
        x: (b.left - origin.left) / scale,
        y: (b.top - origin.top) / scale,
        width: b.width / scale,
        height: b.height / scale,
      });
      for (const el of world.querySelectorAll<HTMLElement>(
        "[data-surface-id],[data-block-id]",
      )) {
        const nodeId = el.dataset.surfaceId ?? el.dataset.blockId!;
        if (!known.has(nodeId) || seen.has(nodeId)) continue;
        seen.add(nodeId);
        const box = el.getBoundingClientRect();
        if (!(box.width > 0 && box.height > 0)) continue;
        let bounds = rect(box);
        const svg = el.querySelector<SVGGraphicsElement>(
          ":scope > .surface-object-content > .board-drawing",
        );
        if (svg) {
          const ink = svg.getBBox(),
            m = svg.getScreenCTM()!;
          const pts = [
            new DOMPoint(ink.x, ink.y),
            new DOMPoint(ink.x + ink.width, ink.y),
            new DOMPoint(ink.x, ink.y + ink.height),
            new DOMPoint(ink.x + ink.width, ink.y + ink.height),
          ].map((p) => p.matrixTransform(m));
          const stroke = svg.querySelector("g")!;
          const pad =
            (parseFloat(getComputedStyle(stroke).strokeWidth) *
              Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))) /
            2;
          const left = Math.min(...pts.map((p) => p.x)) - pad,
            top = Math.min(...pts.map((p) => p.y)) - pad;
          bounds = rect({
            left,
            top,
            width: Math.max(1, Math.max(...pts.map((p) => p.x)) - left + pad),
            height: Math.max(1, Math.max(...pts.map((p) => p.y)) - top + pad),
          });
        }
        let visible: BoardRect | null = { ...bounds };
        for (
          let parent = el.parentElement;
          parent && parent !== world && visible;
          parent = parent.parentElement
        ) {
          const s = getComputedStyle(parent);
          if (/hidden|clip|auto|scroll/.test(`${s.overflowX} ${s.overflowY}`)) {
            const clip = rect(parent.getBoundingClientRect()),
              x = Math.max(visible.x, clip.x),
              y = Math.max(visible.y, clip.y),
              width: number =
                Math.min(visible.x + visible.width, clip.x + clip.width) - x,
              height: number =
                Math.min(visible.y + visible.height, clip.y + clip.height) - y;
            visible = width > 0 && height > 0 ? { x, y, width, height } : null;
          }
        }
        if (
          getComputedStyle(el).visibility === "hidden" ||
          getComputedStyle(el).display === "none"
        )
          visible = null;
        elements.push({
          nodeId,
          bounds,
          visibleBounds: visible,
          layerIndex: elements.length,
        });
      }
      const states: FrozenBoard["states"] = [
        ...world.querySelectorAll<HTMLElement>("[data-container-root]"),
      ].map((el) => {
        const nested = el.querySelector<HTMLElement>(
          ":scope > .container-board-scene > .page-surface > .surface-scroll > .surface-world",
        );
        const camera = nested
          ? new DOMMatrix(getComputedStyle(nested).transform)
          : undefined;
        return {
          nodeId: el.dataset.containerRoot!,
          scrollX: el.scrollLeft,
          scrollY: el.scrollTop,
          ...(camera
            ? { camera: { x: camera.e, y: camera.f, scale: camera.a } }
            : {}),
        };
      });
      states.unshift({
        nodeId: world.closest<HTMLElement>("[data-container-root]")!.dataset
          .containerRoot!,
        scrollX: 0,
        scrollY: 0,
        camera: { x: matrix.e, y: matrix.f, scale },
      });
      return { elements, states };
    }, nodeIds);
    const frozen = await page.evaluate(serialize);
    const worldHtml = await page.evaluate(
      ({ body, boardId }) => {
        const holder = document.createElement("div");
        holder.innerHTML = body;
        const world = holder.querySelector<HTMLElement>(
          `[data-container-root="${CSS.escape(boardId)}"] > .container-board-scene > .page-surface > .surface-scroll > .surface-world`,
        )!;
        world.id = "board-scene";
        world.style.transform = "none";
        world.style.transformOrigin = "0 0";
        world.style.left = "0";
        world.style.top = "0";
        return world.outerHTML;
      },
      { body: frozen.body, boardId },
    );
    const errors = await page
      .locator(".sb-unavailable,.custom-error,.portable-error")
      .allTextContents();
    warnings.push(...errors.filter(Boolean));
    const html = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">${frozen.styles}<style>html,body{margin:0!important;padding:0!important;overflow:hidden!important;width:100%;height:100%;}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.portable-app,.container-workspace,.container-main,.container-board,.container-board-scene,.page-surface,.surface-scroll{width:100%!important;height:100%!important;max-width:none!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;}[data-surface-ui],.surface-metadata,.portable-options,.viewport-lock-toggle{display:none!important}</style></head><body><div class="portable-app"><div class="container-workspace"><div class="container-board is-root"><div class="container-board-scene"><div class="page-surface"><div class="surface-scroll">${worldHtml}</div></div></div></div></div></div></body></html>`;
    return {
      html,
      ...measurement,
      warnings,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await instance.close();
  }
}

export interface FrozenImageRequest {
  key: string;
  bounds: BoardRect;
  scale: number;
}
export async function renderFrozenBoard(
  htmlPath: string,
  requests: FrozenImageRequest[],
): Promise<
  {
    key: string;
    png: Buffer;
    width: number;
    height: number;
    bounds: BoardRect;
    scale: number;
  }[]
> {
  const instance = await browser();
  try {
    const context = await instance.newContext({
      javaScriptEnabled: false,
      acceptDownloads: false,
      // Keep media queries and viewport-dependent paint identical across all windows.
      viewport: { width: 2560, height: 2560 },
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(),
      result = [];
    for (const request of requests) {
      const width = Math.max(
          1,
          Math.ceil(request.bounds.width * request.scale),
        ),
        height = Math.max(1, Math.ceil(request.bounds.height * request.scale));
      if (width > 2560 || height > 2560)
        throw new Error(
          "Request a smaller crop; each image is limited to 2560 pixels per side.",
        );
      await page.goto(pathToFileURL(htmlPath).href, {
        waitUntil: "load",
        timeout: 30000,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((img) =>
            img.decode().catch(() => undefined),
          ),
        );
      });
      await page.evaluate(
        ({ bounds, scale }) => {
          const scene = document.getElementById("board-scene")!;
          scene.style.transform = `translate(${-bounds.x * scale}px,${-bounds.y * scale}px) scale(${scale})`;
          scene.style.transformOrigin = "0 0";
        },
        { bounds: request.bounds, scale: request.scale },
      );
      const png = await page.screenshot({
        animations: "disabled",
        clip: { x: 0, y: 0, width, height },
      });
      result.push({
        key: request.key,
        png,
        width,
        height,
        bounds: request.bounds,
        scale: request.scale,
      });
    }
    return result;
  } finally {
    await instance.close();
  }
}
