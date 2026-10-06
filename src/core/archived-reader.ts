import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { version as appVersion } from "../../package.json";
import {
  buildReaderTemplate,
  findViewerTemplate,
  readerFileExists,
} from "./reader-template";
import { readerKinds } from "../portable/reader-bundle.mjs";
import { CoreError } from "./model";
import type { ShowDocument } from "../types";
import type { FileChanges } from "./history-model";

export interface ReaderBinding {
  format: "showai-page-reader";
  version: 1;
  integrity: string;
  origin: "captured" | "import-time";
}
export interface ReaderManifest {
  format: "showai-archived-reader";
  version: 1;
  integrity: string;
  htmlHash: string;
  htmlBytes: number;
  appVersion: string;
  sourceArchiveHash: string | null;
  kinds: string[];
}
type Read = (path: string) => Promise<Buffer>;
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
export function readerBindingPath(pagePath: string) {
  if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(pagePath))
    return `${pagePath.slice(0, -5)}/reader.json`;
  if (/^imports\/[a-f0-9-]{36}\/snapshots\/[a-f0-9]{64}\.json$/.test(pagePath))
    return `${pagePath.slice(0, -5)}.reader.json`;
  throw new CoreError(
    "INVALID_PATH",
    "A reader binding requires a page or an imported snapshot.",
  );
}
export function parseReaderBinding(bytes: Buffer): ReaderBinding {
  const value = JSON.parse(bytes.toString("utf8")) as ReaderBinding;
  if (
    value.format !== "showai-page-reader" ||
    value.version !== 1 ||
    !digestPattern.test(value.integrity) ||
    !["captured", "import-time"].includes(value.origin)
  )
    throw new CoreError(
      "INVALID_DATA",
      "Invalid archived page reader binding.",
    );
  return value;
}
function root(ref: ReaderBinding) {
  return `runtimes/readers/${ref.integrity}`;
}
function validateTemplate(html: string) {
  if (
    !html.includes('id="showai-data"') ||
    /<script\b[^>]*\bsrc=["']/i.test(html) ||
    /<link\b[^>]*\brel=["']stylesheet/i.test(html)
  )
    throw new CoreError(
      "INVALID_DATA",
      "The captured reader must contain its JavaScript, stylesheet and artifact slot.",
    );
}
const prepared = new Map<
  string,
  Promise<{ ref: ReaderBinding; files: FileChanges }>
>();
export async function captureReader(
  document: ShowDocument,
  origin: ReaderBinding["origin"] = "captured",
) {
  const viewer = await findViewerTemplate(),
    archive = join(dirname(viewer), "reader-source.json");
  const sourceArchiveHash = (await readerFileExists(archive))
    ? hash(await readFile(archive))
    : null;
  // Dependencies are frozen in the emitted HTML; even a prebuilt viewer is fingerprinted.
  const fullHash = sourceArchiveHash ?? hash(await readFile(viewer));
  const kinds = readerKinds([document]),
    key = JSON.stringify([fullHash, kinds, appVersion]);
  let job = prepared.get(key);
  if (!job) {
    job = (async () => {
      const html = await buildReaderTemplate([document]);
      validateTemplate(html);
      const payload = {
        format: "showai-archived-reader" as const,
        version: 1 as const,
        htmlHash: hash(html),
        htmlBytes: Buffer.byteLength(html),
        appVersion,
        sourceArchiveHash,
        kinds,
      };
      const integrity = hash(JSON.stringify(payload)),
        manifest: ReaderManifest = { ...payload, integrity };
      const ref: ReaderBinding = {
        format: "showai-page-reader",
        version: 1,
        integrity,
        origin: "captured",
      };
      return {
        ref,
        files: new Map<string, Buffer | null>([
          [`${root(ref)}/viewer.html`, Buffer.from(html)],
          [`${root(ref)}/manifest.json`, Buffer.from(JSON.stringify(manifest))],
        ]),
      };
    })();
    prepared.set(key, job);
    job.catch(() => prepared.delete(key));
    if (prepared.size > 16) prepared.delete(prepared.keys().next().value!);
  }
  const value = await job;
  return { ref: { ...value.ref, origin }, files: new Map(value.files) };
}
export async function stageReader(
  changes: FileChanges,
  pagePath: string,
  document: ShowDocument,
  origin: ReaderBinding["origin"] = "captured",
) {
  const captured = await captureReader(document, origin);
  for (const [path, bytes] of captured.files) changes.set(path, bytes);
  changes.set(
    readerBindingPath(pagePath),
    Buffer.from(JSON.stringify(captured.ref)),
  );
  return captured.ref;
}
export async function readArchivedReader(pagePath: string, read: Read) {
  const refPath = readerBindingPath(pagePath),
    refBytes = await read(refPath),
    ref = parseReaderBinding(refBytes);
  const manifestPath = `${root(ref)}/manifest.json`,
    htmlPath = `${root(ref)}/viewer.html`;
  const [manifestBytes, htmlBytes] = await Promise.all([
    read(manifestPath),
    read(htmlPath),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as ReaderManifest,
    { integrity, ...payload } = manifest;
  if (
    manifest.format !== "showai-archived-reader" ||
    manifest.version !== 1 ||
    integrity !== ref.integrity ||
    hash(JSON.stringify(payload)) !== integrity ||
    manifest.htmlHash !== hash(htmlBytes) ||
    manifest.htmlBytes !== htmlBytes.length ||
    !Array.isArray(manifest.kinds) ||
    manifest.kinds.some((kind) => typeof kind !== "string")
  )
    throw new CoreError(
      "INVALID_DATA",
      "The archived reader differs from its fingerprint.",
    );
  const html = htmlBytes.toString("utf8");
  validateTemplate(html);
  return {
    ref,
    manifest,
    html,
    files: new Map([
      [refPath, refBytes],
      [manifestPath, manifestBytes],
      [htmlPath, htmlBytes],
    ]),
  };
}
export async function completePageReaders(changes: FileChanges, read: Read) {
  for (const [pagePath, bytes] of [...changes]) {
    if (!/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(pagePath)) continue;
    const refPath = readerBindingPath(pagePath);
    if (bytes === null) {
      changes.set(refPath, null);
      continue;
    }
    const artifact = JSON.parse(bytes.toString("utf8"));
    if (!artifact.document?.content)
      throw new CoreError(
        "INVALID_DATA",
        "Reader capture requires a page document.",
      );
    if (changes.has(refPath)) {
      const reader = await readArchivedReader(pagePath, async (path) => {
        const staged = changes.get(path);
        if (staged === null)
          throw new CoreError(
            "INVALID_DATA",
            "The staged page reader was deleted.",
          );
        return staged ?? read(path);
      });
      if (
        readerKinds([artifact.document]).some(
          (kind) => !reader.manifest.kinds.includes(kind),
        )
      )
        throw new CoreError(
          "INVALID_DATA",
          "The selected archived reader does not contain every page component kind.",
        );
    } else await stageReader(changes, pagePath, artifact.document);
  }
}
