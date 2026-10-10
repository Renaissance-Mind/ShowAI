import { marked } from "marked";
import { resourceMime } from "../components/blocks/research-contract.mjs";
import { isImageIcon } from "../lib/page-icon.mjs";
import {
  isSafeUrl,
  MAX_ARTIFACT_BYTES,
  validateDocument,
} from "./validation.mjs";

/** Built-in blocks declare every resource that has to be embedded for offline viewing. */
function imageSlots(document) {
  const slots = [];
  if (isImageIcon(document.icon)) slots.push([document, "icon"]);
  const visit = (node) => {
    if (node.type === "surface" && isImageIcon(node.attrs?.icon))
      slots.push([node.attrs, "icon"]);
    if (node.type === "image" && node.attrs?.src)
      slots.push([node.attrs, "src"]);
    if (
      node.type === "widget" &&
      node.attrs?.kind === "image" &&
      node.attrs.data?.src
    )
      slots.push([node.attrs.data, "src"]);
    if (
      node.type === "widget" &&
      ["text", "callout", "toggle"].includes(node.attrs?.kind) &&
      typeof node.attrs.data?.content === "string" &&
      node.attrs.data?.format !== "plain"
    ) {
      const data = node.attrs.data;
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
        slots.push([slot, "src"]);
      });
    }
    if (node.type === "widget" && node.attrs?.kind === "gallery") {
      for (const item of node.attrs.data?.images ?? [])
        if (item?.src) slots.push([item, "src"]);
    }
    if (
      node.type === "widget" &&
      node.attrs?.kind === "bookmark" &&
      node.attrs.data?.image
    )
      slots.push([node.attrs.data, "image"]);
    if (
      node.type === "widget" &&
      node.attrs?.kind === "video" &&
      node.attrs.data?.poster
    )
      slots.push([node.attrs.data, "poster"]);
    if (
      node.type === "widget" &&
      node.attrs?.kind === "text" &&
      node.attrs.data?.content &&
      typeof node.attrs.data.content === "object"
    )
      visit(node.attrs.data.content);
    node.content?.forEach(visit);
  };
  visit(document.content);
  return slots;
}

function fileSlots(document) {
  const slots = [];
  const visit = (node) => {
    if (
      node.type === "widget" &&
      ["video", "audio", "pdf"].includes(node.attrs?.kind) &&
      node.attrs.data?.src
    )
      slots.push([node.attrs.data, "src", node.attrs.kind]);
    if (
      node.type === "widget" &&
      node.attrs?.kind === "text" &&
      node.attrs.data?.content &&
      typeof node.attrs.data.content === "object"
    )
      visit(node.attrs.data.content);
    node.content?.forEach(visit);
  };
  visit(document.content);
  return slots;
}
export function externalResourceUrls(document) {
  return [
    ...new Set([
      ...externalImageUrls(document),
      ...fileSlots(document)
        .map(([object, key]) => object[key])
        .filter((url) => !url.startsWith("data:")),
    ]),
  ];
}

export function externalImageUrls(document) {
  return [
    ...new Set(
      imageSlots(document)
        .map(([object, key]) => object[key])
        .filter((url) => !url.startsWith("data:")),
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

async function resourceDataUrl(url, kind = "image") {
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
  if (declaredLength > MAX_ARTIFACT_BYTES)
    throw new Error("An image exceeds the 10 MB document limit.");
  if (!response.body) throw new Error("Image download returned no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_ARTIFACT_BYTES) {
      await reader.cancel();
      throw new Error("An image exceeds the 10 MB document limit.");
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
    const cacheKey = `${kind}:${url}`;
    if (!downloaded.has(cacheKey)) {
      try {
        downloaded.set(cacheKey, await resourceDataUrl(url, kind));
      } catch (error) {
        throw new Error(
          `无法嵌入${kind === "image" ? "图片" : "文件"}，离线导出已停止。请将文件下载后重新上传。${error instanceof Error ? ` ${error.message}` : ""}`,
        );
      }
    }
    object[key] = downloaded.get(cacheKey);
  }
  return validateDocument(copy);
}
