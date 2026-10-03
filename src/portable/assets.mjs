import {
  isSafeUrl,
  MAX_ARTIFACT_BYTES,
  validateDocument,
} from "./validation.mjs";

/** Built-in blocks declare every resource that has to be embedded for offline viewing. */
function imageSlots(document) {
  const slots = [];
  const visit = (node) => {
    if (node.type === "image" && node.attrs?.src)
      slots.push([node.attrs, "src"]);
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
    node.content?.forEach(visit);
  };
  visit(document.content);
  return slots;
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
  const urls = externalImageUrls(document);
  if (urls.length)
    throw new Error(
      `Cannot create an offline document: ${urls.length} image URL(s) need embedding. Use embedded raster data URIs, or export HTML from the ShowAI browser application while online.`,
    );
}

async function imageDataUrl(url) {
  if (!isSafeUrl(url, true)) throw new Error(`Unsupported image URL: ${url}`);
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
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(mime))
    throw new Error(
      "Offline export supports PNG, JPEG, GIF, WebP, and AVIF images. Upload a supported image file and try again.",
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
  for (const [object, key] of imageSlots(copy)) {
    const url = object[key];
    if (url.startsWith("data:")) continue;
    if (!downloaded.has(url)) {
      try {
        downloaded.set(url, await imageDataUrl(url));
      } catch (error) {
        throw new Error(
          `无法嵌入图片，离线导出已停止。请将图片下载后重新上传。${error instanceof Error ? ` ${error.message}` : ""}`,
        );
      }
    }
    object[key] = downloaded.get(url);
  }
  return validateDocument(copy);
}
