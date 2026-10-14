import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findViewerTemplate, readerFileExists } from "./reader-template";

export type ReaderMode = "bundled" | "cdn";

/** Public CDNs that serve npm packages; conversation hosts commonly allow them. */
// ShowAI's own source first (Cloudflare, copied from the same npm release),
// then the public npm CDNs as backups.
const DEFAULT_SOURCES = [
  "https://reader.showai.renaissancemind.ai/{name}@{version}/",
  "https://cdn.jsdelivr.net/npm/{name}@{version}/",
  "https://unpkg.com/{name}@{version}/",
];

interface CdnManifest {
  format: "showai-cdn-reader";
  name: string;
  version: string;
  entry: string;
}

async function findManifest() {
  const directory = dirname(fileURLToPath(import.meta.url));
  const viewer = await findViewerTemplate().catch(() => undefined);
  const candidates = [
    ...(process.env.SHOWAI_CDN_MANIFEST
      ? [resolve(process.env.SHOWAI_CDN_MANIFEST)]
      : []),
    // Packaged runtimes keep it next to the bundled viewer.
    ...(viewer ? [join(dirname(viewer), "cdn-manifest.json")] : []),
    resolve(directory, "../dist-cdn/manifest.json"),
    resolve(directory, "../../dist-cdn/manifest.json"),
  ];
  for (const path of candidates) if (await readerFileExists(path)) return path;
  return undefined;
}

/**
 * Entry URLs of the CDN reader this runtime was built with, in loader order,
 * or undefined when no CDN build is available or SHOWAI_READER_CDN=off.
 * SHOWAI_READER_CDN may also list base URLs, comma-separated, with {name} and
 * {version} placeholders, for example a mirror reachable from mainland China.
 */
export async function cdnReaderUrls(): Promise<string[] | undefined> {
  const setting = process.env.SHOWAI_READER_CDN?.trim();
  if (setting === "off") return undefined;
  const path = await findManifest();
  if (!path) return undefined;
  const manifest = JSON.parse(await readFile(path, "utf8")) as CdnManifest;
  if (
    manifest.format !== "showai-cdn-reader" ||
    !/^[a-z0-9@/._-]+$/.test(manifest.name) ||
    !/^[\w.+-]+$/.test(manifest.version) ||
    !/^(?:[\w-]+\/)*[\w-]+\.js$/.test(manifest.entry)
  )
    throw new Error(`Invalid CDN reader manifest: ${path}`);
  const sources = setting
    ? setting
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_SOURCES;
  return sources.map(
    (source) =>
      new URL(
        manifest.entry,
        source
          .replaceAll("{name}", manifest.name)
          .replaceAll("{version}", manifest.version)
          .replace(/\/?$/, "/"),
      ).href,
  );
}

/** Script origins a host must allow for these reader URLs. */
export function cdnReaderOrigins(urls: string[] = []) {
  return [...new Set(urls.map((url) => new URL(url).origin))];
}

/**
 * Carries only the page data: a CDN page or fragment imports its reader, so
 * explicit online exports do not need to build a bundled reader.
 */
export const CDN_PAGE_TEMPLATE = `<!doctype html><html lang="zh-CN"><head><title>ShowAI document</title></head><body><script id="showai-data" type="application/json">null</script></body></html>`;

/**
 * Chooses the initial reader for an export. Conversation previews start with
 * the local bundle and may use a CDN if the compressed fragment is oversized.
 * Explicit online pages use the CDN; site exports share bundled assets.
 */
export async function chooseReader(
  format: "html" | "inline" | "site",
  requested?: ReaderMode,
): Promise<{ mode: ReaderMode; urls?: string[] }> {
  if (requested !== undefined && !["bundled", "cdn"].includes(requested))
    throw new Error("Choose the bundled or cdn reader.");
  if (format === "site") {
    if (requested === "cdn")
      throw new Error(
        "Site exports bundle their reader; choose html or inline for the CDN reader.",
      );
    return { mode: "bundled" };
  }
  if (requested === "bundled") return { mode: "bundled" };
  const urls = await cdnReaderUrls();
  if (requested === "cdn" && !urls)
    throw new Error(
      "The CDN reader is unavailable. Build it with npm run build:cdn, or unset SHOWAI_READER_CDN=off.",
    );
  return urls && requested === "cdn"
    ? { mode: "cdn", urls }
    : { mode: "bundled" };
}
