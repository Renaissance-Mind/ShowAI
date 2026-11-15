import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { CAPACITY } from "../portable/capacity.mjs";
import { readBinding } from "../datasets/binding.mjs";
import { walk } from "../document/walk.mjs";
import { resourceDataUrl, resourceSlots } from "../portable/assets.mjs";
import {
  DatasetStore,
  transformInput,
  type DatasetDocument,
} from "./datasets";
import {
  BundleAgreements,
  bundlePath,
  fileHash,
  hasBundle,
  readPackaging,
  resourceBundleKey,
  storeBundle,
  validatePackaging,
  writePackaging,
} from "./dataset-bundles";
import {
  sourceFileName,
  withDataNotices,
  type BindingRead,
  type DataNotice,
} from "./dataset-resolution";
import {
  describeResources,
  withLocalResources,
  type LocalResourceDecisions,
  type LocalResourcePlanItem,
  type ResourceRead,
} from "./local-resources";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { CoreError } from "./model";
import type { FileStore } from "./store";
import type { ShowDocument } from "./model";

export type PackagingKind =
  | "file-dataset"
  | "url-dataset"
  | "transform-output"
  | "file-resource"
  | "url-resource";
export type PackagingChoice =
  | "bundle"
  | "skip"
  | "keep-url"
  | "result"
  | "inputs"
  | "both"
  | "embed";
export type PackagingDecisions = Record<string, PackagingChoice>;
export const PACKAGING_CHOICES: readonly PackagingChoice[] = [
  "bundle",
  "skip",
  "keep-url",
  "result",
  "inputs",
  "both",
  "embed",
];
export type PackagingPurpose = "export" | "sync";
export type PackagingFormat = "html" | "inline" | "site" | "json";

export interface PackagingBlock {
  pageId: string;
  blockId: string;
}
export interface PackagingInput {
  name: string;
  projectId: string;
  datasetId: string;
  kind: "library" | "file" | "url" | "transform";
  bytes: number | null;
  available: boolean;
}
export interface PackagingItem {
  id: string;
  kind: PackagingKind;
  name: string;
  projectId?: string;
  datasetId?: string;
  format?: string;
  path?: string;
  url?: string;
  bytes: number | null;
  estimated?: boolean;
  fileBytes?: number;
  inputBytes?: number;
  inputs?: PackagingInput[];
  choices: PackagingChoice[];
  defaultChoice: PackagingChoice;
  choice: PackagingChoice;
  blocks: PackagingBlock[];
  available: boolean;
  bundled?: boolean;
  tooLarge?: boolean;
  local: boolean;
  problem?: string;
}
export interface PackagingPlan {
  purpose: PackagingPurpose;
  projectId: string;
  items: PackagingItem[];
  bytes: number;
  limits: { itemBytes: number; totalBytes: number };
  remainingBytes: number;
  overLimit: boolean;
  confirm: boolean;
}

const CARRYING = new Set<PackagingChoice>([
  "bundle",
  "embed",
  "result",
  "inputs",
  "both",
]);

export function choiceBytes(item: PackagingItem, choice: PackagingChoice) {
  const own = item.bytes ?? 0;
  if (choice === "bundle" || choice === "embed" || choice === "result")
    return own;
  if (choice === "inputs") return item.inputBytes ?? 0;
  if (choice === "both") return own + (item.inputBytes ?? 0);
  return 0;
}

const jsonBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value ?? null));

function settle(
  purpose: PackagingPurpose,
  projectId: string,
  drafts: (Omit<PackagingItem, "defaultChoice" | "choice"> & {
    stored?: PackagingChoice;
  })[],
  previous: PackagingDecisions = {},
  decisions?: PackagingDecisions,
): PackagingPlan {
  if (decisions) {
    const known = new Set(drafts.map((item) => item.id));
    const unknown = Object.keys(decisions).filter((id) => !known.has(id));
    if (unknown.length)
      throw new CoreError(
        "INVALID_DATA",
        `Unknown packaging item(s): ${unknown.join(", ")}. Use the ids of the plan in details.packaging.`,
      );
  }
  let total = 0;
  let embedded = 0;
  const items: PackagingItem[] = [];
  for (const { stored, ...draft } of drafts) {
    const carry = draft.choices.find((choice) => CARRYING.has(choice));
    const leave = draft.choices.find((choice) => !CARRYING.has(choice))!;
    const adds = carry ? choiceBytes(draft as PackagingItem, carry) : 0;
    const resource =
      purpose === "export" &&
      (draft.kind === "file-resource" || draft.kind === "url-resource");
    const fits =
      !!carry &&
      draft.available &&
      !draft.tooLarge &&
      total + adds <= CAPACITY.packageTotalBytes &&
      (!resource || embedded + adds <= CAPACITY.pageResourceBytes);
    const defaultChoice: PackagingChoice =
      draft.kind === "url-resource" ? "keep-url" : fits ? carry! : leave;
    let choice =
      stored && draft.choices.includes(stored)
        ? stored
        : previous[draft.id] && draft.choices.includes(previous[draft.id])
          ? previous[draft.id]
          : defaultChoice;
    const decided = decisions?.[draft.id];
    if (decided !== undefined) {
      if (!draft.choices.includes(decided))
        throw new CoreError(
          "INVALID_DATA",
          `${draft.name}: choose ${draft.choices.join(" or ")}${draft.tooLarge ? ` (it is larger than ${CAPACITY.packageItemBytes} bytes)` : !draft.available ? " (it is unavailable on this device)" : ""}.`,
        );
      choice = decided;
    }
    const item: PackagingItem = { ...draft, defaultChoice, choice };
    total += choiceBytes(item, choice);
    if (resource) embedded += choiceBytes(item, choice);
    items.push(item);
  }
  return {
    purpose,
    projectId,
    items,
    bytes: total,
    limits: {
      itemBytes: CAPACITY.packageItemBytes,
      totalBytes: CAPACITY.packageTotalBytes,
    },
    remainingBytes: CAPACITY.packageTotalBytes - total,
    overLimit: total > CAPACITY.packageTotalBytes,
    confirm: items.some((item) => item.local),
  };
}

function allowed(
  kind: PackagingKind,
  options: { available: boolean; tooLarge?: boolean; format?: PackagingFormat },
): PackagingChoice[] {
  const carry = options.available && !options.tooLarge;
  switch (kind) {
    case "file-dataset":
      return carry ? ["bundle", "skip"] : ["skip"];
    case "url-dataset":
      return carry ? ["bundle", "keep-url"] : ["keep-url"];
    case "transform-output":
      return !carry
        ? ["skip"]
        : options.format === "html" || options.format === "site"
          ? ["result", "inputs", "both", "skip"]
          : ["result", "skip"];
    case "file-resource":
      return carry ? ["embed", "skip"] : ["skip"];
    case "url-resource":
      return ["keep-url", "embed"];
  }
}


interface DatasetFacts {
  definition: DatasetDocument;
  kind: "library" | "file" | "url" | "transform";
  local: boolean;
}

class DatasetFactsCache {
  private readonly facts = new Map<string, Promise<DatasetFacts | undefined>>();
  constructor(readonly datasets: DatasetStore) {}
  get(
    projectId: string,
    datasetId: string,
    path: string[] = [],
  ): Promise<DatasetFacts | undefined> {
    const key = `${projectId}/${datasetId}`;
    if (path.includes(key)) return Promise.resolve(undefined);
    let found = this.facts.get(key);
    if (!found) {
      found = this.load(projectId, datasetId, [...path, key]);
      this.facts.set(key, found);
    }
    return found;
  }
  private async load(
    projectId: string,
    datasetId: string,
    path: string[],
  ): Promise<DatasetFacts | undefined> {
    const definition = await this.datasets
      .definition(projectId, datasetId)
      .catch((error) => {
        if (error instanceof CoreError && error.code === "NOT_FOUND")
          return undefined;
        throw error;
      });
    if (!definition) return undefined;
    if (definition.transform) {
      let local = false;
      for (const reference of Object.values(definition.transform.inputs)) {
        const input = transformInput(reference, projectId);
        local ||=
          (await this.get(input.projectId, input.datasetId, path))?.local ??
          false;
      }
      return { definition, kind: "transform" as const, local };
    }
    const kind = definition.source?.kind ?? "library";
    return { definition, kind, local: kind === "file" };
  }
}

function boundBlocks(
  pages: { pageId: string; document: ShowDocument; blockIds?: string[] }[],
  projectId: string,
) {
  const blocks = new Map<string, PackagingBlock[]>();
  for (const page of pages)
    walk(page.document.content, (node) => {
      if (node.type !== "widget") return;
      const binding = readBinding(node.attrs?.data);
      const blockId = node.attrs?.id;
      if (!binding || typeof blockId !== "string") return;
      if (page.blockIds && !page.blockIds.includes(blockId)) return;
      const key = `${binding.project ?? projectId}/${binding.dataset}`;
      blocks.set(key, [...(blocks.get(key) ?? []), { pageId: page.pageId, blockId }]);
    }, { scope: "content" });
  return blocks;
}


async function remoteSize(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      credentials: "omit",
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    const length = Number(response.headers.get("content-length"));
    return response.ok && Number.isSafeInteger(length) && length >= 0
      ? length
      : null;
  } catch {
    return null;
  }
}

export async function bundledResource(
  store: FileStore,
  ref: string,
  projectIds?: string[],
): Promise<{ path: string; bytes: number } | undefined> {
  const projects =
    projectIds ??
    (await store.listProjects({ includeArchived: true })).map(
      (project) => project.id,
    );
  for (const projectId of projects) {
    const entry = (await readPackaging(store, projectId)).resources[ref];
    if (entry?.sync && entry.hash && (await hasBundle(store.root, entry.hash)))
      return {
        path: bundlePath(store.root, entry.hash),
        bytes: entry.bytes ?? (await stat(bundlePath(store.root, entry.hash))).size,
      };
  }
  return undefined;
}

function resourceDraft(
  item: ResourceRead,
  pageId: string,
  options: {
    bundled?: { path: string; bytes: number };
    size?: number | null;
    format?: PackagingFormat;
    purpose: PackagingPurpose;
    stored?: PackagingChoice;
  },
) {
  const local = item.source === "file";
  const available = local ? !!item.available || !!options.bundled : true;
  const bytes = local
    ? (item.bytes ?? options.bundled?.bytes ?? null)
    : (options.size ?? null);
  const limit =
    options.purpose === "export"
      ? Math.min(CAPACITY.resourceBytes, CAPACITY.packageItemBytes)
      : CAPACITY.packageItemBytes;
  const tooLarge = bytes !== null && bytes > limit;
  const kind: PackagingKind = local ? "file-resource" : "url-resource";
  const choices =
    options.purpose === "sync"
      ? available && !tooLarge
        ? (["bundle", "skip"] as PackagingChoice[])
        : (["skip"] as PackagingChoice[])
      : kind === "url-resource" && tooLarge
        ? (["keep-url"] as PackagingChoice[])
        : allowed(kind, { available, tooLarge });
  return {
    id: item.id,
    kind,
    name: item.name,
    ...(local && item.path && item.available ? { path: item.path } : {}),
    ...(local ? {} : { url: item.id }),
    bytes,
    ...(!local && bytes !== null ? { estimated: true } : {}),
    choices,
    blocks: item.uses
      .filter((use) => use.blockId)
      .map((use) => ({ pageId, blockId: use.blockId! })),
    available,
    ...(local && !item.available && options.bundled ? { bundled: true } : {}),
    ...(tooLarge ? { tooLarge: true } : {}),
    local,
    ...(!available
      ? { problem: `${item.name} is not available on this device.` }
      : {}),
    ...(options.stored ? { stored: options.stored } : {}),
  };
}


export interface ExportPagePlanInput {
  pageId: string;
  document: ShowDocument;
  bindings: BindingRead[];
  blockIds?: string[];
  shown: ShowDocument;
}

export async function exportPackagingPlan(
  store: FileStore,
  input: {
    projectId: string;
    pages: ExportPagePlanInput[];
    format: PackagingFormat;
    decisions?: PackagingDecisions;
    previous?: PackagingDecisions;
  },
): Promise<PackagingPlan> {
  const datasets = new DatasetStore(store);
  const facts = new DatasetFactsCache(datasets);
  const drafts: Parameters<typeof settle>[2] = [];
  const byId = new Map<string, (typeof drafts)[number]>();
  for (const page of input.pages)
    for (const binding of page.bindings) {
      if (page.blockIds && !page.blockIds.includes(binding.blockId)) continue;
      const id = `dataset:${binding.projectId}/${binding.datasetId}`;
      const block = { pageId: page.pageId, blockId: binding.blockId };
      const known = byId.get(id);
      if (known) {
        known.blocks.push(block);
        known.bytes = (known.bytes ?? 0) + (binding.snapshotBytes ?? 0);
        continue;
      }
      const fact = await facts.get(binding.projectId, binding.datasetId);
      if (!fact || fact.kind === "library") continue;
      const available = binding.status !== "empty";
      const kind: PackagingKind =
        fact.kind === "transform"
          ? "transform-output"
          : fact.kind === "file"
            ? "file-dataset"
            : "url-dataset";
      const bytes = available ? (binding.snapshotBytes ?? 0) : null;
      const draft: (typeof drafts)[number] = {
        id,
        kind,
        name: binding.name ?? fact.definition.name,
        projectId: binding.projectId,
        datasetId: binding.datasetId,
        ...(fact.definition.source
          ? { format: fact.definition.source.format }
          : {}),
        ...(binding.source?.path ? { path: binding.source.path } : {}),
        ...(binding.source?.url ? { url: binding.source.url } : {}),
        bytes,
        ...(binding.source?.bytes !== undefined
          ? { fileBytes: binding.source.bytes }
          : {}),
        choices: allowed(kind, {
          available,
          tooLarge: (bytes ?? 0) > CAPACITY.packageItemBytes,
          format: input.format,
        }),
        blocks: [block],
        available,
        ...(binding.source?.bundled ? { bundled: true } : {}),
        ...((bytes ?? 0) > CAPACITY.packageItemBytes ? { tooLarge: true } : {}),
        local: fact.local,
        ...(!available
          ? {
              problem:
                binding.warnings[0]?.message ?? binding.error ?? "No data.",
            }
          : {}),
      };
      if (kind === "transform-output") {
        const inputs: PackagingInput[] = [];
        for (const [name, reference] of Object.entries(
          fact.definition.transform!.inputs,
        )) {
          const target = transformInput(reference, binding.projectId);
          const inputFact = await facts.get(target.projectId, target.datasetId);
          const value = await datasets
            .read(target.projectId, target.datasetId)
            .then((record) => record.dataset.value)
            .catch((error) => {
              if (
                error instanceof CoreError &&
                ["SOURCE_UNAVAILABLE", "NOT_FOUND"].includes(error.code)
              )
                return undefined;
              throw error;
            });
          inputs.push({
            name,
            projectId: target.projectId,
            datasetId: target.datasetId,
            kind: inputFact?.kind ?? "library",
            bytes: value === undefined ? null : jsonBytes(value),
            available: value !== undefined,
          });
        }
        draft.inputs = inputs;
        draft.inputBytes = inputs.reduce(
          (sum, item) => sum + (item.bytes ?? 0),
          0,
        );
        if (inputs.some((item) => !item.available))
          draft.choices = draft.choices.filter(
            (choice) => choice !== "inputs" && choice !== "both",
          );
      }
      byId.set(id, draft);
      drafts.push(draft);
    }
  const resources = new Map<string, (typeof drafts)[number]>();
  const projectIds = [input.projectId];
  for (const page of input.pages)
    for (const item of await describeResources(page.shown)) {
      const known = resources.get(item.id);
      if (known) {
        known.blocks.push(
          ...item.uses
            .filter((use) => use.blockId)
            .map((use) => ({ pageId: page.pageId, blockId: use.blockId! })),
        );
        continue;
      }
      const draft = resourceDraft(item, page.pageId, {
        purpose: "export",
        format: input.format,
        ...(item.source === "file" && !item.available
          ? { bundled: await bundledResource(store, item.id, projectIds) }
          : {}),
        ...(item.source === "url" ? { size: await remoteSize(item.id) } : {}),
      });
      resources.set(item.id, draft);
    }
  drafts.push(...resources.values());
  return settle(
    "export",
    input.projectId,
    drafts,
    input.previous,
    input.decisions,
  );
}

export function assertPackagingConfirmed(
  plan: PackagingPlan,
  confirmed: boolean,
): void {
  if (plan.overLimit) {
    const error = new CoreError(
      "INVALID_DATA",
      `The chosen packaging carries ${plan.bytes} bytes; one export carries at most ${plan.limits.totalBytes}. Leave some items out (skip) and export again.`,
    );
    error.details = { packaging: plan };
    throw error;
  }
  if (confirmed || !plan.confirm) return;
  const local = plan.items.filter((item) => item.local);
  const listed = local
    .map(
      (item) =>
        `${item.name} (${item.kind}, ${item.bytes === null ? "size unknown" : `${item.bytes} bytes`}, default ${item.defaultChoice}${item.available ? "" : ", unavailable"})`,
    )
    .join("; ");
  const error = new CoreError(
    "CONFIRMATION_REQUIRED",
    `This export carries ${local.length} item(s) from files of this device or computed from them: ${listed}. Nothing was written. Show the person each item with its size and choices, then export again with packaging {itemId: choice} (items left out take their choice shown), or externalData "embed" to carry everything that fits.`,
  );
  error.details = { packaging: plan };
  throw error;
}

export function exportReceipt(plan: PackagingPlan) {
  return {
    bytes: plan.bytes,
    items: plan.items.map(({ path: _path, ...item }) => item),
  };
}

export interface PackagedDocument {
  document: ShowDocument;
  resources: LocalResourcePlanItem[];
  inputs: { projectId: string; datasetId: string; name: string; value: unknown }[];
}

export async function applyPackaging(
  store: FileStore,
  plan: PackagingPlan,
  page: { pageId: string; original: ShowDocument; resolved: ShowDocument },
): Promise<PackagedDocument> {
  const notices = new Map<string, DataNotice>();
  for (const item of plan.items) {
    if (
      !item.datasetId ||
      !item.available ||
      ["bundle", "result", "both"].includes(item.choice)
    )
      continue;
    const file = sourceFileName({
      ...(item.url ? { url: item.url } : {}),
      ...(item.path ? { path: item.path } : {}),
    });
    for (const block of item.blocks)
      if (block.pageId === page.pageId)
        notices.set(block.blockId, {
          status: "empty",
          omitted: true,
          dataset: item.name,
          ...(item.kind === "file-dataset" || item.kind === "url-dataset"
            ? { file: file ?? item.name }
            : {}),
        });
  }
  const shown = withDataNotices(page.resolved, page.original, notices);
  const decisions: LocalResourceDecisions = {};
  const paths: Record<string, string> = {};
  for (const item of plan.items) {
    if (item.kind !== "file-resource") continue;
    decisions[item.id] = item.choice === "embed" ? "embed" : "skip";
    if (item.bundled && item.choice === "embed") {
      const copy = await bundledResource(store, item.id, [plan.projectId]);
      if (copy) paths[item.id] = copy.path;
    }
  }
  const local = await withLocalResources(shown, decisions, { paths });
  const download = new Map(
    plan.items
      .filter((item) => item.kind === "url-resource" && item.choice === "embed")
      .map((item) => [item.id, item]),
  );
  if (download.size) {
    const embedded = new Map<string, string>();
    for (const slot of resourceSlots(local.document)) {
      const url = slot.object[slot.key];
      if (typeof url !== "string" || !download.has(url)) continue;
      if (!embedded.has(url))
        embedded.set(url, await resourceDataUrl(url, slot.kind));
      slot.object[slot.key] = embedded.get(url)!;
    }
  }
  const inputs: PackagedDocument["inputs"] = [];
  const datasets = new DatasetStore(store);
  for (const item of plan.items)
    if (
      item.kind === "transform-output" &&
      (item.choice === "inputs" || item.choice === "both") &&
      item.blocks.some((block) => block.pageId === page.pageId)
    )
      for (const target of item.inputs ?? []) {
        const record = await datasets.read(target.projectId, target.datasetId);
        inputs.push({
          projectId: target.projectId,
          datasetId: target.datasetId,
          name: record.dataset.name,
          value: record.dataset.value,
        });
      }
  return { document: local.document, resources: local.resources, inputs };
}


interface RememberedChoices {
  format: "showai-packaging-choices";
  version: 1;
  projects: Record<string, PackagingDecisions>;
}
const choicesPath = (store: FileStore) =>
  join(store.root, "local", "packaging-choices.json");

export async function previousChoices(
  store: FileStore,
  projectId: string,
): Promise<PackagingDecisions> {
  const bytes = await readLibraryBytes(store.root, choicesPath(store));
  if (!bytes) return {};
  const value = JSON.parse(bytes.toString()) as RememberedChoices;
  return value?.format === "showai-packaging-choices"
    ? (value.projects?.[projectId] ?? {})
    : {};
}

export async function rememberChoices(
  store: FileStore,
  plan: PackagingPlan,
): Promise<void> {
  const bytes = await readLibraryBytes(store.root, choicesPath(store));
  const value: RememberedChoices = bytes
    ? (JSON.parse(bytes.toString()) as RememberedChoices)
    : { format: "showai-packaging-choices", version: 1, projects: {} };
  value.projects ??= {};
  value.projects[plan.projectId] = {
    ...value.projects[plan.projectId],
    ...Object.fromEntries(plan.items.map((item) => [item.id, item.choice])),
  };
  await atomicLibraryFile(
    store.root,
    choicesPath(store),
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
  );
}


async function projectPages(store: FileStore, projectId: string) {
  const pages = [];
  for (const page of await store.listPages(projectId, {
    includeArchived: true,
  })) {
    const record = await store.readPage(projectId, page.id, {
      checkpoint: false,
    });
    pages.push({ pageId: page.id, document: record.document });
  }
  return pages;
}

async function datasetIds(store: FileStore, projectId: string) {
  const files = store.datasetFiles();
  const names = await files.names(files.directory(projectId)).catch((error) => {
    if (error instanceof CoreError && error.code === "NOT_FOUND") return [];
    throw error;
  });
  return names
    .map((name) => name.slice(0, -5))
    .filter((id) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id));
}

async function fileSize(path: string): Promise<number | undefined> {
  return stat(path).then(
    (info) => (info.isFile() ? info.size : undefined),
    () => undefined,
  );
}

export async function syncPackagingPlan(
  store: FileStore,
  projectId: string,
  decisions?: PackagingDecisions,
): Promise<PackagingPlan> {
  await store.readProject(projectId);
  const datasets = new DatasetStore(store);
  const pages = await projectPages(store, projectId);
  const blocks = boundBlocks(pages, projectId);
  const drafts: Parameters<typeof settle>[2] = [];
  for (const datasetId of await datasetIds(store, projectId)) {
    const definition = await datasets.definition(projectId, datasetId);
    const source = definition.source;
    if (source?.kind !== "file") continue;
    const linked = await datasets.links.get(projectId, datasetId);
    const size = linked ? await fileSize(linked) : undefined;
    const bundled =
      !size && source.bundle?.hash
        ? await hasBundle(store.root, source.bundle.hash)
        : false;
    const bytes = size ?? (bundled ? (source.bundle?.bytes ?? null) : null);
    const available = size !== undefined || bundled;
    const tooLarge = bytes !== null && bytes > CAPACITY.packageItemBytes;
    drafts.push({
      id: `dataset:${projectId}/${datasetId}`,
      kind: "file-dataset",
      name: definition.name,
      projectId,
      datasetId,
      format: source.format,
      ...(linked && size !== undefined ? { path: linked } : {}),
      bytes,
      choices: available && !tooLarge ? ["bundle", "skip"] : ["skip"],
      blocks: blocks.get(`${projectId}/${datasetId}`) ?? [],
      available,
      ...(bundled ? { bundled: true } : {}),
      ...(tooLarge ? { tooLarge: true } : {}),
      local: true,
      ...(!available
        ? { problem: `${source.name ?? definition.name} is not on this device.` }
        : {}),
      ...(source.bundle ? { stored: source.bundle.sync ? "bundle" : "skip" } : {}),
    });
  }
  const packaging = await readPackaging(store, projectId);
  const resources = new Map<string, (typeof drafts)[number]>();
  for (const page of pages)
    for (const item of await describeResources(page.document)) {
      if (item.source !== "file") continue;
      const known = resources.get(item.id);
      if (known) {
        known.blocks.push(
          ...item.uses
            .filter((use) => use.blockId)
            .map((use) => ({ pageId: page.pageId, blockId: use.blockId! })),
        );
        continue;
      }
      const entry = packaging.resources[item.id];
      resources.set(
        item.id,
        resourceDraft(item, page.pageId, {
          purpose: "sync",
          ...(!item.available && entry?.sync && entry.hash
            ? {
                bundled: (await hasBundle(store.root, entry.hash))
                  ? {
                      path: bundlePath(store.root, entry.hash),
                      bytes: entry.bytes ?? 0,
                    }
                  : undefined,
              }
            : {}),
          ...(entry ? { stored: entry.sync ? "bundle" : "skip" } : {}),
        }),
      );
    }
  drafts.push(...resources.values());
  return settle("sync", projectId, drafts, {}, decisions);
}

export async function setSyncPackaging(
  store: FileStore,
  projectId: string,
  decisions: PackagingDecisions,
): Promise<PackagingPlan> {
  const plan = await syncPackagingPlan(store, projectId, decisions);
  const datasets = new DatasetStore(store);
  const resources: Record<string, boolean> = {};
  for (const item of plan.items) {
    if (!(item.id in decisions)) continue;
    if (item.kind === "file-dataset")
      await datasets.setBundle(projectId, item.datasetId!, item.choice === "bundle");
    else resources[item.id] = item.choice === "bundle";
  }
  if (Object.keys(resources).length)
    await store.datasetFiles().lock(`packaging-${projectId}`, async () => {
      const packaging = await readPackaging(store, projectId);
      for (const [ref, sync] of Object.entries(resources)) {
        const current = packaging.resources[ref];
        packaging.resources[ref] = sync
          ? { ...current, sync: true }
          : { sync: false };
      }
      await writePackaging(store, projectId, packaging);
    });
  await refreshProjectBundles(store, projectId);
  return syncPackagingPlan(store, projectId);
}

export async function refreshProjectBundles(
  store: FileStore,
  projectId: string,
  options: { publish?: boolean } = {},
): Promise<{ datasets: Record<string, string>; resources: number }> {
  const publish = options.publish !== false;
  const datasets = new DatasetStore(store);
  const states: Record<string, string> = {};
  for (const datasetId of await datasetIds(store, projectId)) {
    const definition = await datasets.definition(projectId, datasetId);
    if (definition.source?.kind !== "file") continue;
    states[datasetId] = (
      await datasets.reconcileBundle(projectId, datasetId, { publish })
    ).state;
  }
  if (!publish) return { datasets: states, resources: 0 };
  const plan = await syncPackagingPlan(store, projectId);
  const agreements = new BundleAgreements(store.root);
  const updates: Record<string, { hash: string; bytes: number }> = {};
  for (const item of plan.items) {
    if (item.kind !== "file-resource" || item.choice !== "bundle" || !item.path)
      continue;
    const key = resourceBundleKey(projectId, item.id);
    const current = await fileHash(item.path);
    const entry = (await readPackaging(store, projectId)).resources[item.id];
    const agreed = await agreements.get(key);
    if (entry?.hash === current) {
      if (!(await hasBundle(store.root, current)))
        await storeBundle(store.root, await readFile(item.path));
      if (agreed?.hash !== current)
        await agreements.set(key, {
          hash: current,
          at: new Date().toISOString(),
        });
      continue;
    }
    if (entry?.hash && agreed?.hash === current) continue;
    const bytes = await readFile(item.path);
    const hash = await storeBundle(store.root, bytes);
    updates[item.id] = { hash, bytes: bytes.length };
    await agreements.set(key, { hash, at: new Date().toISOString() });
  }
  if (Object.keys(updates).length)
    await store.datasetFiles().lock(`packaging-${projectId}`, async () => {
      const packaging = await readPackaging(store, projectId);
      const now = new Date().toISOString();
      for (const [ref, update] of Object.entries(updates))
        packaging.resources[ref] = {
          sync: true,
          hash: update.hash,
          bytes: update.bytes,
          updatedAt: now,
        };
      await writePackaging(store, projectId, validatePackaging(packaging));
    });
  return { datasets: states, resources: Object.keys(updates).length };
}
