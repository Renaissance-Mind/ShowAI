import { z } from "zod";
import { validateDocument } from "../../portable/validation.mjs";
import type { CompiledComponent } from "../../contract/types";
import type { PageOperation } from "../../core/model";
import type { PublishedComponentLocator } from "../../core/publication";
import type { PackagingChoice } from "../../core/packaging";
import { pageReadSchema } from "../page-reading";
import { boardReadSchema } from "../board-reading";
import { operation } from "./operation";

// Pages: list, read, create, save, apply, export, archive or pin, duplicate;
// boards: read. Shared by the CLI (pages *, boards read, export) and MCP
// (pages_list, page_*, board_read, organization_update page actions).

const jsonObject = z.record(z.string(), z.unknown());
const entryId = z.string().min(1).max(128);
const entryName = z.string().trim().min(1).max(1000);
export const pageOperationsSchema = z.array(jsonObject).max(1000);

export const pageList = operation({
  id: "page.list",
  access: "read",
  input: { includeArchived: z.boolean().optional() },
  run: ({ service, projectId }, { includeArchived }) =>
    service.store.listPages(projectId, { includeArchived }),
});

export const pageRead = operation({
  id: "page.read",
  access: "read",
  input: { pageId: z.string().min(1), ...pageReadSchema.shape },
  run: ({ service, projectId }, { pageId, ...options }) =>
    service.readPage(projectId, pageId, options),
});

export const boardRead = operation({
  id: "board.read",
  access: "read",
  input: { pageId: z.string().min(1), ...boardReadSchema.shape },
  run: ({ service, projectId }, { pageId, ...options }) =>
    service.readBoard(projectId, pageId, options),
});

export const pageCreate = operation({
  id: "page.create",
  access: "write",
  input: {
    title: z.string().optional(),
    kind: z.enum(["page", "board"]).optional(),
    parentId: z.string().min(1).nullable().optional(),
    blocks: z
      .array(z.object({ kind: z.string().min(1), data: jsonObject }))
      .max(100)
      .optional(),
    document: jsonObject.optional(),
    components: z.array(jsonObject).max(100).optional(),
    remoteComponents: z.array(jsonObject).max(100).optional(),
  },
  run: (
    { service, projectId },
    { title, kind, parentId, blocks, document, components, remoteComponents },
  ) =>
    service.createPage(projectId, {
      title,
      kind,
      parentId,
      blocks,
      ...(document ? { document: validateDocument(document) } : {}),
      components: components as unknown as CompiledComponent[] | undefined,
      remoteComponents: remoteComponents as unknown as
        PublishedComponentLocator[] | undefined,
    }),
});

export const pageSave = operation({
  id: "page.save",
  access: "write",
  input: {
    pageId: z.string(),
    document: jsonObject,
    baseHash: z.string().min(1),
    baseRevision: z.string().optional(),
    components: z.array(jsonObject).max(100).optional(),
    remoteComponents: z.array(jsonObject).max(100).optional(),
  },
  run: (
    { service, projectId },
    { pageId, document, baseHash, baseRevision, components, remoteComponents },
  ) =>
    service.savePage(
      projectId,
      pageId,
      validateDocument(document),
      baseHash,
      components as unknown as CompiledComponent[] | undefined,
      remoteComponents as unknown as PublishedComponentLocator[] | undefined,
      baseRevision,
    ),
});

export const pageApply = operation({
  id: "page.apply",
  access: "write",
  input: {
    pageId: z.string(),
    baseHash: z.string().min(1),
    baseRevision: z.string().optional(),
    operations: pageOperationsSchema,
    datasetBases: z.record(z.string(), z.string()).optional(),
  },
  run: (
    { service, projectId },
    { pageId, baseHash, baseRevision, operations, datasetBases },
  ) =>
    service.applyPage(projectId, pageId, {
      baseHash,
      baseRevision,
      operations: operations as PageOperation[],
      // The CLI leaves the key out unless the input file has it.
      ...(datasetBases ? { datasetBases } : {}),
    }),
});

export const pageExport = operation({
  id: "page.export",
  access: "write",
  input: {
    pageId: z.string().optional(),
    blockIds: z.array(z.string().min(1)).min(1).optional(),
    format: z.enum(["html", "inline", "site"]),
    presentation: z.enum(["spatial", "reading"]).optional(),
    components: z.enum(["bundled", "remote"]).optional(),
    reader: z.enum(["bundled", "cdn"]).optional(),
    out: z.string().min(1),
    overwrite: z.boolean().optional(),
    packaging: z
      .record(
        z.string(),
        z.enum(["bundle", "skip", "keep-url", "result", "inputs", "both", "embed"]),
      )
      .optional(),
    externalData: z.literal("embed").optional(),
    // The CLI also exports an earlier revision or an imported snapshot.
    revision: z.string().optional(),
    importedSnapshot: z
      .object({ importId: z.string(), snapshotId: z.string() })
      .optional(),
  },
  run: ({ service, projectId }, input) =>
    service.export({
      projectId,
      ...input,
      packaging: input.packaging as Record<string, PackagingChoice> | undefined,
    }),
});

export const pageUpdate = operation({
  id: "page.update",
  access: "write",
  input: {
    pageId: entryId,
    archived: z.boolean().optional(),
    pinned: z.boolean().optional(),
    baseHash: z.string().min(1).optional(),
    baseRevision: z.string().min(1).optional(),
  },
  run: (
    { service, projectId },
    { pageId, archived, pinned, baseHash, baseRevision },
  ) =>
    service.updatePage(
      projectId,
      pageId,
      { archived, pinned },
      { baseHash, baseRevision },
    ),
});

export const pageDuplicate = operation({
  id: "page.duplicate",
  access: "write",
  input: { pageId: entryId, title: entryName.optional() },
  run: ({ service, projectId }, { pageId, title }) =>
    service.duplicatePage(projectId, pageId, title),
});
