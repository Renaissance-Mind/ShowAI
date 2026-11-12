import { randomUUID } from "node:crypto";
import { changeContext, withChangeContext } from "../core/history-context";
import { mutateLibrary } from "../core/library-runtime";
import { CoreError } from "../core/model";
import { CAPACITY } from "../portable/capacity.mjs";
import { LOCAL_FILE_TYPES } from "../portable/local-files.mjs";
import { pageLink } from "../portable/page-link.mjs";
import { validateDocument } from "../portable/validation.mjs";
import {
  openImportFiles,
  openImportPath,
  type OpenedInput,
} from "../core/importers/input";
import {
  availableImporters,
  chooseImporter,
  importerInfo,
} from "../core/importers/registry";
import {
  IMPORT_PLACEHOLDER,
  type ImportBundle,
  type ImportInput,
  type ImportWarning,
  type ImporterInfo,
} from "../core/importers/types";
import type { AgentService } from "./service";
import type { CompiledComponent } from "../contract/types";
import type { PublishedComponentLocator } from "../core/publication";

// The import harness: whatever importer filled the slot, the bundle it
// returns is checked, shown as a plan, and written through the normal save
// paths — folders, datasets, then one page per transaction, so every page is
// complete or absent, history and the search index see ordinary saves, and a
// failed page is reported without stopping the others.

export type ImportSource =
  { path: string } | { files: { name: string; data: string }[] };

export interface ImportTarget {
  projectId: string;
  parentId: string | null;
}

export interface ImportPlanItem {
  type: "folder" | "page" | "dataset";
  key: string;
  title: string;
  parent?: string;
  source?: string;
}

export interface ImportPlan {
  importer: ImporterInfo;
  candidates: { id: string; name: string; score: number }[];
  source: {
    name: string;
    kind: ImportInput["kind"];
    files: number;
    bytes: number;
  };
  target: ImportTarget;
  /** The folder made to hold the import, when it has more than one top item. */
  root: string | null;
  counts: {
    folders: number;
    pages: number;
    databases: number;
    resources: number;
    resourceBytes: number;
  };
  items: ImportPlanItem[];
  warnings: ImportWarning[];
}

export interface ImportProgress {
  done: number;
  total: number;
  current?: string;
}

export interface ImportReport {
  plan: ImportPlan;
  cancelled: boolean;
  created: {
    folders: number;
    pages: number;
    databases: number;
    resources: number;
  };
  /** Items that could not be written, each with its reason; the rest were saved. */
  problems: {
    type: ImportPlanItem["type"];
    key: string;
    title: string;
    source?: string;
    message: string;
  }[];
  /** The folder holding the import, if one was made. */
  folderId: string | null;
  /** Created pages by bundle key (at most 200 listed). */
  pages: { key: string; pageId: string; title: string }[];
  /** The page to open first: the only page, or the first top-level page. */
  openPageId: string | null;
  /** Deleting these moves the whole import to the trash. */
  undo: { folders: string[]; pages: string[] };
}

const MAX_PAGES = 20_000;
const MAX_KEY = 1000;
const MAX_TITLE = 500;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const title = (value: unknown, fallback: string) =>
  (typeof value === "string" && value.trim() ? value.trim() : fallback).slice(
    0,
    MAX_TITLE,
  );
const fileType = (path: string) =>
  (LOCAL_FILE_TYPES as Record<string, { mime: string; kind: string }>)[
    /\.[^./]+$/.exec(path)?.[0]?.toLowerCase() ?? ""
  ];

async function openSource(source: ImportSource): Promise<OpenedInput> {
  if ("path" in source) {
    if (
      typeof source.path !== "string" ||
      (!source.path.startsWith("/") && !/^[a-z]:[\\/]/i.test(source.path))
    )
      throw new CoreError(
        "INVALID_PATH",
        "An import source needs an absolute path.",
      );
    return openImportPath(source.path);
  }
  if (!Array.isArray(source.files) || !source.files.length)
    throw new CoreError("INVALID_DATA", "Choose at least one file to import.");
  let total = 0;
  const items = source.files.map((file) => {
    if (typeof file?.name !== "string" || typeof file.data !== "string")
      throw new CoreError(
        "INVALID_DATA",
        "Each imported file needs name and base64 data.",
      );
    const bytes = new Uint8Array(Buffer.from(file.data, "base64"));
    total += bytes.length;
    return { name: file.name, bytes };
  });
  if (total > MAX_UPLOAD_BYTES)
    throw new CoreError(
      "INVALID_DATA",
      `Dropped files hold ${total} bytes; choose files over ${MAX_UPLOAD_BYTES} bytes with Import instead.`,
    );
  return openImportFiles(items);
}

/** Checks the bundle an importer returned; contributed importers are untrusted input. */
function checkBundle(value: unknown): ImportBundle {
  const fail = (message: string): never => {
    throw new CoreError(
      "INVALID_DATA",
      `The importer returned an invalid bundle: ${message}`,
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("not an object.");
  const bundle = value as ImportBundle;
  const list = (name: "folders" | "pages" | "datasets") => {
    const items = bundle[name] ?? [];
    if (!Array.isArray(items)) fail(`${name} must be an array.`);
    const keys = new Set<string>();
    for (const [index, item] of (items as { key?: unknown }[]).entries()) {
      if (!item || typeof item !== "object")
        fail(`${name}[${index}] must be an object.`);
      if (
        typeof item.key !== "string" ||
        !item.key ||
        item.key.length > MAX_KEY
      )
        fail(`${name}[${index}].key must be text of 1–${MAX_KEY} characters.`);
      if (keys.has(item.key as string))
        fail(`${name} repeats the key ${String(item.key)}.`);
      keys.add(item.key as string);
    }
    return keys;
  };
  const folders = list("folders");
  list("pages");
  list("datasets");
  if (!Array.isArray(bundle.pages)) fail("pages must be an array.");
  if (bundle.pages.length > MAX_PAGES) fail(`more than ${MAX_PAGES} pages.`);
  for (const item of [...(bundle.folders ?? []), ...bundle.pages])
    if (item.parent !== undefined && !folders.has(item.parent))
      fail(
        `${item.key} names the unknown parent folder ${String(item.parent)}.`,
      );
  // Folder parents must not form a cycle.
  const parents = new Map(
    (bundle.folders ?? []).map((item) => [item.key, item.parent]),
  );
  for (const key of folders) {
    const seen = new Set<string>();
    for (let at: string | undefined = key; at; at = parents.get(at)) {
      if (seen.has(at)) fail(`folder ${key} is inside itself.`);
      seen.add(at);
    }
  }
  for (const page of bundle.pages) {
    if ((page.blocks !== undefined) === (page.artifact !== undefined))
      fail(`page ${page.key} needs either blocks or artifact.`);
    if (
      page.blocks &&
      (!Array.isArray(page.blocks) ||
        page.blocks.some(
          (block) =>
            !block ||
            typeof block.kind !== "string" ||
            !block.data ||
            typeof block.data !== "object" ||
            Array.isArray(block.data),
        ))
    )
      fail(`page ${page.key} blocks must be {kind, data} objects.`);
  }
  for (const dataset of bundle.datasets ?? [])
    if (dataset.value === undefined)
      fail(`dataset ${dataset.key} has no value.`);
  if (bundle.warnings !== undefined && !Array.isArray(bundle.warnings))
    fail("warnings must be an array.");
  return bundle;
}

/** Every placeholder in a JSON value. */
function references(value: unknown, found: { kind: string; key: string }[]) {
  if (typeof value === "string") {
    for (const match of value.matchAll(IMPORT_PLACEHOLDER))
      found.push({ kind: match[1], key: decode(match[2]) });
  } else if (Array.isArray(value))
    value.forEach((item) => references(item, found));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => references(item, found));
  return found;
}

/** Resources an importer already embedded as data URLs (e.g. images inside a .docx). */
function embeddedResources(
  value: unknown,
  found: { count: number; bytes: number },
) {
  if (typeof value === "string") {
    for (const match of value.matchAll(
      /data:(?:image|video|audio|application\/pdf)[^;,]*;base64,([A-Za-z0-9+/=]+)/g,
    )) {
      found.count++;
      found.bytes += Math.floor((match[1].length * 3) / 4);
    }
  } else if (Array.isArray(value))
    value.forEach((item) => embeddedResources(item, found));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => embeddedResources(item, found));
  return found;
}

function replaceReferences(
  value: unknown,
  resolve: (kind: string, key: string, whole: boolean) => string,
): unknown {
  if (typeof value === "string") {
    const whole = new RegExp(`^${IMPORT_PLACEHOLDER.source}$`).exec(value);
    if (whole) return resolve(whole[1], decode(whole[2]), true);
    return value.replace(IMPORT_PLACEHOLDER, (_, kind: string, key: string) =>
      resolve(kind, decode(key), false),
    );
  }
  if (Array.isArray(value))
    return value.map((item) => replaceReferences(item, resolve));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceReferences(item, resolve),
      ]),
    );
  return value;
}

interface Prepared {
  input: OpenedInput;
  bundle: ImportBundle;
  plan: ImportPlan;
}

async function prepare(
  service: AgentService,
  source: ImportSource,
  target: ImportTarget,
  importerId?: string,
): Promise<Prepared> {
  const projectId = service.requireProject(target.projectId);
  const folders = await service.store.listFolders(projectId);
  if (
    target.parentId &&
    !folders.some((folder) => folder.id === target.parentId)
  )
    throw new CoreError("NOT_FOUND", "The destination folder does not exist.");
  const input = await openSource(source);
  try {
    const { importers, problems } = await availableImporters(
      service.store.root,
      projectId,
    );
    const { importer, candidates } = await chooseImporter(
      input,
      importers,
      importerId,
    );
    const bundle = checkBundle(await importer.convert(input));
    const warnings: ImportWarning[] = [
      ...problems.map((message) => ({ message })),
      ...(importer.id === "notion" || importer.id === "word"
        ? []
        : input.problems),
      ...(bundle.warnings ?? []).map((item) => ({
        ...(typeof item?.source === "string" ? { source: item.source } : {}),
        message: String(item?.message ?? item),
      })),
    ];
    const files = new Map(input.files.map((file) => [file.path, file]));
    const pageKeys = new Set(bundle.pages.map((page) => page.key));
    const folderKeys = new Set(
      (bundle.folders ?? []).map((folder) => folder.key),
    );
    const datasetKeys = new Set(
      (bundle.datasets ?? []).map((item) => item.key),
    );
    const resources = new Map<string, number>();
    const unresolved = new Set<string>();
    for (const item of [...bundle.pages, ...(bundle.datasets ?? [])])
      for (const ref of references(
        "blocks" in item
          ? (item.blocks ?? [])
          : (item as { value: unknown }).value,
        [],
      )) {
        if (ref.kind === "file") {
          const file = files.get(ref.key);
          const type = fileType(ref.key);
          if (!file || !type) unresolved.add(`file ${ref.key}`);
          else if (file.size > CAPACITY.resourceBytes)
            warnings.push({
              source: ref.key,
              message: `${file.size} bytes exceed the ${CAPACITY.resourceBytes}-byte limit of one resource; left out.`,
            });
          else resources.set(ref.key, file.size);
        } else if (
          !(
            ref.kind === "page"
              ? pageKeys
              : ref.kind === "folder"
                ? folderKeys
                : datasetKeys
          ).has(ref.key)
        )
          unresolved.add(`${ref.kind} ${ref.key}`);
      }
    const embedded = embeddedResources(
      bundle.pages.map(
        (page) => page.blocks ?? page.artifact?.document.content,
      ),
      { count: 0, bytes: 0 },
    );
    for (const ref of unresolved)
      warnings.push({
        message: `The importer refers to ${ref}, which the import does not contain; the reference is left empty.`,
      });
    const tops =
      (bundle.folders ?? []).filter((folder) => !folder.parent).length +
      bundle.pages.filter((page) => !page.parent).length;
    const root =
      (input.kind === "folder" || input.kind === "zip") && tops > 1
        ? title(bundle.title, input.name.replace(/\.zip$/i, ""))
        : null;
    const items: ImportPlanItem[] = [
      ...(bundle.folders ?? []).map((folder) => ({
        type: "folder" as const,
        key: folder.key,
        title: title(folder.title, folder.key),
        ...(folder.parent ? { parent: folder.parent } : {}),
        ...(folder.source ? { source: folder.source } : {}),
      })),
      ...(bundle.datasets ?? []).map((dataset) => ({
        type: "dataset" as const,
        key: dataset.key,
        title: title(dataset.name, dataset.key),
      })),
      ...bundle.pages.map((page) => ({
        type: "page" as const,
        key: page.key,
        title: title(page.title, page.key),
        ...(page.parent ? { parent: page.parent } : {}),
        ...(page.source ? { source: page.source } : {}),
      })),
    ];
    const plan: ImportPlan = {
      importer: importerInfo(importer),
      candidates: candidates.filter((item) => item.score > 0),
      source: {
        name: input.name,
        kind: input.kind,
        files: input.files.length,
        bytes: input.files.reduce((sum, file) => sum + file.size, 0),
      },
      target: { projectId, parentId: target.parentId },
      root,
      counts: {
        folders: (bundle.folders?.length ?? 0) + (root ? 1 : 0),
        pages: bundle.pages.length,
        databases: bundle.datasets?.length ?? 0,
        resources: resources.size + embedded.count,
        resourceBytes:
          [...resources.values()].reduce((sum, size) => sum + size, 0) +
          embedded.bytes,
      },
      items,
      warnings,
    };
    return { input, bundle, plan };
  } catch (error) {
    await input.close();
    throw error;
  }
}

/** What an import would create, without writing anything. */
export async function planImport(
  service: AgentService,
  source: ImportSource,
  target: ImportTarget,
  options: { importer?: string } = {},
): Promise<ImportPlan> {
  const { input, plan } = await prepare(
    service,
    source,
    target,
    options.importer,
  );
  await input.close();
  return plan;
}

/** Reads, converts and writes an import; progress and cancellation are checked between items. */
export async function runImport(
  service: AgentService,
  source: ImportSource,
  target: ImportTarget,
  options: {
    importer?: string;
    signal?: AbortSignal;
    onProgress?: (progress: ImportProgress) => void;
  } = {},
): Promise<ImportReport> {
  const { input, bundle, plan } = await prepare(
    service,
    source,
    target,
    options.importer,
  );
  const context = changeContext();
  // One history group per import, so its saves read as one operation.
  return withChangeContext(
    {
      ...context,
      groupId: context.groupId ?? `import-${randomUUID()}`,
      message: context.message ?? `Import ${plan.source.name}`,
    },
    async () => {
      try {
        return await write(service, input, bundle, plan, options);
      } finally {
        await input.close();
      }
    },
  );
}

async function write(
  service: AgentService,
  input: OpenedInput,
  bundle: ImportBundle,
  plan: ImportPlan,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ImportProgress) => void;
  },
): Promise<ImportReport> {
  const { projectId } = plan.target;
  const store = service.store;
  const files = new Map(input.files.map((file) => [file.path, file]));
  const folderIds = new Map<string, string>();
  const pageIds = new Map(bundle.pages.map((page) => [page.key, randomUUID()]));
  const datasetIds = new Map(
    (bundle.datasets ?? []).map((item) => [item.key, randomUUID()]),
  );
  const report: ImportReport = {
    plan,
    cancelled: false,
    created: { folders: 0, pages: 0, databases: 0, resources: 0 },
    problems: [],
    folderId: null,
    pages: [],
    openPageId: null,
    undo: { folders: [], pages: [] },
  };
  // Each item is its own operation of the import's history group; the
  // operation of the request that started the import must not be replayed.
  const own = <T>(write: () => Promise<T>) =>
    withChangeContext(
      {
        ...changeContext(),
        operationId: randomUUID(),
        requestFingerprint: undefined,
      },
      write,
    );
  const total = plan.counts.folders + plan.counts.pages + plan.counts.databases;
  let done = 0;
  const step = (current: string) => {
    done++;
    options.onProgress?.({ done, total, current });
  };
  const stopped = () => {
    if (options.signal?.aborted) report.cancelled = true;
    return report.cancelled;
  };
  const failed = (
    item: Omit<ImportReport["problems"][number], "message">,
    error: unknown,
  ) =>
    report.problems.push({
      ...item,
      message: error instanceof Error ? error.message : String(error),
    });
  options.onProgress?.({ done, total });

  let rootId: string | null = plan.target.parentId;
  if (plan.root) {
    const folder = await own(() =>
      mutateLibrary(store.root, () =>
        store.createFolder(projectId, {
          name: plan.root!,
          parentId: plan.target.parentId,
        }),
      ),
    );
    rootId = folder.id;
    report.folderId = folder.id;
    report.undo.folders.push(folder.id);
    report.created.folders++;
    step(plan.root);
  }
  // Folders after their parents.
  const pending = [...(bundle.folders ?? [])];
  while (pending.length && !stopped()) {
    const index = pending.findIndex(
      (folder) => !folder.parent || folderIds.has(folder.parent),
    );
    if (index < 0) break;
    const [folder] = pending.splice(index, 1);
    const name = title(folder.title, folder.key);
    try {
      const created = await own(() =>
        mutateLibrary(store.root, () =>
          store.createFolder(projectId, {
            name,
            parentId: folder.parent ? folderIds.get(folder.parent)! : rootId,
          }),
        ),
      );
      folderIds.set(folder.key, created.id);
      if (!folder.parent && !plan.root) report.undo.folders.push(created.id);
      report.created.folders++;
    } catch (error) {
      failed(
        { type: "folder", key: folder.key, title: name, source: folder.source },
        error,
      );
    }
    step(name);
  }
  for (const folder of pending)
    if (!report.cancelled)
      failed(
        {
          type: "folder",
          key: folder.key,
          title: title(folder.title, folder.key),
        },
        new Error("Its parent folder could not be created."),
      );

  let pageResourceBytes = 0;
  const resolver = (kind: string, key: string, whole: boolean) => {
    if (kind === "page") {
      const id = pageIds.get(key);
      return id ? pageLink({ projectId, pageId: id }) : whole ? "" : "#";
    }
    if (kind === "folder") return folderIds.get(key) ?? "";
    if (kind === "dataset") return datasetIds.get(key) ?? "";
    return embedded.get(key) ?? (whole ? "" : "#");
  };
  // Files are read once per page that uses them and embedded as data URLs.
  const embedded = new Map<string, string>();
  async function embed(value: unknown, owner: { key: string; title: string }) {
    embedded.clear();
    pageResourceBytes = 0;
    for (const ref of references(value, [])) {
      if (ref.kind !== "file" || embedded.has(ref.key)) continue;
      const file = files.get(ref.key);
      const type = fileType(ref.key);
      if (!file || !type || file.size > CAPACITY.resourceBytes) continue;
      if (pageResourceBytes + file.size > CAPACITY.pageResourceBytes) {
        report.problems.push({
          type: "page",
          key: owner.key,
          title: owner.title,
          source: ref.key,
          message: `The page's resources would exceed ${CAPACITY.pageResourceBytes} bytes; ${ref.key} was left out.`,
        });
        continue;
      }
      pageResourceBytes += file.size;
      embedded.set(
        ref.key,
        `data:${type.mime};base64,${Buffer.from(await file.bytes()).toString("base64")}`,
      );
      report.created.resources++;
    }
  }

  for (const dataset of bundle.datasets ?? []) {
    if (stopped()) break;
    const name = title(dataset.name, dataset.key);
    try {
      await own(() =>
        service.datasetCreate(projectId, {
          id: datasetIds.get(dataset.key)!,
          name,
          ...(dataset.description ? { description: dataset.description } : {}),
          value: replaceReferences(dataset.value, resolver),
        }),
      );
      report.created.databases++;
    } catch (error) {
      datasetIds.delete(dataset.key);
      failed({ type: "dataset", key: dataset.key, title: name }, error);
    }
    step(name);
  }

  for (const page of bundle.pages) {
    if (stopped()) break;
    const name = title(page.title, page.key);
    const parentId = page.parent ? folderIds.get(page.parent) : rootId;
    try {
      if (page.parent && !parentId)
        throw new Error("Its folder could not be created.");
      const id = pageIds.get(page.key)!;
      if (page.blocks) {
        await embed(page.blocks, page);
        const blocks = replaceReferences(page.blocks, resolver) as {
          kind: string;
          data: Record<string, unknown>;
        }[];
        await own(() =>
          service.createPage(projectId, {
            id,
            title: name,
            parentId: parentId ?? null,
            blocks,
          }),
        );
      } else {
        const artifact = page.artifact!;
        const document = validateDocument({
          ...artifact.document,
          title: name,
        });
        await own(() =>
          service.createPage(projectId, {
            id,
            parentId: parentId ?? null,
            document,
            components: artifact.components as CompiledComponent[] | undefined,
            remoteComponents: artifact.remoteComponents as
              PublishedComponentLocator[] | undefined,
          }),
        );
      }
      report.created.pages++;
      report.created.resources += embeddedResources(
        page.blocks ?? page.artifact?.document.content,
        { count: 0, bytes: 0 },
      ).count;
      if (report.pages.length < 200)
        report.pages.push({ key: page.key, pageId: id, title: name });
      if (!page.parent && !plan.root) report.undo.pages.push(id);
      // The page to open: a top-level page, or the page of a top-level folder.
      const topFolder =
        page.parent !== undefined &&
        page.parent === page.key &&
        !bundle.folders?.find((folder) => folder.key === page.parent)?.parent;
      if (!report.openPageId && (!page.parent || topFolder))
        report.openPageId = id;
    } catch (error) {
      pageIds.delete(page.key);
      failed(
        { type: "page", key: page.key, title: name, source: page.source },
        error,
      );
    }
    step(name);
  }
  if (!report.openPageId && report.pages.length)
    report.openPageId = report.pages[0].pageId;
  return report;
}

// ---------------------------------------------------------------------------
// Runs the workbench follows: progress is polled, cancellation is requested.

interface Run {
  progress: ImportProgress;
  controller: AbortController;
}
const runs = new Map<string, Run>();
const staged = new Map<string, { source: ImportSource; expires: number }>();
const STAGE_MS = 30 * 60 * 1000;

/** Keeps a planned source so the confirmed run reads the same input. */
export function stageImport(source: ImportSource): string {
  const now = Date.now();
  for (const [token, item] of staged)
    if (item.expires < now) staged.delete(token);
  const token = randomUUID();
  staged.set(token, { source, expires: now + STAGE_MS });
  return token;
}
export function stagedImport(token: string): ImportSource {
  const item = staged.get(token);
  if (!item || item.expires < Date.now())
    throw new CoreError(
      "NOT_FOUND",
      "The planned import expired; choose the files again.",
    );
  return item.source;
}
export function releaseImport(token: string) {
  staged.delete(token);
}
export function trackImport(runId: string): Run {
  const run = {
    progress: { done: 0, total: 0 },
    controller: new AbortController(),
  };
  runs.set(runId, run);
  return run;
}
export function importProgress(runId: string): ImportProgress | null {
  return runs.get(runId)?.progress ?? null;
}
export function cancelImport(runId: string): boolean {
  const run = runs.get(runId);
  run?.controller.abort();
  return !!run;
}
export function untrackImport(runId: string) {
  runs.delete(runId);
}

export { availableImporters, importerInfo };
