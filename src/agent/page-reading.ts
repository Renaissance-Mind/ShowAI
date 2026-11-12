import { agentCommentView } from "../core/comments";
import { walk } from "../document/walk.mjs";
import {
  resolveDocumentDatasets,
  type BindingRead,
} from "../core/dataset-resolution";
import { structuredContent, type OutlineItem } from "./page-structured";
/** The runtime and reader build behind a rendered read, for checking that new code is live. */
async function renderedBy() {
  const [support, reader] = await Promise.all([
    supportInfo(),
    readerIdentity(),
  ]);
  return {
    version: support.version,
    sourceCommit: support.sourceCommit,
    ...reader,
  };
}

export { structuredContent } from "./page-structured";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { FileStore } from "../core/store";
import { CoreError } from "../core/model";
import { recordReadingCache } from "../core/reading-cache";
import { resolveDocumentComponents } from "../core/catalog";
import { selectDocumentBlocks } from "../portable/selection.mjs";
import { assertExportDestination, buildPageHtml } from "./exporter";
import { renderReading, type ReadingCapture } from "./reading-renderer";
import { describeResources, type ResourceRead } from "../core/local-resources";
import type { ShowDocument } from "../types";

import { collectCustomComponentRefs } from "../components/custom/contract";
import { loadBoardSnapshot } from "./board-reading";
import { injectReadingOptions } from "./reading-preview";
import { appLocale } from "../core/app-language";
import { readerIdentity } from "../core/reader-template";
import { supportInfo } from "./support";
import { withHtmlLanguage, type Locale } from "../i18n";

export const READ_VIEWS = ["structured", "image", "html"] as const;
/** Source size above which a default read returns an outline window. */
export const DEFAULT_READ_BYTES = 256 * 1024;
const LARGE_OUTLINE_BLOCKS = 100;

/**
 * Outline items of the page's blocks [offset, offset+limit) with their nested
 * items. Blocks are the children of the page's root container when it has one.
 */
function outlineWindow(
  outline: OutlineItem[],
  rootId: unknown,
  offset: number,
  limit: number | undefined,
): {
  outline: OutlineItem[];
  blockCount: number;
  paged: boolean;
  nextOffset?: number;
} {
  const rooted = outline[0]?.depth === 0 && outline[0].id === rootId;
  const level = rooted ? 1 : 0;
  const blockCount = outline.filter((item) => item.depth === level).length;
  if (limit === undefined && offset === 0)
    return { outline, blockCount, paged: false };
  const end = limit === undefined ? Infinity : offset + limit;
  let index = -1;
  const selected = outline.filter((item) => {
    if (item.depth < level) return true;
    if (item.depth === level) index++;
    return index >= offset && index < end;
  });
  return {
    outline: selected,
    blockCount,
    paged: true,
    ...(end < blockCount ? { nextOffset: end } : {}),
  };
}

/**
 * Ids of the blocks that show custom components drawn by these compiled
 * components. A component nested in rich text is shown by the block that
 * holds the rich text, so that block is selected for rendering.
 */
function customBlocks(
  document: ShowDocument,
  components: { id: string; version: string; integrity: string }[],
): string[] {
  const wanted = new Set(
    components.map((item) => `${item.id}@${item.version}:${item.integrity}`),
  );
  const ids = new Set<string>();
  walk(document.content, (node, { owner }) => {
    if ((node.type === "widget" || node.type === "inlineWidget") && node.attrs?.kind === "custom") {
      const data = node.attrs.data as {
        componentId?: string;
        version?: string;
        integrity?: string;
      };
      if (wanted.has(`${data.componentId}@${data.version}:${data.integrity}`))
        ids.add(String((owner ?? node).attrs?.id));
    }
  }, { scope: "content" });
  return [...ids];
}
const roles = [
  "button",
  "checkbox",
  "combobox",
  "textbox",
  "slider",
  "link",
  "tab",
  "menuitem",
] as const;
export const readingActionSchema = z
  .object({
    type: z.enum([
      "click",
      "hover",
      "fill",
      "select",
      "check",
      "uncheck",
      "drag",
    ]),
    blockId: z.string().min(1).max(200).optional(),
    selector: z.string().min(1).max(500).optional(),
    role: z.enum(roles).optional(),
    name: z.string().min(1).max(500).optional(),
    value: z.string().max(4000).optional(),
    dx: z.number().min(-2560).max(2560).optional(),
    dy: z.number().min(-2160).max(2160).optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (!!action.selector === !!action.role)
      ctx.addIssue({
        code: "custom",
        message: "An action needs exactly one selector or role/name target.",
      });
    if (action.role && !action.name)
      ctx.addIssue({
        code: "custom",
        message: "Role targets require an accessible name.",
      });
    if (["fill", "select"].includes(action.type) && action.value === undefined)
      ctx.addIssue({
        code: "custom",
        message: "Fill/select actions require value.",
      });
    if (
      action.type === "drag" &&
      action.dx === undefined &&
      action.dy === undefined
    )
      ctx.addIssue({
        code: "custom",
        message: "Drag requires dx or dy in viewport pixels.",
      });
  });
export const pageReadSchema = z
  .object({
    snapshotId: z.string().uuid().optional(),
    view: z.enum(READ_VIEWS).default("structured"),
    format: z.enum(["json", "markdown"]).default("json"),
    detail: z.enum(["full", "outline"]).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    blockIds: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
    theme: z.enum(["light", "dark"]).default("light"),
    viewport: z
      .object({
        width: z.number().int().min(320).max(2560),
        height: z.number().int().min(240).max(2160),
      })
      .strict()
      .default({ width: 1000, height: 900 }),
    presentation: z.enum(["reading", "spatial"]).default("reading"),
    actions: z.array(readingActionSchema).max(20).default([]),
    draft: z.boolean().default(false),
    rendered: z.boolean().optional(),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    out: z.string().min(1).optional(),
    overwrite: z.boolean().default(false),
    /** Adds pages referring to this page (to), pages it refers to (from), or both. */
    references: z.enum(["to", "from", "both"]).optional(),
  })
  .strict();
export type PageReadOptions = z.input<typeof pageReadSchema>;
export type ReadingOptions = z.output<typeof pageReadSchema>;
export type ReadingAction = z.output<typeof readingActionSchema>;
export interface ReadIdentity {
  snapshotId?: string;
  sourceHash?: string;
  currentHash?: string;
  currentSourceChanged?: boolean;
  capturedAt?: string;
  expiresAt?: string;
  origin?: "saved" | "provided-draft";
  revision?: string;
  projectId: string;
  pageId: string;
  title: string;
  hash: string;
  partial: boolean;
  blockIds?: string[];
  view: (typeof READ_VIEWS)[number];
  componentRefs: { id: string; version: string; integrity?: string }[];
  /** Blocks whose props come from a project dataset, with the resolved props. */
  bindings?: BindingRead[];
  /** With the references option: backlinks (to) and outgoing references (from). */
  references?: import("../core/library-index").PageReferences;
  /** Open comment threads (address them with page_apply {type:"comment"}) and the resolved count. */
  comments?: ReturnType<typeof agentCommentView>;
  /**
   * The dataset hashes this read saw, ready to pass as page_apply datasetBases
   * from any later connection ("projectId/datasetId" for other projects).
   */
  datasetBases?: Record<string, string>;
  /**
   * Local files (file: references) and web addresses in resource fields and
   * custom component props, once per reference with where each is used.
   */
  resources?: ResourceRead[];
}

/** datasetBases for page_apply from the bindings of a read. */
export function datasetBasesFor(
  projectId: string,
  bindings: BindingRead[],
): Record<string, string> | undefined {
  const bases: Record<string, string> = {};
  // A stale value is not the source's, so it is never a base for writes.
  for (const binding of bindings)
    if (binding.hash && binding.status === "ok")
      bases[
        binding.projectId === projectId
          ? binding.datasetId
          : `${binding.projectId}/${binding.datasetId}`
      ] = binding.hash;
  return Object.keys(bases).length ? bases : undefined;
}
export interface StructuredRead extends ReadIdentity {
  view: "structured";
  format: "json";
  document: ShowDocument;
  path: string;
  markdown: string;
  outline: OutlineItem[];
  computed: ReadingCapture["components"];
}

export type PageReadResult =
  | StructuredRead
  | (ReadIdentity & {
      format?: "markdown" | "outline";
      markdown?: string;
      outline?: OutlineItem[];
      computed?: ReadingCapture["components"];
      path?: string;
      url?: string;
      state?: Omit<ReadingOptions, "out" | "overwrite">;
      capturedAt?: string;
      dom?: ReadingCapture["dom"];
      image?: { width: number; height: number; mimeType: "image/png" };
      metadataPath?: string;
      /** Outline windows: top-level block count and where the next window starts. */
      blockCount?: number;
      offset?: number;
      nextOffset?: number;
      /** What a default read of a large page left out, and how to fetch it. */
      omitted?: { fields: string[]; reason: string; next: string };
    });

function previewHtml(
  html: string,
  state: ReadingOptions,
  identity: ReadIdentity,
  locale: Locale,
): string {
  // The reader takes its language from <html lang>, ahead of the browser's.
  return withHtmlLanguage(
    injectReadingOptions(html, {
      draft: state.draft,
      theme: state.theme,
      identity,
      state,
    }),
    locale,
  );
}
async function outputPath(
  store: FileStore,
  projectId: string,
  path: string,
  overwrite: boolean,
) {
  const absolute = resolve(path);
  await assertExportDestination(store.root, projectId, absolute);
  const exists = await readFile(absolute).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (exists && !overwrite)
    throw new CoreError(
      "INVALID_DATA",
      `Reading output already exists: ${absolute}. Choose another path or pass --overwrite.`,
    );
  await mkdir(dirname(absolute), { recursive: true });
  return absolute;
}

export async function readPageView(
  store: FileStore,
  projectId: string,
  pageId: string,
  input: PageReadOptions = {},
): Promise<PageReadResult> {
  const options = pageReadSchema.parse(input);
  if (
    options.snapshotId &&
    (options.view !== "structured" ||
      options.rendered === true ||
      options.actions.length)
  )
    throw new CoreError(
      "INVALID_DATA",
      "snapshotId on page_read supports source-only structured reading. Use board_read for snapshot images.",
    );
  if (
    options.view !== "structured" &&
    (options.detail !== undefined ||
      options.format !== "json" ||
      options.rendered !== undefined ||
      options.offset !== undefined ||
      options.limit !== undefined)
  )
    throw new CoreError(
      "INVALID_DATA",
      "format/detail/rendered/offset/limit apply to structured reading only.",
    );
  if (
    options.detail === "full" &&
    (options.offset !== undefined || options.limit !== undefined)
  )
    throw new CoreError(
      "INVALID_DATA",
      'offset/limit page the outline; use them without detail:"full".',
    );
  const current = await store.readPage(projectId, pageId);
  const captured = options.snapshotId
    ? await loadBoardSnapshot(store, projectId, pageId, options.snapshotId)
    : undefined;
  const record = captured
    ? {
        ...current,
        document: captured.document,
        hash: captured.snapshot.hash,
        revision: captured.snapshot.revision,
        path: captured.path,
      }
    : current;
  if (options.expectedHash && options.expectedHash !== record.hash)
    throw new CoreError(
      "CONFLICT",
      "The page changed since the preceding read. Read the current structured view before continuing.",
      { currentHash: record.hash },
    );
  // A default read of a large page answers with a window of its outline.
  const sourceBytes =
    options.view === "structured" &&
    options.detail === undefined &&
    !options.blockIds &&
    !options.out &&
    !options.snapshotId &&
    !options.actions.length &&
    options.rendered !== true
      ? Buffer.byteLength(JSON.stringify(record.document))
      : 0;
  const large = sourceBytes > DEFAULT_READ_BYTES;
  const detail =
    options.detail ??
    (large || options.offset !== undefined || options.limit !== undefined
      ? "outline"
      : "full");
  const document = options.blockIds
    ? selectDocumentBlocks(record.document, options.blockIds)
    : record.document;
  // Bound blocks read and render their shared data; `document` stays the stored source.
  const shared = await resolveDocumentDatasets(store, projectId, document, {
    includeProps: true,
    remember: true,
  });
  const resolved = shared.document;
  const resources = await describeResources(resolved);
  const sourceOnly =
    options.view === "structured" &&
    (detail === "outline" ||
      options.rendered === false ||
      !!options.snapshotId);
  if (sourceOnly && options.actions.length)
    throw new CoreError(
      "INVALID_DATA",
      "Source-only reading cannot execute actions.",
    );
  const components = sourceOnly
    ? []
    : await resolveDocumentComponents(store.root, resolved, projectId);
  const commentView = agentCommentView(record.document, options.blockIds);
  const identity: ReadIdentity = {
    ...(captured
      ? {
          snapshotId: options.snapshotId,
          sourceHash: captured.snapshot.sourceHash,
          currentHash: current.hash,
          currentSourceChanged: current.hash !== captured.snapshot.hash,
          capturedAt: captured.snapshot.createdAt,
          expiresAt: captured.snapshot.expiresAt,
          origin: captured.snapshot.origin,
        }
      : {}),
    projectId,
    pageId,
    title: record.document.title,
    hash: record.hash,
    ...(record.revision ? { revision: record.revision } : {}),
    view: options.view,
    ...(shared.bindings.length
      ? {
          bindings: shared.bindings,
          ...(datasetBasesFor(projectId, shared.bindings)
            ? { datasetBases: datasetBasesFor(projectId, shared.bindings) }
            : {}),
        }
      : {}),
    ...(resources.length ? { resources } : {}),
    ...(commentView ? { comments: commentView } : {}),
    partial: !!options.blockIds,
    ...(options.blockIds ? { blockIds: options.blockIds } : {}),
    componentRefs: sourceOnly
      ? collectCustomComponentRefs(document).map((ref) => ({
          id: ref.componentId,
          version: ref.version,
          ...(ref.integrity ? { integrity: ref.integrity } : {}),
        }))
      : components.map((component) => ({
          id: component.id,
          version: component.version,
          integrity: component.integrity,
        })),
  };
  const { out: _out, overwrite: _overwrite, ...state } = options;
  const content = structuredContent(resolved);
  if (options.view === "structured" && detail === "outline") {
    const window = outlineWindow(
      content.outline,
      resolved.content.attrs?.id,
      options.offset ?? 0,
      options.limit ?? (large ? LARGE_OUTLINE_BLOCKS : undefined),
    );
    const outlineMarkdown = `# ${identity.title}\n\n${window.outline.map((node) => `${"  ".repeat(node.depth)}- ${node.title || node.type} [${node.id}]`).join("\n")}`;
    const paging = {
      ...(window.paged
        ? {
            blockCount: window.blockCount,
            offset: options.offset ?? 0,
            ...(window.nextOffset !== undefined
              ? { nextOffset: window.nextOffset }
              : {}),
          }
        : {}),
      ...(large
        ? {
            omitted: {
              fields: ["document", "markdown", "computed"],
              reason: `The page source is ${Math.ceil(sourceBytes / 1024)} KiB, over the ${DEFAULT_READ_BYTES / 1024} KiB default read, so this read lists its outline${window.nextOffset !== undefined ? ` (top-level blocks ${options.offset ?? 0}–${window.nextOffset - 1} of ${window.blockCount})` : ""}.`,
              next: 'Read the blocks you need with blockIds (up to 100 ids from the outline), continue the outline with offset:nextOffset, or pass detail:"full" for the whole source in one reply; out writes it to a file on local connections.',
            },
          }
        : {}),
    };
    const result =
      options.format === "markdown"
        ? {
            ...identity,
            format: "markdown" as const,
            markdown: outlineMarkdown,
            outline: window.outline,
            ...paging,
          }
        : {
            ...identity,
            format: "outline" as const,
            outline: window.outline,
            ...paging,
          };
    if (options.out) {
      const target = await outputPath(
        store,
        projectId,
        options.out,
        options.overwrite,
      );
      await writeFile(
        target,
        options.format === "markdown"
          ? outlineMarkdown
          : JSON.stringify(result, null, 2),
      );
    }
    return result;
  }
  // A structured read renders only to obtain component readings, so it
  // renders just those components unless actions need the whole page.
  const readingBlocks =
    options.view === "structured" &&
    !options.blockIds &&
    !options.actions.length
      ? customBlocks(
          resolved,
          options.rendered === true
            ? components
            : components.filter((component) => component.reader === "readData"),
        )
      : undefined;
  const render =
    options.view !== "structured" ||
    options.actions.length > 0 ||
    (options.rendered !== false &&
      (options.blockIds
        ? options.rendered === true ||
          components.some((component) => component.reader === "readData")
        : !!readingBlocks?.length));
  const renderBlockIds = readingBlocks?.length
    ? readingBlocks
    : options.blockIds;
  let capture: ReadingCapture | undefined;
  let path: string | undefined;
  const generated = join(
    store.projectPath(projectId),
    "exports",
    "reads",
    `${pageId}-${record.hash.slice(0, 12)}-${randomUUID()}`,
  );
  if (render) {
    const locale = await appLocale(store.root);
    const html = previewHtml(
      await buildPageHtml(
        readingBlocks?.length
          ? selectDocumentBlocks(resolved, readingBlocks)
          : resolved,
        undefined,
        components,
        [],
        options.presentation,
        renderBlockIds ? { blockIds: renderBlockIds } : undefined,
        undefined,
      ),
      options,
      // The preview names the page, not this device's files.
      { ...identity, resources: undefined },
      locale,
    );
    path = await outputPath(
      store,
      projectId,
      options.view === "html" && options.out
        ? options.out
        : `${generated}.html`,
      options.overwrite,
    );
    await writeFile(path, html, "utf8");
    if (!(options.view === "html" && options.out))
      await recordReadingCache(store.root, path, html);
    capture = await renderReading(path, options, locale, {
      image: options.view !== "structured",
    });
  }
  const computed = capture?.components ?? [];
  const markdown =
    content.markdown +
    (computed.some((component) => component.status === "computed")
      ? `\n\n## 组件计算结果（派生字段）\n\n\`\`\`json\n${JSON.stringify(
          computed.filter((component) => component.status === "computed"),
          null,
          2,
        )}\n\`\`\``
      : "");
  if (options.view === "structured") {
    if (options.out) {
      const target = await outputPath(
        store,
        projectId,
        options.out,
        options.overwrite,
      );
      await writeFile(
        target,
        options.format === "markdown"
          ? markdown
          : JSON.stringify(
              { ...identity, document, outline: content.outline, computed },
              null,
              2,
            ),
      );
    }
    return options.format === "markdown"
      ? {
          ...identity,
          format: "markdown",
          markdown,
          outline: content.outline,
          computed,
        }
      : {
          ...identity,
          view: "structured",
          format: "json",
          document,
          path: record.path,
          markdown,
          outline: content.outline,
          computed,
        };
  }
  if (!capture || !path)
    throw new Error("A rendered reading did not produce a capture.");
  if (options.view === "image") {
    path = await outputPath(
      store,
      projectId,
      options.out ?? `${generated}.png`,
      options.overwrite,
    );
    await writeFile(path, capture.png);
  }
  const result = {
    ...identity,
    path,
    url: pathToFileURL(path).href,
    state,
    capturedAt: capture.capturedAt,
    reader: await renderedBy(),
    dom: capture.dom,
    computed,
    ...(options.view === "image"
      ? {
          image: {
            width: capture.width,
            height: capture.height,
            mimeType: "image/png" as const,
          },
        }
      : {}),
  };
  const metadataPath = await outputPath(
    store,
    projectId,
    `${path}.read.json`,
    options.overwrite,
  );
  await writeFile(metadataPath, JSON.stringify(result, null, 2));
  return { ...result, metadataPath };
}
