// Resources a page refers to outside itself: files on this device (file:
// references) and web addresses. Reading reports them for packaging plans;
// copies that leave the device (exports, rendered reads) carry each local
// file either embedded or as its name only.

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { CoreError } from "./model";
import { CAPACITY, CapacityError, measureContent } from "../portable/capacity.mjs";
import { resourceSlots, type ResourceSlot } from "../portable/assets.mjs";
import {
  detachedRef,
  isDetachedRef,
  isLocalFileRef,
  localRefName,
  localRefType,
  type LocalResourceKind,
} from "../portable/local-files.mjs";
import type { ShowDocument } from "../types";

/** Absolute local path of a `file:` reference, an absolute path or `~/…`. */
export function localFilePath(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 4096)
    throw new CoreError("INVALID_PATH", "Choose a local file.");
  let path = value;
  if (/^file:/i.test(path)) {
    path = path.replace(/^file:(\/\/(localhost)?)?/i, "");
    try {
      path = decodeURIComponent(path);
    } catch {
      throw new CoreError("INVALID_PATH", "The file link is not valid.");
    }
    // file:///C:/dir names the drive path C:/dir on Windows.
    if (process.platform === "win32" && /^\/[a-z]:\//i.test(path))
      path = path.slice(1);
  }
  if (path === "~" || path.startsWith("~/"))
    path = join(homedir(), path.slice(1));
  if (!isAbsolute(path) || path.includes("\0"))
    throw new CoreError(
      "INVALID_PATH",
      "Local file links need an absolute path or a path under ~/.",
    );
  return normalize(path);
}

/** Where a reference is used: the block and the field inside it. */
export interface ResourceUse {
  blockId?: string;
  field: string;
}

/** One referenced resource of a page, listed once however often it is used. */
export interface ResourceRead {
  /** The reference as the page stores it, and the id of a packaging item. */
  id: string;
  source: "file" | "url";
  kind: LocalResourceKind;
  name: string;
  /** Local files: the path on this device; absent for name-only references. */
  path?: string;
  /** Local files: the file size when it is available. */
  bytes?: number;
  /** Local files: whether this device can read the file now. */
  available?: boolean;
  uses: ResourceUse[];
}

const webName = (url: string) => {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").at(-1) || parsed.host);
  } catch {
    return url;
  }
};

async function fileState(ref: string) {
  if (isDetachedRef(ref)) return { available: false };
  const path = localFilePath(ref);
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code ?? ""))
      return undefined;
    throw error;
  });
  return info?.isFile()
    ? { path, bytes: info.size, available: true }
    : { path, available: false };
}

/**
 * The local files and web addresses a page refers to, with sizes and
 * availability of local files on this device. Embedded data is part of the
 * page and is not listed. `components` includes local references inside
 * custom component props.
 */
export async function describeResources(
  document: ShowDocument,
  options: { components?: boolean } = { components: true },
): Promise<ResourceRead[]> {
  const items = new Map<string, ResourceRead>();
  for (const slot of resourceSlots(document, options)) {
    const ref = slot.object[slot.key];
    if (typeof ref !== "string" || ref.startsWith("data:")) continue;
    const use = {
      ...(slot.blockId ? { blockId: slot.blockId } : {}),
      field: slot.field,
    };
    const known = items.get(ref);
    if (known) {
      known.uses.push(use);
      continue;
    }
    const local = isLocalFileRef(ref);
    if (local)
      items.set(ref, {
        id: ref,
        source: "file",
        kind: localRefType(ref)?.kind ?? slot.kind,
        name: localRefName(ref),
        ...(await fileState(ref)),
        uses: [use],
      });
    else
      items.set(ref, {
        id: ref,
        source: "url",
        kind: slot.kind,
        name: webName(ref),
        uses: [use],
      });
  }
  return [...items.values()];
}

/** What a copy of the page carries for one local file. */
export type LocalResourceChoice = "embed" | "skip";
export type LocalResourceDecisions = Record<string, LocalResourceChoice>;

export interface LocalResourcePlanItem {
  id: string;
  kind: LocalResourceKind;
  name: string;
  bytes?: number;
  available: boolean;
  choice: LocalResourceChoice;
}

/**
 * The default for each local file of a copy: embed what is available and
 * fits the resource budget (one file, and the page with what it already
 * embeds), otherwise keep the file name only.
 */
export function defaultLocalResourceDecisions(
  document: ShowDocument,
  resources: ResourceRead[],
): LocalResourceDecisions {
  let total = measureContent(document).resourceBytes;
  const decisions: LocalResourceDecisions = {};
  for (const item of resources) {
    if (item.source !== "file") continue;
    const bytes = item.bytes ?? 0;
    const fits =
      item.available &&
      bytes <= CAPACITY.resourceBytes &&
      total + bytes <= CAPACITY.pageResourceBytes;
    decisions[item.id] = fits ? "embed" : "skip";
    if (fits) total += bytes;
  }
  return decisions;
}

/**
 * A copy of a document for a reader without this device: each local file in
 * a built-in resource field becomes embedded data or a name-only reference,
 * following `decisions` and the default for files they leave out. Custom
 * component props keep their references; those components show the file as
 * unavailable. Web addresses stay as they are.
 */
export async function withLocalResources(
  document: ShowDocument,
  decisions: LocalResourceDecisions = {},
  options: {
    /**
     * Files read from elsewhere than their reference: the synchronized copy
     * of a file another device shared (see dataset-bundles).
     */
    paths?: Record<string, string>;
  } = {},
): Promise<{ document: ShowDocument; resources: LocalResourcePlanItem[] }> {
  const copy = structuredClone(document);
  const resources = (await describeResources(copy, { components: false }))
    .filter((item) => item.source === "file")
    .map((item) => {
      const path = options.paths?.[item.id];
      return path ? { ...item, path, available: true } : item;
    });
  if (!resources.length) return { document: copy, resources: [] };
  const choices = {
    ...defaultLocalResourceDecisions(copy, resources),
    ...decisions,
  };
  const embedded = new Map<string, string>();
  for (const item of resources) {
    if (choices[item.id] !== "embed") continue;
    if (!item.available || !item.path)
      throw new CoreError(
        "NOT_FOUND",
        `${item.name} cannot be embedded: the file is not available on this device.`,
      );
    if ((item.bytes ?? 0) > CAPACITY.resourceBytes)
      throw new CapacityError(
        `Local file ${item.name}`,
        item.bytes ?? 0,
        CAPACITY.resourceBytes,
      );
    const mime = localRefType(item.id)!.mime;
    embedded.set(
      item.id,
      `data:${mime};base64,${(await readFile(item.path)).toString("base64")}`,
    );
  }
  for (const slot of resourceSlots(copy) as ResourceSlot[]) {
    const ref = slot.object[slot.key];
    if (typeof ref !== "string" || !isLocalFileRef(ref)) continue;
    slot.object[slot.key] = embedded.get(ref) ?? detachedRef(ref);
  }
  return {
    document: copy,
    resources: resources.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      ...(item.bytes !== undefined ? { bytes: item.bytes } : {}),
      available: !!item.available,
      choice: embedded.has(item.id) ? "embed" : "skip",
    })),
  };
}
