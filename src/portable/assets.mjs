import { CAPACITY, assertBytes } from "./capacity.mjs";
import { marked } from "marked";
import { resourceMime } from "../components/blocks/research-contract.mjs";
import { isImageIcon } from "../lib/page-icon.mjs";
import { isSafeUrl, validateDocument } from "./validation.mjs";
import { detachedRef, isLocalFileRef, localRefType } from "../document/local-files.mjs";
import { SKIP, walk } from "../document/walk.mjs";

/** The id of a node or of its nearest identified ancestor, across held documents. */
function nearestIds() {
  const ids = new Map();
  return (node, parent) => {
    const id =
      typeof node.attrs?.id === "string" ? node.attrs.id : ids.get(parent);
    ids.set(node, id);
    return id;
  };
}

/**
 * Every resource field of a document: page and container icons, image
 * nodes, image/gallery/bookmark/video-poster images, rich-text images, and
 * video, audio and PDF files. Each slot names its object and key so a copy
 * can be rewritten, the resource kind, and the nearest block id.
 * `components` also lists local file references inside custom component
 * props (strings naming a supported file type).
 */
export function resourceSlots(document, { components = false } = {}) {
  const slots = [];
  const add = (object, key, kind, blockId, field) =>
    slots.push({ object, key, kind, blockId, field });
  if (isImageIcon(document.icon)) add(document, "icon", "image", undefined, "icon");
  const nearest = nearestIds();
  walk(document.content, (node, { parent }) => {
    const blockId = nearest(node, parent);
    const data = node.attrs?.data;
    const widget = node.type === "widget" ? node.attrs?.kind : undefined;
    if (node.type === "surface" && isImageIcon(node.attrs?.icon))
      add(node.attrs, "icon", "image", blockId, "icon");
    if (node.type === "image" && node.attrs?.src)
      add(node.attrs, "src", "image", blockId, "src");
    if (widget === "image" && data?.src) add(data, "src", "image", blockId, "src");
    if (
      ["text", "callout", "toggle"].includes(widget) &&
      typeof data?.content === "string" &&
      data?.format !== "plain"
    ) {
      marked.walkTokens(marked.lexer(data.content ?? ""), (token) => {
        if (token.type !== "image") return;
        let src = token.href;
        const slot = {
          get src() {
            return src;
          },
          set src(value) {
            const alt = token.text.replace(/([\\[\]])/g, "\\$1");
            const image = `![${alt}](<${value}>${token.title ? " " + JSON.stringify(token.title) : ""})`;
            data.content = data.content.split(token.raw).join(image);
            src = value;
          },
        };
        add(slot, "src", "image", blockId, "content");
      });
    }
    if (widget === "gallery")
      (data?.images ?? []).forEach((item, index) => {
        if (item?.src)
          add(item, "src", "image", blockId, `images[${index}].src`);
      });
    if (widget === "bookmark" && data?.image)
      add(data, "image", "image", blockId, "image");
    if (widget === "video" && data?.poster)
      add(data, "poster", "image", blockId, "poster");
    if (["video", "audio", "pdf"].includes(widget) && data?.src)
      add(data, "src", widget, blockId, "src");
    if (components && widget === "custom" && data?.props)
      propSlots(data.props, "props", (object, key, field, kind) =>
        add(object, key, kind, blockId, field),
      );
    // Rich text in component data (text, callout and toggle bodies, stepper
    // steps) is walked; a library component's props are covered by propSlots.
    if (widget === "custom") return SKIP;
  }, { scope: "content" });
  return slots;
}

/**
 * Local file references among a custom component's props, by JSON path:
 * those naming a supported file type, or every `file:` string with `any`.
 */
function propSlots(value, path, add, depth = 0, any = false) {
  if (depth > 40 || !value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const field = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    if (typeof item === "string") {
      const type = localRefType(item);
      if ((type || any) && isLocalFileRef(item))
        add(value, key, field, type?.kind);
    } else propSlots(item, field, add, depth + 1, any);
  }
}

/**
 * Every `file:` string inside custom component props, whatever file it
 * names, with its block and JSON path. A copy for readers without this
 * device rewrites each of them, so no location on this device leaves it.
 */
export function componentFileSlots(document) {
  const slots = [];
  const nearest = nearestIds();
  walk(document.content, (node, { parent }) => {
    const blockId = nearest(node, parent);
    const data = node.attrs?.data;
    const widget = node.type === "widget" ? node.attrs?.kind : undefined;
    if (widget !== "custom") return;
    if (data?.props)
      propSlots(
        data.props,
        "props",
        (object, key, field) => slots.push({ object, key, blockId, field }),
        0,
        true,
      );
    return SKIP;
  }, { scope: "content" });
  return slots;
}

const imageSlots = (document) =>
  resourceSlots(document)
    .filter((slot) => slot.kind === "image")
    .map((slot) => [slot.object, slot.key]);
const fileSlots = (document) =>
  resourceSlots(document)
    .filter((slot) => slot.kind !== "image")
    .map((slot) => [slot.object, slot.key, slot.kind]);

/** Web addresses in resource fields; embedded data and local references are not web addresses. */
const isWebAddress = (url) => !url.startsWith("data:") && !isLocalFileRef(url);
export function externalResourceUrls(document) {
  return [
    ...new Set([
      ...externalImageUrls(document),
      ...fileSlots(document)
        .map(([object, key]) => object[key])
        .filter(isWebAddress),
    ]),
  ];
}

export function externalImageUrls(document) {
  return [
    ...new Set(
      imageSlots(document)
        .map(([object, key]) => object[key])
        .filter(isWebAddress),
    ),
  ];
}

export function assertOfflineImages(document) {
  const urls = externalResourceUrls(document);
  if (urls.length)
    throw new Error(
      `Cannot create an offline document: ${urls.length} resource URL(s) need embedding. Upload local files, use embedded data URIs, or export HTML from the ShowAI browser application while online.`,
    );
}

/** Downloads a web resource of a kind into a data: address (at most one resource budget). */
export async function resourceDataUrl(url, kind = "image") {
  if (!isSafeUrl(url, kind === "image"))
    throw new Error(`Unsupported resource URL: ${url}`);
  const response = await fetch(url, {
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Image download failed (${response.status}). Upload the image file to ShowAI and try again.`,
    );
  const mime = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    !(kind === "image"
      ? /^image\/(png|jpeg|gif|webp|avif)$/.test(mime)
      : resourceMime(kind, `data:${mime};base64,AA==`))
  )
    throw new Error(
      `Offline export requires a supported ${kind} file MIME type. Upload a local file and try again.`,
    );
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > CAPACITY.resourceBytes) {
    await response.body?.cancel();
    assertBytes(
      "Single resource download",
      declaredLength,
      CAPACITY.resourceBytes,
    );
  }
  if (!response.body) throw new Error("Image download returned no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > CAPACITY.resourceBytes) {
      await reader.cancel();
      assertBytes("Single resource download", length, CAPACITY.resourceBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  // Bounded chunks avoid apply() argument limits for larger images.
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function embedDocumentImages(document) {
  const copy = validateDocument(document);
  const downloaded = new Map();
  for (const [object, key, kind = "image"] of [
    ...imageSlots(copy),
    ...fileSlots(copy),
  ]) {
    const url = object[key];
    if (url.startsWith("data:")) continue;
    // A standalone copy cannot reach this device's files; it keeps the name.
    if (isLocalFileRef(url)) {
      object[key] = detachedRef(url);
      continue;
    }
    const cacheKey = `${kind}:${url}`;
    if (!downloaded.has(cacheKey)) {
      try {
        downloaded.set(cacheKey, await resourceDataUrl(url, kind));
      } catch (error) {
        throw new Error(
          // i18n-exempt: also loaded by plain-Node scripts without the i18n module
          `无法嵌入${kind === "image" ? "图片" : "文件"}，离线导出已停止。请将文件下载后重新上传。${error instanceof Error ? ` ${error.message}` : ""}`,
        );
      }
    }
    object[key] = downloaded.get(cacheKey);
  }
  return validateDocument(copy);
}
