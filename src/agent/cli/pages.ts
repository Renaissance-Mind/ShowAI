import { readFile } from "node:fs/promises";
import type { PageRecord } from "../../core/model";
import type { PageReadOptions } from "../page-reading";
import { compactData } from "../mcp-response";
import { pageStateReceipt } from "../page-receipt";
import type { BoardReadInput } from "../board-reading";
import {
  boardRead,
  pageApply,
  pageCreate,
  pageDuplicate,
  pageList,
  pageRead,
  pageSave,
  pageUpdate,
} from "../operations/pages";
import {
  hiddenFlag,
  hiddenText,
  option,
  requireCount,
  text,
  type CommandDeclaration,
} from "./command";
import {
  readDocument,
  readJson,
  readRevision,
  responseProfile,
} from "./inputs";

const documentFields = {
  document: "--input",
  components: "--input",
  remoteComponents: "--input",
};

/** Page reading and changes: pages *, boards read. */
export const pageCommands: CommandDeclaration[] = [
  {
    command: "boards",
    actions: ["read"],
    operation: boardRead,
    options: {
      state: text,
      board: text,
      snapshot: hiddenText,
      mode: hiddenText,
      node: hiddenText,
      tiles: hiddenText,
      tile: hiddenText,
      scale: hiddenText,
    },
    fields: {
      pageId: "PAGE",
      boardId: "--board",
      snapshotId: "--snapshot",
      mode: "--mode",
      nodeId: "--node",
      tileIds: "--tiles",
      tileId: "--tile",
      scale: "--scale",
    },
    help: [
      "boards read PAGE --project PROJECT [--board BOARD_NODE] [--state OPTIONS.json]",
    ],
    async input(args, { id }) {
      requireCount(args, 3);
      const state = option(args, "state");
      const input: BoardReadInput = state
        ? JSON.parse(await readFile(state, "utf8"))
        : {};
      const boardId = option(args, "board"),
        snapshotId = option(args, "snapshot"),
        mode = option(args, "mode"),
        nodeId = option(args, "node"),
        tiles = option(args, "tiles"),
        tileId = option(args, "tile"),
        scale = option(args, "scale");
      Object.assign(input, {
        ...(boardId ? { boardId } : {}),
        ...(snapshotId ? { snapshotId } : {}),
        ...(mode ? { mode } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(tiles ? { tileIds: tiles.split(",") } : {}),
        ...(tileId ? { tileId } : {}),
        ...(scale ? { scale: Number(scale) } : {}),
      });
      return { pageId: id, ...input };
    },
  },
  {
    command: "boards",
    actions: ["*"],
    async run() {
      throw new Error("Use boards read PAGE.");
    },
  },
  {
    command: "pages",
    actions: ["list"],
    operation: pageList,
    help: ["pages list --project PROJECT"],
    async input(args) {
      requireCount(args, 2);
      return {};
    },
  },
  {
    command: "pages",
    actions: ["create"],
    operation: pageCreate,
    options: { title: text, kind: text, input: text },
    fields: { title: "--title", kind: "--kind", ...documentFields },
    async input(args) {
      requireCount(args, 2);
      // An artifact file also carries its format and presentation; the page takes the rest.
      const artifact = option(args, "input")
        ? await readDocument(option(args, "input")!)
        : undefined;
      return {
        title: option(args, "title"),
        kind: option(args, "kind"),
        ...(artifact
          ? {
              document: artifact.document,
              components: artifact.components,
              remoteComponents: artifact.remoteComponents,
            }
          : {}),
      };
    },
  },
  {
    command: "pages",
    actions: ["read"],
    operation: pageRead,
    options: {
      view: text,
      blocks: text,
      format: text,
      detail: text,
      offset: text,
      limit: text,
      theme: text,
      width: text,
      height: text,
      out: text,
      state: text,
      references: text,
      presentation: hiddenText,
      rendered: hiddenText,
      snapshot: hiddenText,
      draft: hiddenFlag,
      overwrite: hiddenFlag,
      "base-hash": hiddenText,
    },
    fields: {
      pageId: "PAGE",
      view: "--view",
      format: "--format",
      detail: "--detail",
      offset: "--offset",
      limit: "--limit",
      blockIds: "--blocks",
      theme: "--theme",
      viewport: "--width/--height",
      presentation: "--presentation",
      actions: "--state",
      draft: "--draft",
      rendered: "--rendered",
      snapshotId: "--snapshot",
      expectedHash: "--base-hash",
      out: "--out",
      overwrite: "--overwrite",
      references: "--references",
    },
    help: [
      "pages read PAGE --project PROJECT [--view structured|image|html] [--blocks ID,ID]",
      "pages read PAGE --project PROJECT --format markdown [--detail full|outline] [--offset N --limit N]",
      "  A page source over 256 KiB reads as an outline window unless --detail full, --blocks or --out is given.",
      "pages read PAGE --project PROJECT --view image --theme dark --width 1000 --height 900 --out preview.png",
      "pages read PAGE --project PROJECT --view html [--state reading-state.json] --out preview.html",
      "pages read PAGE --project PROJECT --references to|from|both",
      "  Adds references: pages linking to this page (to, backlinks) and pages it links to (from),",
      "  each with the block holding the reference and the text around it.",
    ],
    async input(args, { id }) {
      requireCount(args, 3);
      const state = option(args, "state")
        ? await readJson(option(args, "state")!)
        : {};
      if (!state || typeof state !== "object" || Array.isArray(state))
        throw new Error(
          "--state must contain Page reading options such as actions, viewport and draft.",
        );
      const readOptions: PageReadOptions = { ...state };
      const view = option(args, "view");
      if (view) readOptions.view = view as PageReadOptions["view"];
      const format = option(args, "format");
      if (format) readOptions.format = format as PageReadOptions["format"];
      const detail = option(args, "detail");
      if (detail) readOptions.detail = detail as PageReadOptions["detail"];
      const references = option(args, "references");
      if (references) {
        if (!["to", "from", "both"].includes(references))
          throw new Error("--references must be to, from or both.");
        readOptions.references = references as PageReadOptions["references"];
      }
      const theme = option(args, "theme");
      if (theme) readOptions.theme = theme as PageReadOptions["theme"];
      const blocks = option(args, "blocks");
      if (blocks) readOptions.blockIds = blocks.split(",");
      for (const name of ["offset", "limit"] as const) {
        const value = option(args, name);
        if (value !== undefined) readOptions[name] = Number(value);
      }
      const width = option(args, "width"),
        height = option(args, "height");
      if (width || height)
        readOptions.viewport = {
          width: width ? Number(width) : (readOptions.viewport?.width ?? 1000),
          height: height
            ? Number(height)
            : (readOptions.viewport?.height ?? 900),
        };
      const presentation = option(args, "presentation");
      if (presentation)
        readOptions.presentation =
          presentation as PageReadOptions["presentation"];
      const rendered = option(args, "rendered");
      const snapshotId = option(args, "snapshot");
      if (snapshotId) readOptions.snapshotId = snapshotId;
      if (rendered) {
        if (!["true", "false"].includes(rendered))
          throw new Error("--rendered must be true or false.");
        readOptions.rendered = rendered === "true";
      }
      if (args.options.draft) readOptions.draft = true;
      if (args.options.overwrite) readOptions.overwrite = true;
      const out = option(args, "out");
      if (out) readOptions.out = out;
      const hash = option(args, "base-hash");
      if (hash) readOptions.expectedHash = hash;
      return { pageId: id, ...readOptions };
    },
  },
  {
    command: "pages",
    actions: ["save"],
    operation: pageSave,
    options: { input: text, "base-hash": text, "base-revision": text },
    fields: {
      pageId: "PAGE",
      baseHash: "--base-hash",
      baseRevision: "--base-revision",
      ...documentFields,
    },
    // Page changes reply with receipts, made after the transaction has recorded the revision.
    result(args) {
      const profile = responseProfile(args);
      return (value) => compactData(value, profile);
    },
    help: [
      "pages save PAGE --project PROJECT --input DOCUMENT.json --base-hash HASH [--base-revision REVISION] [--response receipt|source|full]",
    ],
    async input(args, { service, project, id }) {
      requireCount(args, 3);
      const input = await readDocument(option(args, "input", true)!);
      const projectId = await project();
      const baseHash = option(args, "base-hash", true)!;
      return {
        pageId: id,
        document: input.document,
        baseHash,
        components: input.components,
        remoteComponents: input.remoteComponents,
        baseRevision: await readRevision(service, args, projectId, id, baseHash),
      };
    },
  },
  {
    command: "pages",
    actions: ["apply"],
    operation: pageApply,
    options: { input: text, "base-hash": text, "base-revision": text },
    fields: {
      pageId: "PAGE",
      baseHash: "--base-hash",
      baseRevision: "--base-revision",
      operations: "--input",
      datasetBases: "--input",
    },
    result(args) {
      const profile = responseProfile(args);
      return (value) => compactData(value, profile);
    },
    help: [
      "pages apply PAGE --project PROJECT --input operations.json --base-hash HASH [--base-revision REVISION] [--response receipt|source|full]",
      "  In a versioned library --base-revision defaults to the revision returned by the last pages read with that hash.",
    ],
    async input(args, { service, project, id }) {
      requireCount(args, 3);
      const input = await readJson(option(args, "input", true)!);
      const operations = Array.isArray(input)
        ? input
        : input && typeof input === "object" && "operations" in input
          ? input.operations
          : undefined;
      if (!Array.isArray(operations))
        throw new Error(
          "Expected a JSON array of operations, or { operations: [...] }.",
        );
      const projectId = await project();
      const baseHash = option(args, "base-hash", true)!;
      return {
        pageId: id,
        baseHash,
        baseRevision: await readRevision(service, args, projectId, id, baseHash),
        operations,
        ...(input &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        "datasetBases" in input
          ? { datasetBases: input.datasetBases }
          : {}),
      };
    },
  },
  {
    command: "pages",
    actions: ["delete", "restore", "pin", "unpin"],
    operation: pageUpdate,
    options: { "base-hash": text, "base-revision": hiddenText },
    fields: {
      pageId: "PAGE",
      baseHash: "--base-hash",
      baseRevision: "--base-revision",
    },
    result: () => (value) => pageStateReceipt(value as PageRecord),
    help: ["pages delete|restore|pin|unpin PAGE --project PROJECT [--base-hash HASH]"],
    async input(args, { action, id }) {
      requireCount(args, 3);
      return {
        pageId: id,
        ...(action === "delete" || action === "restore"
          ? { archived: action === "delete" }
          : { pinned: action === "pin" }),
        baseHash: option(args, "base-hash"),
        baseRevision: option(args, "base-revision"),
      };
    },
  },
  {
    command: "pages",
    actions: ["duplicate"],
    operation: pageDuplicate,
    options: { title: text },
    fields: { pageId: "PAGE", title: "--title" },
    result: () => (value) => pageStateReceipt(value as PageRecord),
    help: ["pages duplicate PAGE --project PROJECT [--title TITLE]"],
    async input(args, { id }) {
      requireCount(args, 3);
      return { pageId: id, title: option(args, "title") };
    },
  },
  {
    command: "pages",
    actions: ["deleted"],
    help: [
      "pages deleted [--project PROJECT]   deleted projects, folders and pages that can be restored",
    ],
    async run(args, { service }) {
      requireCount(args, 2);
      const entries = await service.deletedEntries();
      const only = option(args, "project");
      return only
        ? {
            projects: entries.projects.filter((item) => item.id === only),
            folders: entries.folders.filter((item) => item.projectId === only),
            pages: entries.pages.filter((item) => item.projectId === only),
          }
        : entries;
    },
  },
  {
    command: "pages",
    actions: ["diff"],
    options: { since: text },
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      return service.diffPage(await project(), id, option(args, "since", true)!);
    },
  },
];
