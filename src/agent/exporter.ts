import {
  externalSnapshotReport,
  resolveDocumentDatasets,
  type BindingRead,
  type ExternalSnapshotReport,
} from "../core/dataset-resolution";
import { walk } from "../document/walk.mjs";
import { listBuiltinComponents } from "../core/catalog";
import { LibraryOperations } from "../core/library-operations";
import { versionedLibrary } from "../core/library-runtime";
import { REFERENCE_SNAPSHOT_LIMIT } from "../portable/reference-snapshot.mjs";
import { CAPACITY, assertBytes } from "../portable/capacity.mjs";
import {
  access,
  lstat,
  realpath,
  rm,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { FileStore } from "../core/store";
import { resolveDocumentComponents } from "../core/catalog";
import { resolvePublishedComponents } from "../core/publication";
import { publicationRefKey } from "../portable/remote.mjs";
import type { PublishedComponentLocator } from "../portable/publication-types";
import type { CompiledComponent } from "../contract/types";
import { externalResourceUrls } from "../portable/assets.mjs";
import {
  withLocalResources,
  type LocalResourceDecisions,
  type LocalResourcePlanItem,
} from "../core/local-resources";
import {
  applyPackaging,
  assertPackagingConfirmed,
  exportPackagingPlan,
  exportReceipt,
  previousChoices,
  rememberChoices,
  type ExportPagePlanInput,
  type PackagedDocument,
  type PackagingDecisions,
  type PackagingFormat,
  type PackagingPlan,
} from "../core/packaging";
import { toCdnPage } from "../portable/cdn-fragment.mjs";
import {
  conversationPreview,
  REQUESTED_CDN,
  type ReaderReason,
} from "../core/conversation-preview";
import {
  CDN_PAGE_TEMPLATE,
  chooseReader,
  type ReaderMode,
} from "../core/cdn-reader";
import { buildReaderTemplate } from "../core/reader-template";
export {
  buildReaderTemplate,
  findViewerTemplate,
} from "../core/reader-template";
import {
  injectArtifactIntoHtml,
  serializeArtifact,
} from "../portable/validation.mjs";
import type { ShowArtifact, ShowDocument } from "../types";
import { selectDocumentBlocks } from "../portable/selection.mjs";
import { withHtmlLanguage } from "../i18n";

export type ExportFormat = "html" | "inline" | "site";
export interface ExportOptions {
  root?: string;
  projectId: string;
  pageId?: string;
  blockIds?: string[];
  format: ExportFormat;
  out: string;
  templatePath?: string;
  revision?: string;
  importedSnapshot?: { importId: string; snapshotId: string };
  overwrite?: boolean;
  components?: "bundled" | "remote";
  presentation?: "spatial" | "reading";
  /**
   * Inline prefers the compressed local reader, with CDN as a size fallback
   * that the result's readerReason reports; "bundled" refuses the fallback.
   */
  reader?: ReaderMode;
  /**
   * What the export carries, by packaging item id (see core/packaging):
   * the person's decisions after seeing the plan. An export with files of
   * this device (or data computed from them) and no decisions stops with
   * CONFIRMATION_REQUIRED and details.packaging, and writes nothing. Items
   * left out take the choice the plan shows.
   */
  packaging?: PackagingDecisions;
  /** "embed" confirms carrying everything that fits (the plan's defaults). */
  externalData?: "embed";
  /**
   * Per local file (by its file: reference): "embed" or "skip"; the same
   * as packaging decisions for those items.
   */
  resources?: LocalResourceDecisions;
}
export interface ExportResult {
  format: ExportFormat;
  projectId: string;
  pageIds: string[];
  blockIds?: string[];
  path: string;
  sourcePaths: string[];
  bytes: number;
  components: "bundled" | "remote";
  /** The reader the written page uses. */
  reader: ReaderMode;
  /** Why the page loads its reader online; absent when it carries its reader. */
  readerReason?: ReaderReason;
  requiresNetwork: boolean;
  /** Snapshots of external datasets embedded in the export. */
  externalSnapshots?: ExternalSnapshotReport;
  /** Local files of resource fields and what the export carries for each. */
  localResources?: LocalResourcePlanItem[];
  /** Every packaging item and its choice, without paths of this device. */
  packaging?: ReturnType<typeof exportReceipt>;
  /** Snapshots of transform inputs written beside the export ("inputs" or "both"). */
  inputFiles?: string[];
  /** Web addresses of resource fields, kept as they are; readers load them online. */
  onlineResources?: string[];
}

/** The resource report of an export: local files and kept web addresses. */
function resourceReport(
  documents: ShowDocument[],
  local: LocalResourcePlanItem[],
): Pick<ExportResult, "localResources" | "onlineResources"> {
  const online = [
    ...new Set(documents.flatMap((document) => externalResourceUrls(document))),
  ];
  const files = [...new Map(local.map((item) => [item.id, item])).values()];
  return {
    ...(files.length ? { localResources: files } : {}),
    ...(online.length ? { onlineResources: online } : {}),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Ids of the blocks an exported (possibly partial) document contains,
 * including components nested in their rich text. */
export function blockIdsOf(document: ShowDocument): string[] {
  const ids: string[] = [];
  walk(document.content, (node) => {
    if (typeof node.attrs?.id === "string") ids.push(node.attrs.id);
  }, { scope: "content" });
  return ids;
}

/** Bindings whose data an export carries, for the externalSnapshots report. */
function carried(bindings: BindingRead[], plan: PackagingPlan): BindingRead[] {
  const left = new Set(
    plan.items
      .filter((item) => item.datasetId && !["bundle", "result", "both"].includes(item.choice))
      .map((item) => `${item.projectId}/${item.datasetId}`),
  );
  return bindings.filter(
    (binding) => !left.has(`${binding.projectId}/${binding.datasetId}`),
  );
}

/** Whether the person confirmed what an export carries. */
const confirmedPackaging = (options: {
  packaging?: PackagingDecisions;
  externalData?: "embed";
  resources?: LocalResourceDecisions;
}) =>
  options.packaging !== undefined ||
  options.externalData === "embed" ||
  options.resources !== undefined;

/**
 * The packaging plan of exported pages: the person's previous choices apply
 * unless externalData "embed" asks for everything that fits.
 */
async function packagingPlan(
  store: FileStore,
  options: {
    projectId: string;
    packaging?: PackagingDecisions;
    externalData?: "embed";
    resources?: LocalResourceDecisions;
  },
  pages: ExportPagePlanInput[],
  format: PackagingFormat,
): Promise<PackagingPlan> {
  const decisions = { ...options.resources, ...options.packaging };
  return exportPackagingPlan(store, {
    projectId: options.projectId,
    pages,
    format,
    previous:
      options.externalData === "embed"
        ? {}
        : await previousChoices(store, options.projectId),
    ...(Object.keys(decisions).length ? { decisions } : {}),
  });
}

/**
 * Resolves a page for export, plans and checks what it carries, and
 * applies the plan: the document as exported, with its plan.
 */
export async function packagePage(
  store: FileStore,
  options: {
    projectId: string;
    pageId: string;
    blockIds?: string[];
    format: PackagingFormat;
    packaging?: PackagingDecisions;
    externalData?: "embed";
    resources?: LocalResourceDecisions;
  },
): Promise<{
  plan: PackagingPlan;
  packaged: PackagedDocument;
  bindings: BindingRead[];
  blockIds?: string[];
}> {
  const record = await store.readPage(options.projectId, options.pageId, {
    checkpoint: false,
  });
  // Shared data is resolved into the exported copy; the reader has no library.
  const resolved = await resolveDocumentDatasets(
    store,
    options.projectId,
    record.document,
  );
  const shown = options.blockIds
    ? selectDocumentBlocks(resolved.document, options.blockIds)
    : resolved.document;
  const blockIds = options.blockIds ? blockIdsOf(shown) : undefined;
  const plan = await packagingPlan(
    store,
    options,
    [
      {
        pageId: options.pageId,
        document: record.document,
        bindings: resolved.bindings,
        ...(blockIds ? { blockIds } : {}),
        shown,
      },
    ],
    options.format,
  );
  assertPackagingConfirmed(plan, confirmedPackaging(options));
  const packaged = await applyPackaging(store, plan, {
    pageId: options.pageId,
    original: options.blockIds
      ? selectDocumentBlocks(record.document, options.blockIds)
      : record.document,
    resolved: shown,
  });
  if (options.packaging !== undefined) await rememberChoices(store, plan);
  return {
    plan,
    packaged,
    bindings: resolved.bindings,
    ...(blockIds ? { blockIds } : {}),
  };
}

/**
 * What an export of a page (or every active page) would carry, without
 * building it: the packaging plan with sizes and the choices in effect.
 */
export async function analyzeExport(options: {
  root?: string;
  projectId: string;
  pageId?: string;
  blockIds?: string[];
  format?: PackagingFormat;
}): Promise<PackagingPlan> {
  const store = new FileStore(options.root);
  const pages = options.pageId
    ? [{ id: options.pageId }]
    : await store.listPages(options.projectId, { includeArchived: false });
  const planned: ExportPagePlanInput[] = [];
  for (const page of pages) {
    const record = await store.readPage(options.projectId, page.id, {
      checkpoint: false,
    });
    if (!options.pageId && record.document.archived) continue;
    const { document, bindings } = await resolveDocumentDatasets(
      store,
      options.projectId,
      record.document,
    );
    const shown = options.blockIds
      ? selectDocumentBlocks(document, options.blockIds)
      : document;
    planned.push({
      pageId: page.id,
      document: record.document,
      bindings,
      ...(options.blockIds ? { blockIds: blockIdsOf(shown) } : {}),
      shown,
    });
  }
  return packagingPlan(
    store,
    options,
    planned,
    options.format ?? (options.pageId ? "html" : "site"),
  );
}

/** Writes the input snapshots of transforms beside an export. */
async function writeInputSnapshots(
  store: FileStore,
  projectId: string,
  directory: string,
  inputs: PackagedDocument["inputs"],
  overwrite: boolean,
): Promise<string[]> {
  const written = new Map<string, PackagedDocument["inputs"][number]>();
  for (const input of inputs)
    written.set(`${input.projectId}/${input.datasetId}`, input);
  if (!written.size) return [];
  const paths: string[] = [];
  for (const input of written.values()) {
    const path = join(
      directory,
      `${encodeURIComponent(input.projectId === projectId ? input.datasetId : `${input.projectId}-${input.datasetId}`)}.json`,
    );
    await assertExportDestination(store.root, projectId, path);
    await assertDestination(path, overwrite);
    paths.push(path);
  }
  await mkdir(directory, { recursive: true });
  for (const [index, input] of [...written.values()].entries())
    await writeFile(
      paths[index],
      `${JSON.stringify({ format: "showai-dataset-snapshot", version: 1, name: input.name, value: input.value }, null, 2)}\n`,
      { flag: overwrite ? "w" : "wx" },
    );
  return paths;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export async function buildPageHtml(
  document: ShowDocument,
  templatePath?: string,
  components: CompiledComponent[] = [],
  remoteComponents: PublishedComponentLocator[] = [],
  presentation?: "spatial" | "reading",
  selection?: ShowArtifact["selection"],
  readerHtml?: string,
  resources?: LocalResourceDecisions,
  references?: ShowArtifact["references"],
): Promise<string> {
  // Web addresses stay; local files are embedded or keep their name only.
  const prepared = (await withLocalResources(document, resources)).document;
  return withHtmlLanguage(
    injectArtifactIntoHtml(
      readerHtml ?? (await buildReaderTemplate([prepared], templatePath)),
      prepared,
      components,
      remoteComponents,
      presentation,
      selection,
      references,
    ),
  );
}

/**
 * The page's references, for an export whose components declare that they
 * read them (pageReferences in their contract). Other exports carry none, so
 * no other page's title or text leaves the library unasked.
 */
async function referenceSnapshot(
  root: string,
  projectId: string,
  document: ShowDocument,
  components: CompiledComponent[],
): Promise<ShowArtifact["references"]> {
  const builtins = new Set(
    listBuiltinComponents()
      .filter((item) => item.pageReferences)
      .map((item) => item.kind),
  );
  let reads = false;
  walk(document.content, (node) => {
    if (reads || (node.type !== "widget" && node.type !== "inlineWidget"))
      return;
    const kind = node.attrs?.kind;
    const data = node.attrs?.data;
    reads =
      builtins.has(kind) ||
      (kind === "custom" &&
        components.some(
          (component) =>
            component.pageReferences &&
            component.id === data?.componentId &&
            component.version === data?.version,
        ));
  }, { scope: "content" });
  if (!reads || !versionedLibrary(root)) return undefined;
  const { to, from, pages } = await new LibraryOperations(root).pageReferences(
    projectId,
    document.id,
    { limit: REFERENCE_SNAPSHOT_LIMIT },
  );
  return { page: { projectId, pageId: document.id }, to, from, pages };
}

/** Exported documents pin what was actually resolved, without mutating authoring files. */
function lockedDocument(
  document: ShowDocument,
  components: CompiledComponent[],
): ShowDocument {
  const copy = structuredClone(document);
  walk(copy.content, (node) => {
    if (
      (node.type === "widget" || node.type === "inlineWidget") &&
      node.attrs?.kind === "custom"
    ) {
      const data = node.attrs.data;
      const candidates = components.filter(
        (component) =>
          component.id === data?.componentId &&
          component.version === data?.version &&
          (!data.integrity || component.integrity === data.integrity),
      );
      if (candidates.length !== 1)
        throw new Error(
          `Cannot lock custom component ${data?.componentId}@${data?.version}; specify its exact integrity.`,
        );
      node.attrs = {
        ...node.attrs,
        data: { ...data, integrity: candidates[0].integrity },
      };
    }
  }, { scope: "content" });
  return copy;
}

async function assertDestination(
  path: string,
  overwrite: boolean,
): Promise<void> {
  if (!overwrite && (await exists(path)))
    throw new Error(
      `Output already exists: ${path}. Choose another path or pass --overwrite.`,
    );
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

async function effectivePath(path: string): Promise<string> {
  let parent = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    const found = await lstat(parent).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (found) return join(await realpath(parent), ...suffix);
    const next = dirname(parent);
    if (next === parent)
      throw new Error("Unable to resolve export destination.");
    suffix.unshift(relative(next, parent));
    parent = next;
  }
}

/** Allows the selected project's exports folder, while resolving aliases and symlinks. */
export async function assertExportDestination(
  root: string,
  projectId: string,
  path: string,
): Promise<void> {
  const store = new FileStore(root);
  const projects = join(store.root, "projects");
  const allowed = join(store.projectPath(projectId), "exports");
  const target = resolve(path);
  const catalogs = [
    join(store.root, "packages"),
    join(store.root, "publications"),
  ];
  if (catalogs.some((catalog) => isInside(catalog, target)))
    throw new Error(
      "Export cannot overwrite immutable package catalogs or publication records.",
    );
  if (isInside(projects, target) && !isInside(allowed, target))
    throw new Error(
      "Export outside project sources or into this project's exports directory.",
    );
  const actualProjects = await effectivePath(projects);
  const actualTarget = await effectivePath(target);
  const actualCatalogs = await Promise.all(catalogs.map(effectivePath));
  if (actualCatalogs.some((catalog) => isInside(catalog, actualTarget)))
    throw new Error(
      "Export destination resolves to protected package catalogs or publication records.",
    );
  // Keep the permitted location lexical relative to the real projects root: an
  // exports symlink must not redefine what belongs to the export subtree.
  const actualAllowed = join(actualProjects, projectId, "exports");
  if (
    isInside(actualProjects, actualTarget) &&
    !isInside(actualAllowed, actualTarget)
  )
    throw new Error(
      "Export destination resolves to protected project sources or another project's exports.",
    );
  if (isInside(allowed, target)) {
    const actualProject = await effectivePath(store.projectPath(projectId));
    if (!isInside(join(actualProject, "exports"), actualTarget))
      throw new Error(
        "The project's exports directory cannot redirect through a symbolic link.",
      );
  }
}

/** Produces deliverables from a stored project; never changes its authoring source. */
/**
 * The offline reader for one page in reading order, as text: what a PDF
 * export prints. Components and the reader are bundled; nothing is written.
 */
export async function readingPageHtml(options: {
  root: string;
  projectId: string;
  pageId: string;
  packaging?: PackagingDecisions;
  externalData?: "embed";
}): Promise<string> {
  const store = new FileStore(options.root);
  const { packaged } = await packagePage(store, {
    projectId: options.projectId,
    pageId: options.pageId,
    format: "html",
    ...(options.packaging !== undefined
      ? { packaging: options.packaging }
      : {}),
    ...(options.externalData ? { externalData: options.externalData } : {}),
  });
  const components = await resolveDocumentComponents(
    store.root,
    packaged.document,
    options.projectId,
  );
  const document = lockedDocument(packaged.document, components);
  return buildPageHtml(
    document,
    undefined,
    components,
    [],
    "reading",
    undefined,
    undefined,
    undefined,
    await referenceSnapshot(
      store.root,
      options.projectId,
      document,
      components,
    ),
  );
}

export async function exportPage(
  options: ExportOptions,
): Promise<ExportResult> {
  if (
    options.presentation !== undefined &&
    !["spatial", "reading"].includes(options.presentation)
  )
    throw new Error("Presentation must be spatial or reading.");
  if (options.revision || options.importedSnapshot)
    throw new Error(
      "Historical export has been removed. Export current content instead.",
    );
  const store = new FileStore(options.root);
  if (options.blockIds !== undefined && options.format === "site")
    throw new Error(
      "Block selection is supported for html and inline exports, not site export.",
    );
  const selection =
    options.blockIds === undefined ? undefined : { blockIds: options.blockIds };
  const presentation =
    options.presentation ?? (selection ? "reading" : "spatial");
  const componentMode = options.components ?? "bundled";
  if (!["bundled", "remote"].includes(componentMode))
    throw new Error("Choose bundled or remote components.");
  if (options.format === "inline" && componentMode === "remote")
    throw new Error(
      "Inline exports must bundle components because the conversation host blocks remote requests.",
    );
  const reader = await chooseReader(options.format, options.reader);
  const out = resolve(options.out);
  if (
    (options.revision || options.importedSnapshot) &&
    options.format === "site"
  )
    throw new Error(
      "Historical exports require one page and html or inline format.",
    );
  await assertExportDestination(store.root, options.projectId, out);
  if (options.format !== "site") {
    if (!options.pageId)
      throw new Error("A page id is required for html or inline export.");
    const { plan, packaged, bindings } = await packagePage(store, {
      projectId: options.projectId,
      pageId: options.pageId,
      ...(selection ? { blockIds: selection.blockIds } : {}),
      format: options.format,
      ...(options.packaging !== undefined
        ? { packaging: options.packaging }
        : {}),
      ...(options.externalData ? { externalData: options.externalData } : {}),
      ...(options.resources ? { resources: options.resources } : {}),
    });
    const sourceDocument = packaged.document;
    const externalSnapshots = externalSnapshotReport([
      {
        pageId: options.pageId,
        bindings: carried(bindings, plan),
        ...(selection ? { blockIds: blockIdsOf(sourceDocument) } : {}),
      },
    ]);
    const components = await resolveDocumentComponents(
      store.root,
      sourceDocument,
      options.projectId,
    );
    const document = lockedDocument(sourceDocument, components);
    const remoteComponents =
      componentMode === "remote"
        ? await resolvePublishedComponents(
            store.root,
            document,
            options.projectId,
          )
        : [];
    const bundledComponents = componentMode === "bundled" ? components : [];
    const references = await referenceSnapshot(
      store.root,
      options.projectId,
      document,
      components,
    );
    const html = await buildPageHtml(
      document,
      options.templatePath,
      bundledComponents,
      remoteComponents,
      presentation,
      selection,
      reader.mode === "cdn" ? CDN_PAGE_TEMPLATE : undefined,
      undefined,
      references,
    );
    const preview =
      options.format === "inline"
        ? await conversationPreview(html, options.reader)
        : undefined;
    const result =
      preview?.inline ??
      (reader.mode === "cdn"
        ? toCdnPage(html, { readerUrls: reader.urls })
        : html);
    const deliveredReader = preview?.reader ?? reader.mode;
    // Only an export can ask for the bundled reader instead.
    const readerReason: ReaderReason | undefined =
      preview?.readerReason?.cause === "size"
        ? {
            ...preview.readerReason,
            message: `${preview.readerReason.message} Pass reader bundled to fail instead.`,
          }
        : (preview?.readerReason ??
          (deliveredReader === "cdn" ? REQUESTED_CDN : undefined));
    const sourcePath =
      out.slice(0, out.length - extname(out).length) + ".showai.json";
    if (sourcePath === out)
      throw new Error(
        "Choose an .html output path; source JSON is saved alongside it.",
      );
    await assertDestination(out, !!options.overwrite);
    await assertExportDestination(store.root, options.projectId, sourcePath);
    await assertDestination(sourcePath, !!options.overwrite);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(
      sourcePath,
      serializeArtifact(
        document,
        bundledComponents,
        remoteComponents,
        presentation,
        selection,
        references,
      ),
      {
        flag: options.overwrite ? "w" : "wx",
      },
    );
    await writeFile(out, result, { flag: options.overwrite ? "w" : "wx" });
    const inputFiles = await writeInputSnapshots(
      store,
      options.projectId,
      `${out.slice(0, out.length - extname(out).length)}.inputs`,
      packaged.inputs,
      !!options.overwrite,
    );
    return {
      format: options.format,
      projectId: options.projectId,
      pageIds: [document.id],
      ...(selection ? { blockIds: selection.blockIds } : {}),
      path: out,
      sourcePaths: [sourcePath],
      bytes: Buffer.byteLength(result),
      components: componentMode,
      reader: deliveredReader,
      ...(readerReason ? { readerReason } : {}),
      requiresNetwork: deliveredReader === "cdn" || remoteComponents.length > 0,
      ...(externalSnapshots.datasets.length ? { externalSnapshots } : {}),
      ...resourceReport([document], packaged.resources),
      ...(plan.items.length ? { packaging: exportReceipt(plan) } : {}),
      ...(inputFiles.length ? { inputFiles } : {}),
    };
  }

  const pages = await store.listPages(options.projectId, {
    includeArchived: false,
  });
  if (!pages.length) throw new Error("This project has no pages to export.");
  const selected = options.pageId
    ? pages.filter((page) => page.id === options.pageId)
    : pages;
  if (!selected.length)
    throw new Error(`Page not found in this project: ${options.pageId}`);
  const records = await Promise.all(
    selected.map((page) =>
      store.readPage(options.projectId, page.id, { checkpoint: false }),
    ),
  );
  const resolvedPages = (
    await Promise.all(
      records.map((record) =>
        resolveDocumentDatasets(store, options.projectId, record.document),
      ),
    )
  ).filter(({ document }) => options.pageId || !document.archived);
  if (!resolvedPages.length)
    throw new Error("This project has no active pages to export.");
  const originals = new Map(
    records.map((record) => [record.document.id, record.document]),
  );
  const plan = await packagingPlan(
    store,
    options,
    resolvedPages.map(({ document, bindings }) => ({
      pageId: document.id,
      document: originals.get(document.id)!,
      bindings,
      shown: document,
    })),
    "site",
  );
  assertPackagingConfirmed(plan, confirmedPackaging(options));
  const externalSnapshots = externalSnapshotReport(
    resolvedPages.map(({ document, bindings }) => ({
      pageId: document.id,
      bindings: carried(bindings, plan),
    })),
  );
  const localPages: PackagedDocument[] = [];
  for (const { document } of resolvedPages)
    localPages.push(
      await applyPackaging(store, plan, {
        pageId: document.id,
        original: originals.get(document.id)!,
        resolved: document,
      }),
    );
  if (options.packaging !== undefined) await rememberChoices(store, plan);
  let documents = localPages.map(({ document }) => document);
  const pageComponents = await Promise.all(
    documents.map((document) =>
      resolveDocumentComponents(store.root, document, options.projectId),
    ),
  );
  documents = documents.map((document, index) =>
    lockedDocument(document, pageComponents[index]),
  );
  const allRemote =
    componentMode === "remote"
      ? await resolvePublishedComponents(
          store.root,
          {
            ...documents[0],
            content: {
              type: "doc",
              content: documents.flatMap(
                (document) => document.content.content ?? [],
              ),
            },
          },
          options.projectId,
        )
      : [];
  const remoteByRef = new Map(
    allRemote.map((locator) => [publicationRefKey(locator.ref), locator]),
  );
  let previousRoutes: { id: string; file: string }[] = [];
  if (await exists(out)) {
    if (!(await stat(out)).isDirectory())
      throw new Error("Site output must be a directory.");
    const entries = await readdir(out);
    if (
      entries.length &&
      (!options.overwrite || !(await exists(join(out, "showai-site.json"))))
    )
      throw new Error(
        "Site output must be empty, or a ShowAI site with --overwrite enabled.",
      );
    if (entries.length) {
      const previous = JSON.parse(
        await readFile(join(out, "showai-site.json"), "utf8"),
      );
      if (
        previous.format !== "showai-site" ||
        previous.version !== 1 ||
        previous.projectId !== options.projectId ||
        !Array.isArray(previous.pages) ||
        previous.pages.some(
          (page: { id?: unknown; file?: unknown }) =>
            typeof page.id !== "string" ||
            typeof page.file !== "string" ||
            !/^(?:index|[a-zA-Z0-9_%.-]+)\.html$/.test(page.file),
        )
      )
        throw new Error(
          "Cannot overwrite a site without a valid matching ShowAI manifest.",
        );
      previousRoutes = previous.pages;
    }
  }
  const routes = documents.map((document, index) => ({
    id: document.id,
    title: document.title || "Untitled",
    file:
      index === 0 ? "index.html" : `${encodeURIComponent(document.id)}.html`,
  }));
  const destinations = [
    "assets/viewer.js",
    "assets/viewer.css",
    "showai-site.json",
    ...routes.map((route) => route.file),
    ...routes.map(
      (route) => `sources/${encodeURIComponent(route.id)}.showai.json`,
    ),
    ...previousRoutes.map((route) => route.file),
    ...previousRoutes.map(
      (route) => `sources/${encodeURIComponent(route.id)}.showai.json`,
    ),
  ];
  for (const path of destinations)
    await assertExportDestination(
      store.root,
      options.projectId,
      join(out, path),
    );
  const template = await buildReaderTemplate(documents, options.templatePath);
  await mkdir(join(out, "assets"), { recursive: true });
  await mkdir(join(out, "sources"), { recursive: true });
  const sourcePaths: string[] = [];
  let bytes = 0;
  for (const [index, document] of documents.entries()) {
    const components = componentMode === "bundled" ? pageComponents[index] : [];
    const remoteComponents =
      componentMode === "remote"
        ? pageComponents[index].map((component) =>
            remoteByRef.get(
              publicationRefKey({
                kind: "component",
                id: component.id,
                version: component.version,
                integrity: component.integrity,
              }),
            )!,
          )
        : [];
    const references = await referenceSnapshot(
      store.root,
      options.projectId,
      document,
      pageComponents[index],
    );
    let html = withHtmlLanguage(
      injectArtifactIntoHtml(
        template,
        document,
        components,
        remoteComponents,
        options.presentation ?? "spatial",
        undefined,
        references,
      ),
    );
    // Each page shares one reader bundle and stylesheet; page data remains embedded.
    const scripts: string[] = [];
    html = html.replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      (tag, attributes: string, code: string) => {
        if (!/type=["']module["']/.test(attributes)) return tag;
        scripts.push(code);
        return scripts.length === 1
          ? '<script type="module" src="./assets/viewer.js"></script>'
          : "";
      },
    );
    const styles: string[] = [];
    html = html.replace(
      /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
      (_tag, css: string) => {
        styles.push(css);
        return styles.length === 1
          ? '<link rel="stylesheet" href="./assets/viewer.css">'
          : "";
      },
    );
    if (!scripts.length || !styles.length)
      throw new Error(
        "Site export requires a built viewer with inline scripts and styles.",
      );
    if (index === 0) {
      const code = scripts.join("\n");
      const css =
        styles.join("\n") +
        '\n.showai-site-nav{display:flex;flex-wrap:wrap;gap:8px 20px;padding:18px max(24px,calc((100vw - 920px)/2));padding-right:max(64px,calc((100vw - 920px)/2));border-bottom:1px solid #8883;font:14px system-ui}.showai-site-nav a{color:inherit;text-decoration:none;opacity:.65;max-width:100%;overflow-wrap:anywhere}.showai-site-nav a[aria-current="page"]{opacity:1;font-weight:650}.showai-site-nav a:hover{text-decoration:underline}@media print{.showai-site-nav{display:none}}';
      await writeFile(join(out, "assets/viewer.js"), code);
      await writeFile(join(out, "assets/viewer.css"), css);
      bytes += Buffer.byteLength(code) + Buffer.byteLength(css);
    }
    // Page links between exported pages open the page files.
    const siteRoutes = JSON.stringify({
      projectId: options.projectId,
      pages: Object.fromEntries(routes.map((route) => [route.id, route.file])),
    }).replaceAll("<", "\\u003c");
    html = html.replace(
      /<body\b[^>]*>/i,
      (tag) =>
        `${tag}<script type="application/json" id="showai-site">${siteRoutes}</script>`,
    );
    if (documents.length > 1) {
      const navigation = `<nav class="showai-site-nav" aria-label="Site pages">${routes.map((route, routeIndex) => `<a href="./${escapeHtml(route.file)}"${index === routeIndex ? ' aria-current="page"' : ""}>${escapeHtml(route.title)}</a>`).join("")}</nav>`;
      html = html.replace(/<body\b[^>]*>/i, (tag) => tag + navigation);
    }
    assertBytes(
      "Exported site page HTML",
      Buffer.byteLength(html),
      CAPACITY.htmlBytes,
    );
    await writeFile(join(out, routes[index].file), html);
    const sourcePath = join(
      out,
      "sources",
      `${encodeURIComponent(document.id)}.showai.json`,
    );
    await writeFile(
      sourcePath,
      serializeArtifact(
        document,
        components,
        remoteComponents,
        options.presentation ?? "spatial",
        undefined,
        references,
      ),
    );
    sourcePaths.push(sourcePath);
    bytes += Buffer.byteLength(html);
  }
  for (const previous of previousRoutes) {
    if (!routes.some((route) => route.file === previous.file))
      await rm(join(out, previous.file), { force: true });
    if (!routes.some((route) => route.id === previous.id))
      await rm(
        join(out, "sources", `${encodeURIComponent(previous.id)}.showai.json`),
        { force: true },
      );
  }
  // A site written again keeps its input snapshots in step with its pages.
  const inputFiles = await writeInputSnapshots(
    store,
    options.projectId,
    join(out, "inputs"),
    localPages.flatMap((page) => page.inputs),
    true,
  );
  await writeFile(
    join(out, "showai-site.json"),
    JSON.stringify(
      {
        format: "showai-site",
        version: 1,
        projectId: options.projectId,
        pages: routes,
        components: componentMode,
        requiresNetwork: allRemote.length > 0,
      },
      null,
      2,
    ) + "\n",
  );
  return {
    format: "site",
    projectId: options.projectId,
    pageIds: documents.map((document) => document.id),
    path: join(out, "index.html"),
    sourcePaths,
    bytes,
    components: componentMode,
    reader: "bundled",
    requiresNetwork: allRemote.length > 0,
    ...(externalSnapshots.datasets.length ? { externalSnapshots } : {}),
    ...resourceReport(
      documents,
      localPages.flatMap(({ resources }) => resources),
    ),
    ...(plan.items.length ? { packaging: exportReceipt(plan) } : {}),
    ...(inputFiles.length ? { inputFiles } : {}),
  };
}
