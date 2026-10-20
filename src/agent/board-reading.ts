import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FileStore } from "../core/store";
import { CoreError } from "../core/model";
import {
  atomicLibraryFile,
  readLibraryBytes,
  safeLibraryPath,
} from "../core/library-files";
import { resolveDocumentComponents } from "../core/catalog";
import type { ShowDocument } from "../types";
import type { JSONContent } from "@tiptap/core";
import { validateDocument } from "../portable/validation.mjs";
import { CAPACITY, CapacityError } from "../portable/capacity.mjs";
import {
  findSurfaceNode,
  visitNodes,
  nodePaths,
  reconcileSurface,
} from "../surface/document.mjs";
import { buildPageHtml } from "./exporter";
import { injectReadingOptions } from "./reading-preview";
import {
  freezeBoard,
  renderFrozenBoard,
  type CapturedElement,
  type FrozenImageRequest,
  type FrozenBoard,
} from "./board-renderer";
import {
  boardGrid,
  boardTile,
  occupiedTiles,
  tileBatch,
  intersectRects,
  unionRects,
  imageToBoard,
  type BoardRect,
  type BoardGrid,
  type BoardTile,
} from "./board-reading-geometry";

const camera = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    scale: z.number().min(0.1).max(4),
  })
  .strict();
const rect = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive().finite(),
    height: z.number().positive().finite(),
  })
  .strict();
export const boardReadSchema = z
  .object({
    boardId: z.string().min(1).max(200).optional(),
    snapshotId: z.string().uuid().optional(),
    mode: z
      .enum(["visual", "tile", "region", "element", "source"])
      .default("visual"),
    tileIds: z
      .array(z.string().regex(/^T[1-9][0-9]*$/))
      .min(1)
      .max(8)
      .optional(),
    tileId: z
      .string()
      .regex(/^T[1-9][0-9]*$/)
      .optional(),
    nodeId: z.string().min(1).max(200).optional(),
    rectPx: rect.optional(),
    pointPx: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .optional(),
    detail: z.enum(["image", "source", "both"]).default("both"),
    imageScope: z.enum(["tile", "element"]).default("element"),
    scale: z.number().min(0.1).max(4).optional(),
    tilePixels: z
      .object({
        width: z.number().int().min(320).max(2048),
        height: z.number().int().min(320).max(2048),
      })
      .strict()
      .default({ width: 1600, height: 1600 }),
    overlapPixels: z.number().int().min(0).max(512).default(200),
    maxImages: z.number().int().min(1).max(8).default(8),
    cursor: z.number().int().min(0).default(0),
    pageOffset: z.number().int().min(0).default(0),
    pageLimit: z.number().int().min(1).max(500).default(200),
    elementOffset: z.number().int().min(0).default(0),
    elementLimit: z.number().int().min(1).max(1000).default(300),
    margin: z.number().min(0).max(256).default(24),
    theme: z.enum(["light", "dark"]).default("light"),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    state: z
      .object({
        cameras: z.record(z.string(), camera).optional(),
        pageScrolls: z
          .record(
            z.string(),
            z.object({ x: z.number().min(0), y: z.number().min(0) }).strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    draftDocument: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type BoardReadInput = z.input<typeof boardReadSchema>;
type Options = z.output<typeof boardReadSchema>;
interface IndexedElement extends CapturedElement {
  kind: string;
  title: string;
  /** Text shown inside a shape or on an arrow. */
  label?: string;
  parentPath: string[];
}
interface Snapshot {
  format: "showai-board-snapshot";
  version: 1;
  snapshotId: string;
  projectId: string;
  pageId: string;
  boardId: string;
  hash: string;
  revision?: string;
  sourceHash: string;
  createdAt: string;
  expiresAt: string;
  origin: "saved" | "provided-draft";
  title: string;
  bounds: BoardRect;
  grid: BoardGrid;
  scale: number;
  full: boolean;
  ranges: [number, number][];
  elements: IndexedElement[];
  pageIds: string[];
  nodeIds: string[];
  componentRefs: { id: string; version: string; integrity: string }[];
  warnings: string[];
  states: FrozenBoard["states"];
  htmlHash: string;
  documentHash: string;
}
export interface BoardImage {
  imageKey: string;
  path: string;
  mimeType: "image/png";
  pixelSize: { width: number; height: number };
  bounds: BoardRect;
  imageToBoard: number[];
  bytes: number;
  attachmentIndex?: number;
}
export interface BoardReadResult {
  protocol: "showai-board-reading-v1";
  projectId: string;
  pageId: string;
  boardId: string;
  snapshotId: string;
  hash: string;
  revision?: string;
  sourceHash: string;
  currentHash: string;
  currentSourceChanged: boolean;
  origin: Snapshot["origin"];
  title: string;
  capturedAt: string;
  expiresAt: string;
  mode: string;
  bounds: BoardRect;
  scale: number;
  images: BoardImage[];
  componentRefs: Snapshot["componentRefs"];
  warnings: string[];
  state: Snapshot["states"];
  tiles?: unknown[];
  elements?: unknown[];
  elementIndex?: unknown;
  pageIndex?: unknown[];
  pageCoverage?: unknown;
  coverage?: unknown;
  source?: unknown;
  candidates?: unknown[];
  partial?: boolean;
}
const TTL = 30 * 60 * 1000,
  CACHE_BYTES = 256 * 1024 * 1024,
  BATCH_BYTES = 24 * 1024 * 1024;
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const cacheRoot = (root: string) => join(root, "local", "board-read-cache");
const directory = (root: string, id: string) => join(cacheRoot(root), id);
async function ownedSnapshot(
  root: string,
  id: string,
): Promise<Snapshot | null> {
  const bytes = await readLibraryBytes(
    root,
    join(directory(root, id), "snapshot.json"),
  );
  if (!bytes) return null;
  const snapshot = JSON.parse(bytes.toString("utf8")) as Snapshot;
  if (
    snapshot.format !== "showai-board-snapshot" ||
    snapshot.version !== 1 ||
    snapshot.snapshotId !== id ||
    !Array.isArray(snapshot.elements) ||
    !Number.isFinite(Date.parse(snapshot.expiresAt))
  )
    throw new CoreError("INVALID_DATA", "Invalid Board snapshot metadata.");
  return snapshot;
}
/** Reclaim only expired, explicitly owned read caches. Current source files are never targets. */
export async function pruneBoardSnapshots(root: string) {
  await safeLibraryPath(root, cacheRoot(root));
  const names = await readdir(cacheRoot(root)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const live: { id: string; bytes: number; created: number }[] = [];
  for (const id of names) {
    if (!z.string().uuid().safeParse(id).success) continue;
    const snapshot = await ownedSnapshot(root, id);
    if (!snapshot) continue;
    if (Date.parse(snapshot.expiresAt) <= Date.now()) {
      await rm(await safeLibraryPath(root, directory(root, id)), {
        recursive: true,
      });
      continue;
    }
    let bytes = 0;
    for (const file of await readdir(directory(root, id)))
      bytes += (
        await stat(await safeLibraryPath(root, join(directory(root, id), file)))
      ).size;
    live.push({ id, bytes, created: Date.parse(snapshot.createdAt) });
  }
  return live.reduce((n, s) => n + s.bytes, 0);
}
async function writeCache(
  root: string,
  id: string,
  name: string,
  bytes: Buffer,
) {
  if (bytes.length > CACHE_BYTES)
    throw new CapacityError("Board snapshot file", bytes.length, CACHE_BYTES);
  await atomicLibraryFile(root, join(directory(root, id), name), bytes);
}
async function loadFile(
  root: string,
  snapshot: Snapshot,
  name: string,
  hash?: string,
) {
  const bytes = await readLibraryBytes(
    root,
    join(directory(root, snapshot.snapshotId), name),
  );
  if (!bytes)
    throw new CoreError(
      "SNAPSHOT_EXPIRED",
      "Board snapshot is unavailable. Read the Board again.",
    );
  if (hash && digest(bytes) !== hash)
    throw new CoreError(
      "INVALID_DATA",
      "The Board snapshot was changed externally. Read the Board again.",
    );
  return bytes;
}
export async function loadBoardSnapshot(
  store: FileStore,
  projectId: string,
  pageId: string,
  snapshotId: string,
) {
  z.string().uuid().parse(snapshotId);
  await store.readPage(projectId, pageId);
  const snapshot = await ownedSnapshot(store.root, snapshotId);
  if (!snapshot || Date.parse(snapshot.expiresAt) <= Date.now())
    throw new CoreError(
      "SNAPSHOT_EXPIRED",
      "Board snapshot expired or unavailable. Read the Board again.",
    );
  if (snapshot.projectId !== projectId || snapshot.pageId !== pageId)
    throw new CoreError(
      "INVALID_DATA",
      "This snapshot belongs to another project or Page.",
    );
  const document = JSON.parse(
    (
      await loadFile(store.root, snapshot, "source.json", snapshot.documentHash)
    ).toString("utf8"),
  ) as ShowDocument;
  return {
    snapshot,
    document,
    path: join(directory(store.root, snapshotId), "source.json"),
  };
}
function scopedBoard(document: ShowDocument, boardId: string) {
  const entry = findSurfaceNode(document, boardId);
  if (entry?.node.type !== "surface" || entry.node.attrs?.kind !== "board")
    throw new CoreError(
      "INVALID_DATA",
      "boardId must identify a native Board.",
    );
  const content = structuredClone(entry.node),
    ids = new Set<string>();
  visitNodes(content, (node) => {
    if (node.attrs?.id) ids.add(node.attrs.id);
  });
  const projection = {
    ...document,
    title: "",
    icon: "",
    content,
    layout: Object.fromEntries(
      Object.entries(document.layout ?? {}).filter(
        ([id]) => ids.has(id) && id !== boardId,
      ),
    ),
    surfaceViews: Object.fromEntries(
      Object.entries(document.surfaceViews ?? {}).filter(([id]) => ids.has(id)),
    ),
  };
  return {
    document: validateDocument(reconcileSurface(projection)),
    ids: [...ids],
  };
}
function nodeTitle(node: JSONContent) {
  return String(
    node.attrs?.name ??
      node.attrs?.data?.title ??
      node.attrs?.data?.props?.title ??
      node.type ??
      "element",
  ).slice(0, 200);
}
async function createSnapshot(
  store: FileStore,
  projectId: string,
  pageId: string,
  options: Options,
): Promise<Snapshot> {
  if (
    options.overlapPixels >=
    Math.min(options.tilePixels.width, options.tilePixels.height)
  )
    throw new CoreError(
      "INVALID_DATA",
      "overlapPixels must be smaller than each tile dimension.",
    );
  const record = await store.readPage(projectId, pageId);
  if (options.expectedHash && options.expectedHash !== record.hash)
    throw new CoreError(
      "CONFLICT",
      "The Page changed. Read the current source before capturing.",
    );
  const document = options.draftDocument
    ? validateDocument(options.draftDocument)
    : record.document;
  if (document.id !== pageId)
    throw new CoreError(
      "INVALID_DATA",
      "A draft capture must keep the Page resource identity.",
    );
  const boardId = options.boardId ?? document.content.attrs?.id;
  const scoped = scopedBoard(document, boardId);
  for (const [kind, values] of [
    ["board", options.state?.cameras],
    ["page", options.state?.pageScrolls],
  ] as const)
    for (const nodeId of Object.keys(values ?? {})) {
      const node = findSurfaceNode(scoped.document, nodeId)?.node;
      if (node?.type !== "surface" || node.attrs?.kind !== kind)
        throw new CoreError(
          "INVALID_DATA",
          `Capture state ${nodeId} must identify a ${kind} inside this Board.`,
        );
    }
  const components = await resolveDocumentComponents(
    store.root,
    scoped.document,
    projectId,
  );
  const id = randomUUID(),
    folder = directory(store.root, id);
  const source = JSON.stringify(document),
    sourceHash = digest(source);
  const cacheBytes = await pruneBoardSnapshots(store.root);
  if (cacheBytes + Buffer.byteLength(source) > CACHE_BYTES)
    throw new CapacityError(
      "Active Board snapshot caches",
      cacheBytes + Buffer.byteLength(source),
      CACHE_BYTES,
    );
  await safeLibraryPath(store.root, folder);
  await mkdir(folder, { recursive: true });
  let complete = false;
  try {
    const inputHtml = await buildPageHtml(
      scoped.document,
      undefined,
      components,
      [],
      "spatial",
    );
    const preview = injectReadingOptions(inputHtml, {
      theme: options.theme,
      draft: false,
      boardCapture: { boardId, ...options.state },
    });
    await writeCache(store.root, id, "capture.html", Buffer.from(preview));
    const frozen = await freezeBoard(
      join(folder, "capture.html"),
      boardId,
      scoped.ids,
      options.theme,
    );
    const paths = nodePaths(document);
    const elements = frozen.elements.map((el) => {
      const node = findSurfaceNode(document, el.nodeId)!.node;
      return {
        ...el,
        kind:
          node.type === "surface" ? node.attrs!.kind : (node.type ?? "unknown"),
        title: nodeTitle(node),
        ...(node.type === "drawing" && typeof node.attrs?.label === "string"
          ? { label: node.attrs.label.slice(0, 500) }
          : {}),
        parentPath: paths[el.nodeId] ?? [],
      };
    });
    const direct = elements.filter(
      (el) =>
        findSurfaceNode(document, el.nodeId)?.parent?.attrs?.id === boardId &&
        el.visibleBounds,
    );
    const bounds = unionRects(
        direct.map((el) => el.bounds),
        options.margin,
      ),
      scale = options.scale ?? 1;
    const grid = boardGrid(
      bounds,
      scale,
      options.tilePixels.width,
      options.tilePixels.height,
      options.overlapPixels,
    );
    let full =
      grid.width <= 2048 &&
      grid.height <= 2048 &&
      grid.width * grid.height <= 4 * 1024 * 1024;
    const ranges = occupiedTiles(
      grid,
      bounds,
      scale,
      direct.map((el) => el.bounds),
    );
    const pageIds: string[] = [];
    visitNodes(scoped.document.content, (node) => {
      if (node.type === "surface" && node.attrs?.kind === "page")
        pageIds.push(node.attrs.id);
    });
    await writeCache(store.root, id, "source.json", Buffer.from(source));
    await writeCache(store.root, id, "frozen.html", Buffer.from(frozen.html));
    // A detailed photograph can exceed the attachment limit even on a small Board.
    // Check the real PNG rather than estimating from geometry, then use tiles if needed.
    let fullImageBytes = 0;
    if (full) {
      const request = { key: "full", bounds, scale };
      const [image] = await renderFrozenBoard(join(folder, "frozen.html"), [
        request,
      ]);
      if (image.png.length > CAPACITY.mcpImageBytes) full = false;
      else {
        fullImageBytes = image.png.length;
        await writeCache(
          store.root,
          id,
          `image-${digest(JSON.stringify(request))}.png`,
          image.png,
        );
      }
    }
    const snapshot: Snapshot = {
      format: "showai-board-snapshot",
      version: 1,
      snapshotId: id,
      projectId,
      pageId,
      boardId,
      hash: record.hash,
      ...(record.revision ? { revision: record.revision } : {}),
      sourceHash,
      createdAt: frozen.capturedAt,
      expiresAt: new Date(Date.now() + TTL).toISOString(),
      origin: options.draftDocument ? "provided-draft" : "saved",
      title: record.document.title,
      bounds,
      grid,
      scale,
      full,
      ranges,
      elements,
      pageIds,
      nodeIds: scoped.ids,
      componentRefs: components.map((c) => ({
        id: c.id,
        version: c.version,
        integrity: c.integrity,
      })),
      warnings: frozen.warnings,
      states: frozen.states,
      htmlHash: digest(frozen.html),
      documentHash: sourceHash,
    };
    if (
      cacheBytes +
        Buffer.byteLength(source) +
        Buffer.byteLength(frozen.html) +
        fullImageBytes +
        Buffer.byteLength(JSON.stringify(snapshot)) >
      CACHE_BYTES
    )
      throw new CapacityError(
        "Active Board snapshot caches",
        cacheBytes +
          Buffer.byteLength(source) +
          Buffer.byteLength(frozen.html) +
          fullImageBytes +
          Buffer.byteLength(JSON.stringify(snapshot)),
        CACHE_BYTES,
      );
    await writeCache(
      store.root,
      id,
      "snapshot.json",
      Buffer.from(JSON.stringify(snapshot)),
    );
    await rm(await safeLibraryPath(store.root, join(folder, "capture.html")));
    complete = true;
    return snapshot;
  } finally {
    if (!complete)
      await rm(await safeLibraryPath(store.root, folder), {
        recursive: true,
        force: true,
      });
  }
}
function tileOf(snapshot: Snapshot, tileId: string) {
  return boardTile(
    snapshot.grid,
    snapshot.bounds,
    snapshot.scale,
    Number(tileId.slice(1)),
  );
}
function indexFor(
  snapshot: Snapshot,
  bounds: BoardRect,
  scale: number,
  offset: number,
  limit: number,
) {
  const all = snapshot.elements.flatMap((el) => {
    const visible =
      el.visibleBounds && intersectRects(el.visibleBounds, bounds);
    return visible
      ? [
          {
            nodeId: el.nodeId,
            kind: el.kind,
            title: el.title,
            ...(el.label ? { label: el.label } : {}),
            boundsInBoard: el.bounds,
            visibleBoundsInTile: {
              x: (visible.x - bounds.x) * scale,
              y: (visible.y - bounds.y) * scale,
              width: visible.width * scale,
              height: visible.height * scale,
            },
            parentPath: el.parentPath,
            partial:
              visible.width < el.bounds.width - 0.1 ||
              visible.height < el.bounds.height - 0.1,
            sourceRef: { nodeId: el.nodeId, snapshotId: snapshot.snapshotId },
          },
        ]
      : [];
  });
  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    nextOffset: offset + limit < all.length ? offset + limit : null,
  };
}
function rawNode(document: ShowDocument, snapshot: Snapshot, nodeId: string) {
  if (!snapshot.nodeIds.includes(nodeId))
    throw new CoreError("NOT_FOUND", "The node is outside the captured Board.");
  const node = findSurfaceNode(document, nodeId)!.node,
    ids = new Set<string>();
  visitNodes(node, (n) => {
    if (n.attrs?.id) ids.add(n.attrs.id);
  });
  const external = new Set<string>();
  visitNodes(node, (n) => {
    for (const binding of Object.values(n.attrs?.bindings ?? {}) as {
      targetId: string;
    }[])
      if (!ids.has(binding.targetId)) external.add(binding.targetId);
  });
  return {
    node: structuredClone(node),
    layout: Object.fromEntries(
      Object.entries(document.layout ?? {}).filter(([id]) => ids.has(id)),
    ),
    surfaceViews: Object.fromEntries(
      Object.entries(document.surfaceViews ?? {}).filter(([id]) => ids.has(id)),
    ),
    parentPath: nodePaths(document)[nodeId] ?? [],
    externalRefs: [...external],
    partial: true,
    complete: true,
  };
}
async function imagesFor(
  store: FileStore,
  snapshot: Snapshot,
  requests: FrozenImageRequest[],
): Promise<BoardImage[]> {
  const descriptors: BoardImage[] = [],
    missing: FrozenImageRequest[] = [];
  for (const request of requests) {
    const name = `image-${digest(JSON.stringify(request))}.png`,
      path = join(directory(store.root, snapshot.snapshotId), name);
    const existing = await readLibraryBytes(store.root, path);
    if (!existing) missing.push(request);
    descriptors.push({
      imageKey: request.key,
      path,
      mimeType: "image/png",
      pixelSize: {
        width: Math.max(1, Math.ceil(request.bounds.width * request.scale)),
        height: Math.max(1, Math.ceil(request.bounds.height * request.scale)),
      },
      bounds: request.bounds,
      imageToBoard: imageToBoard(request.bounds, request.scale),
      bytes: existing?.length ?? 0,
    });
  }
  if (missing.length) {
    await loadFile(store.root, snapshot, "frozen.html", snapshot.htmlHash);
    const rendered = await renderFrozenBoard(
      join(directory(store.root, snapshot.snapshotId), "frozen.html"),
      missing,
    );
    const liveBytes = await pruneBoardSnapshots(store.root);
    const newBytes = rendered.reduce((sum, image) => sum + image.png.length, 0);
    if (liveBytes + newBytes > CACHE_BYTES)
      throw new CapacityError(
        "Active Board snapshot caches",
        liveBytes + newBytes,
        CACHE_BYTES,
      );
    for (const image of rendered) {
      const descriptor = descriptors.find((d) => d.imageKey === image.key)!;
      if (image.png.length > CAPACITY.mcpImageBytes)
        throw new CapacityError(
          "Board PNG image",
          image.png.length,
          CAPACITY.mcpImageBytes,
        );
      await atomicLibraryFile(store.root, descriptor.path, image.png);
      descriptor.bytes = image.png.length;
    }
  }
  return descriptors;
}
export async function readBoard(
  store: FileStore,
  projectId: string,
  pageId: string,
  input: BoardReadInput = {},
): Promise<BoardReadResult> {
  const options = boardReadSchema.parse(input);
  if (!options.snapshotId && options.mode !== "visual")
    throw new CoreError(
      "INVALID_DATA",
      "Read the Board first, then supply snapshotId for detail queries.",
    );
  const loaded = options.snapshotId
    ? await loadBoardSnapshot(store, projectId, pageId, options.snapshotId)
    : null;
  const snapshot =
    loaded?.snapshot ??
    (await createSnapshot(store, projectId, pageId, options));
  if (options.boardId && options.boardId !== snapshot.boardId)
    throw new CoreError("INVALID_DATA", "snapshotId belongs to another Board.");
  const document =
    loaded?.document ??
    (JSON.parse(
      (
        await loadFile(
          store.root,
          snapshot,
          "source.json",
          snapshot.documentHash,
        )
      ).toString("utf8"),
    ) as ShowDocument);
  const current = await store.readPage(projectId, pageId);
  const result: BoardReadResult = {
    protocol: "showai-board-reading-v1",
    projectId,
    pageId,
    boardId: snapshot.boardId,
    snapshotId: snapshot.snapshotId,
    hash: snapshot.hash,
    revision: snapshot.revision,
    sourceHash: snapshot.sourceHash,
    currentHash: current.hash,
    currentSourceChanged: current.hash !== snapshot.hash,
    origin: snapshot.origin,
    title: snapshot.title,
    capturedAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    mode: options.mode,
    bounds: snapshot.bounds,
    scale: snapshot.scale,
    images: [],
    componentRefs: snapshot.componentRefs,
    warnings: snapshot.warnings,
    state: snapshot.states,
  };
  const allPages = snapshot.pageIds.map((nodeId) => {
    const node = findSurfaceNode(document, nodeId)!.node,
      element = snapshot.elements.find((e) => e.nodeId === nodeId);
    return {
      nodeId,
      resourceId: pageId,
      title: nodeTitle(node),
      parentPath: nodePaths(document)[nodeId] ?? [],
      bounds: element?.bounds ?? null,
      visible: !!element?.visibleBounds,
      sourceRef: { nodeId, snapshotId: snapshot.snapshotId },
    };
  });
  result.pageIndex = allPages.slice(
    options.pageOffset,
    options.pageOffset + options.pageLimit,
  );
  result.pageCoverage = {
    total: allPages.length,
    nextOffset:
      options.pageOffset + options.pageLimit < allPages.length
        ? options.pageOffset + options.pageLimit
        : null,
  };
  const requests: FrozenImageRequest[] = [],
    tiles: BoardTile[] = [];
  if (options.mode === "source") {
    result.source = rawNode(document, snapshot, snapshot.boardId);
    return result;
  }
  if (options.mode === "visual") {
    if (snapshot.full) {
      result.mode = "full";
      requests.push({
        key: "full",
        bounds: snapshot.bounds,
        scale: snapshot.scale,
      });
      result.coverage = {
        complete: true,
        totalTiles: 1,
        deliveredTileIds: [],
        nextCursor: null,
      };
    } else {
      result.mode = "tiled";
      if (options.cursor === 0 && !options.snapshotId)
        requests.push({
          key: "overview",
          bounds: snapshot.bounds,
          scale: Math.min(
            1,
            1200 / Math.max(snapshot.bounds.width, snapshot.bounds.height),
          ),
        });
      const batch = tileBatch(
        snapshot.ranges,
        options.cursor,
        options.maxImages - requests.length,
      );
      for (const n of batch.numbers) {
        const tile = boardTile(
          snapshot.grid,
          snapshot.bounds,
          snapshot.scale,
          n,
        );
        tiles.push(tile);
        requests.push({
          key: tile.tileId,
          bounds: tile.bounds,
          scale: snapshot.scale,
        });
      }
      result.coverage = {
        complete: batch.nextOffset === null,
        totalTiles: batch.total,
        gridTiles: snapshot.grid.total,
        emptyTiles: snapshot.grid.total - batch.total,
        deliveredTileIds: tiles.map((t) => t.tileId),
        nextCursor: batch.nextOffset,
        tilePixels: {
          width: snapshot.grid.tileWidth,
          height: snapshot.grid.tileHeight,
        },
        overlapPixels: snapshot.grid.overlap,
        grid: { rows: snapshot.grid.rows, columns: snapshot.grid.columns },
        occupiedRanges: snapshot.ranges,
      };
    }
  } else if (options.mode === "tile") {
    if (!options.tileIds?.length)
      throw new CoreError("INVALID_DATA", "Tile reading requires tileIds.");
    if (new Set(options.tileIds).size > options.maxImages)
      throw new CoreError(
        "INVALID_DATA",
        "tileIds exceeds maxImages; request fewer tiles.",
      );
    for (const id of new Set(options.tileIds)) {
      const tile = tileOf(snapshot, id);
      tiles.push(tile);
      requests.push({
        key: id,
        bounds: tile.bounds,
        scale: options.scale ?? snapshot.scale,
      });
    }
  } else if (options.mode === "region") {
    if (options.rectPx && options.pointPx)
      throw new CoreError("INVALID_DATA", "Choose either rectPx or pointPx.");
    if (!options.tileId || (!options.rectPx && !options.pointPx))
      throw new CoreError(
        "INVALID_DATA",
        "Region reading needs tileId and rectPx or pointPx.",
      );
    const tile = tileOf(snapshot, options.tileId),
      area = options.rectPx ?? {
        x: options.pointPx!.x - 6,
        y: options.pointPx!.y - 6,
        width: 12,
        height: 12,
      };
    const clipped = intersectRects(area, {
      x: 0,
      y: 0,
      width: tile.rectPx.width,
      height: tile.rectPx.height,
    });
    if (!clipped)
      throw new CoreError(
        "INVALID_DATA",
        "The requested region is outside this tile.",
      );
    const bounds = {
      x: tile.bounds.x + clipped.x / snapshot.scale,
      y: tile.bounds.y + clipped.y / snapshot.scale,
      width: clipped.width / snapshot.scale,
      height: clipped.height / snapshot.scale,
    };
    const candidates = snapshot.elements
      .filter(
        (el) => el.visibleBounds && intersectRects(el.visibleBounds, bounds),
      )
      .sort((a, b) => b.layerIndex - a.layerIndex);
    result.candidates = candidates.map((el) => ({
      nodeId: el.nodeId,
      kind: el.kind,
      title: el.title,
      ...(el.label ? { label: el.label } : {}),
      bounds: el.bounds,
      parentPath: el.parentPath,
      sourceRef: { nodeId: el.nodeId, snapshotId: snapshot.snapshotId },
    }));
    requests.push({
      key: `region:${options.tileId}`,
      bounds,
      scale: options.scale ?? snapshot.scale,
    });
  } else if (options.mode === "element") {
    if (!options.nodeId)
      throw new CoreError("INVALID_DATA", "Element reading requires nodeId.");
    const element = snapshot.elements.find(
      (el) => el.nodeId === options.nodeId,
    );
    if (
      options.tileId &&
      (!element?.visibleBounds ||
        !intersectRects(
          element.visibleBounds,
          tileOf(snapshot, options.tileId).bounds,
        ))
    )
      throw new CoreError(
        "INVALID_DATA",
        "This element is not visible in the requested tile.",
      );
    if (options.detail !== "image")
      result.source = rawNode(document, snapshot, options.nodeId);
    if (options.detail !== "source") {
      if (!element?.visibleBounds)
        throw new CoreError(
          "NOT_FOUND",
          "This element is not visible in the captured Board. Read its original source instead.",
        );
      let bounds = unionRects([element.bounds], options.margin);
      if (options.imageScope === "tile") {
        if (!options.tileId)
          throw new CoreError(
            "INVALID_DATA",
            "imageScope tile requires tileId.",
          );
        const clipped = intersectRects(
          bounds,
          tileOf(snapshot, options.tileId).bounds,
        );
        if (!clipped)
          throw new CoreError(
            "INVALID_DATA",
            "This element is not in the requested tile.",
          );
        bounds = clipped;
        result.partial = true;
      }
      const scale = options.scale ?? snapshot.scale;
      if (bounds.width * scale > 2048 || bounds.height * scale > 2048) {
        const grid = boardGrid(
          bounds,
          scale,
          snapshot.grid.tileWidth,
          snapshot.grid.tileHeight,
          snapshot.grid.overlap,
        );
        const batch = tileBatch(
          [[1, grid.total]],
          options.cursor,
          options.maxImages,
        );
        for (const n of batch.numbers) {
          const tile = boardTile(grid, bounds, scale, n);
          requests.push({
            key: `${options.nodeId}:${tile.tileId}`,
            bounds: tile.bounds,
            scale,
          });
        }
        result.coverage = {
          complete: batch.nextOffset === null,
          totalTiles: grid.total,
          nextCursor: batch.nextOffset,
        };
      } else requests.push({ key: `element:${options.nodeId}`, bounds, scale });
    }
  }
  result.tiles = tiles.map((tile) => ({
    ...tile,
    elementIndex: indexFor(
      snapshot,
      tile.bounds,
      options.scale ?? snapshot.scale,
      options.elementOffset,
      options.elementLimit,
    ),
  }));
  result.images = await imagesFor(store, snapshot, requests);
  let bytes = 0;
  const delivered: BoardImage[] = [];
  for (const image of result.images) {
    if (delivered.length && bytes + image.bytes > BATCH_BYTES) break;
    bytes += image.bytes;
    delivered.push({ ...image, attachmentIndex: delivered.length });
  }
  if (delivered.length < result.images.length) {
    const deliveredWindows = delivered.filter(
      (i) => i.imageKey !== "overview",
    ).length;
    const paginated =
      options.mode === "visual" ||
      (options.mode === "element" && !!result.coverage);
    result.coverage = {
      ...((result.coverage as object) ?? {}),
      complete: false,
      ...(paginated
        ? { nextCursor: options.cursor + deliveredWindows }
        : {
            remainingTileIds: requests
              .slice(delivered.length)
              .map((r) => r.key),
          }),
      byteBudget: BATCH_BYTES,
    };
  }
  result.images = delivered;
  const deliveredIds = new Set(delivered.map((i) => i.imageKey));
  result.tiles = result.tiles.filter((t) =>
    deliveredIds.has((t as BoardTile).tileId),
  );
  if (options.mode === "visual" && !snapshot.full)
    result.coverage = {
      ...(result.coverage as object),
      deliveredTileIds: result.tiles.map((t) => (t as BoardTile).tileId),
    };
  result.elementIndex =
    result.images.length === 1
      ? indexFor(
          snapshot,
          result.images[0].bounds,
          1 / result.images[0].imageToBoard[0],
          options.elementOffset,
          options.elementLimit,
        )
      : undefined;
  return result;
}
