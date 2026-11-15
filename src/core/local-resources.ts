import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { CoreError } from "./model";
import { CAPACITY, CapacityError, measureContent } from "../portable/capacity.mjs";
import {
  componentFileSlots,
  resourceSlots,
  type ResourceSlot,
} from "../portable/assets.mjs";
import {
  detachedRef,
  isDetachedRef,
  isLocalFileRef,
  localRefName,
  localRefType,
  type LocalResourceKind,
} from "../document/local-files.mjs";
import type { ShowDocument } from "../types";

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

export interface ResourceUse {
  blockId?: string;
  field: string;
}

export interface ResourceRead {
  id: string;
  source: "file" | "url";
  kind: LocalResourceKind;
  name: string;
  path?: string;
  bytes?: number;
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

export async function withLocalResources(
  document: ShowDocument,
  decisions: LocalResourceDecisions = {},
  options: {
    paths?: Record<string, string>;
  } = {},
): Promise<{ document: ShowDocument; resources: LocalResourcePlanItem[] }> {
  const copy = structuredClone(document);
  for (const slot of componentFileSlots(copy)) {
    const ref = slot.object[slot.key] as string;
    if (!localRefType(ref) && !isDetachedRef(ref))
      slot.object[slot.key] = detachedRef(ref);
  }
  const resources = (await describeResources(copy))
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
  for (const slot of resourceSlots(copy, {
    components: true,
  }) as ResourceSlot[]) {
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
