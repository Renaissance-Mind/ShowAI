import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CAPACITY, CapacityError } from "../../portable/capacity.mjs";
import { validateDocument } from "../../portable/validation.mjs";
import type { CompiledComponent } from "../../contract/types";
import { CoreError, type PageOperation } from "../../core/model";
import type { PublishedComponentLocator } from "../../core/publication";
import {
  conversationHandoff,
  hostDisplay,
  mcpFailure,
  mcpSuccess,
  readerToolMeta,
  withConversation,
} from "../presentation-tools";
import { presentPage } from "../page-presentation";
import { pageReadSchema, type PageReadResult } from "../page-reading";
import { inlineReader, writePresentation } from "../presentation";
import { compactData, compactMcpResult } from "../mcp-response";
import { boardReadSchema, type BoardReadResult } from "../board-reading";
import { assertLocalPath, fileReceipt, inlineOrFile } from "../local-files";
import {
  DIFF_DEFAULT_LIMIT,
  DIFF_MAX_LIMIT,
  pageDiffView,
} from "../page-diff-view";
import { planImport, runImport } from "../import-service";
import { compactPlan, compactReport } from "../import-commands";
import { changeSchema, jsonObject, type ToolDeclaration } from "./tool";

// Capture tuning stays available to the service; agents use the defaults.
const boardTuning = {
  tilePixels: true,
  overlapPixels: true,
  maxImages: true,
  pageLimit: true,
  elementLimit: true,
  margin: true,
  imageScope: true,
  theme: true,
} as const;
const operationsSchema = z.array(jsonObject).max(1000);
const applyShape = {
  ...changeSchema,
  pageId: z.string(),
  baseHash: z.string().min(1),
  baseRevision: z.string().optional(),
  operations: operationsSchema.optional(),
  operationsFile: z.string().min(1).optional(),
  datasetBases: z.record(z.string(), z.string()).optional(),
  response: z.enum(["full", "source", "receipt"]).default("receipt"),
};
const { operationsFile: _operationsFile, ...remoteApplyShape } = applyShape;

/** Reading, creating, changing, comparing and exporting pages. */
export const pageTools: ToolDeclaration[] = [
  {
    name: "pages_list",
    access: "read",
    description: "List pages with titles, IDs and hashes.",
    input: () => ({ includeArchived: z.boolean().optional() }),
    run: ({ service, projectId, call }, { includeArchived }) =>
      call(() => service.store.listPages(projectId, { includeArchived })),
  },
  {
    name: "page_read",
    access: "read",
    description: ({ localFiles }) =>
      `Read a Page as structured JSON/Markdown (default), a PNG image, or html (DOM, accessibility tree and an interactive file; actions run interactions). detail:"outline" lists block IDs; blockIds selects blocks.${
        localFiles
          ? " out (absolute path) writes the source, markdown, image or html to a file and returns only its path, sha256, hash and revision."
          : ""
      }`,
    input: ({ localFiles }) => ({
      pageId: z.string().min(1),
      ...(localFiles
        ? pageReadSchema.shape
        : pageReadSchema.omit({ out: true, overwrite: true }).shape),
      response: z.enum(["full", "source", "receipt"]).default("full"),
    }),
    run: ({ service, projectId, call }, { pageId, response, ...readOptions }) =>
      call(async () => {
        const out = (readOptions as { out?: string }).out;
        if (out !== undefined) assertLocalPath(out, "out");
        return service.readPage(projectId, pageId, readOptions);
      }).then(async (result) => {
        if (!("data" in result.structuredContent)) return result;
        const data = result.structuredContent.data as PageReadResult;
        const out = (readOptions as { out?: string }).out;
        if (out !== undefined) {
          // The file holds the read; the conversation only gets its identity.
          const written = data.view === "structured" ? out : (data.path ?? out);
          const receipt: Record<string, unknown> = {
            ...(compactMcpResult(result, "receipt").structuredContent!
              .data as Record<string, unknown>),
            out: await fileReceipt(written),
            ...("metadataPath" in data && data.metadataPath
              ? { metadataPath: data.metadataPath }
              : {}),
          };
          delete receipt.path;
          return {
            ...result,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: true, data: receipt }),
              },
            ],
            structuredContent: { ok: true, data: receipt },
          };
        }
        if (data.view !== "image" || !data.path)
          return compactMcpResult(result, response);
        const png = await readFile(data.path);
        if (png.length > CAPACITY.mcpImageBytes) {
          const error = new CapacityError(
            "MCP PNG image",
            png.length,
            CAPACITY.mcpImageBytes,
          );
          error.message += " Read a smaller blockIds scope or viewport.";
          return mcpFailure(error);
        }
        return {
          ...compactMcpResult(result, response),
          content: [
            ...compactMcpResult(result, response).content,
            {
              type: "image" as const,
              mimeType: "image/png",
              data: png.toString("base64"),
            },
          ],
        };
      }),
  },
  {
    name: "board_read",
    access: "read",
    description:
      "Read a Board: a full image for small boards, otherwise an overview with overlapping tiles and element/Page indexes. Pass the returned snapshotId with mode tile/region/element/source for details. boardId selects a Board inside a Page.",
    input: () => ({
      pageId: z.string().min(1),
      ...boardReadSchema.omit(boardTuning).shape,
    }),
    run: ({ service, projectId, call }, { pageId, ...input }) =>
      call(() => service.readBoard(projectId, pageId, input)).then(
        async (result) => {
          if (!("data" in result.structuredContent)) return result;
          const data = result.structuredContent.data as BoardReadResult;
          const content: CallToolResult["content"] = [...result.content];
          for (const image of data.images) {
            const png = await readFile(image.path);
            if (png.length > CAPACITY.mcpImageBytes)
              return mcpFailure(
                new CapacityError(
                  "Board PNG image",
                  png.length,
                  CAPACITY.mcpImageBytes,
                ),
              );
            content.push({
              type: "text",
              text: JSON.stringify({
                imageKey: image.imageKey,
                attachmentIndex: image.attachmentIndex,
                pixelSize: image.pixelSize,
              }),
            });
            content.push({
              type: "image",
              mimeType: "image/png",
              data: png.toString("base64"),
            });
          }
          return { ...result, content };
        },
      ),
  },
  {
    name: "page_create",
    access: "write",
    hints: { openWorldHint: true },
    description: ({ localFiles }) =>
      `Create a Page or Board. Prefer blocks:[{kind,data}] in reading order, e.g. {kind:"text",data:{format:"markdown",content:"..."}}, and add more with page_apply component.insert.${
        localFiles
          ? " import:{source, importer?, dryRun?} imports a file, folder or zip path into parentId instead (guide import)."
          : ""
      }`,
    input: ({ localFiles }) => ({
      ...changeSchema,
      ...(localFiles
        ? {
            import: z
              .object({
                source: z.string().min(1),
                importer: z.string().min(1).optional(),
                dryRun: z.boolean().optional(),
              })
              .optional(),
          }
        : {}),
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
    }),
    run: (
      { service, projectId, call, withOpenLink },
      {
        title,
        kind,
        parentId,
        blocks,
        document,
        components,
        remoteComponents,
        import: importInput,
        ...metadata
      },
    ) =>
      call(async () => {
        if (importInput) {
          if (title ?? kind ?? blocks ?? document ?? components ?? remoteComponents)
            throw new CoreError(
              "INVALID_DATA",
              "import creates its own pages; pass only parentId with it.",
            );
          assertLocalPath(importInput.source, "import.source");
          const target = { projectId, parentId: parentId ?? null };
          const options = { importer: importInput.importer };
          return importInput.dryRun
            ? compactPlan(
                await planImport(service, { path: importInput.source }, target, options),
              )
            : compactReport(
                await runImport(service, { path: importInput.source }, target, options),
              );
        }
        return withOpenLink(
          await service.createPage(projectId, {
            title,
            kind,
            parentId,
            blocks,
            ...(document ? { document: validateDocument(document) } : {}),
            components: components as unknown as CompiledComponent[] | undefined,
            remoteComponents: remoteComponents as unknown as
              PublishedComponentLocator[] | undefined,
          }),
        );
      }, metadata),
  },
  {
    name: "page_save",
    access: "write",
    hints: { openWorldHint: true },
    description:
      'Save a full Page document with its baseHash; stale content returns CONFLICT. Replies with a receipt (hash, revision, changedBlocks); response:"source" adds the saved document.',
    input: () => ({
      ...changeSchema,
      pageId: z.string(),
      document: jsonObject,
      baseHash: z.string().min(1),
      baseRevision: z.string().optional(),
      components: z.array(jsonObject).max(100).optional(),
      remoteComponents: z.array(jsonObject).max(100).optional(),
      response: z.enum(["full", "source", "receipt"]).default("receipt"),
    }),
    run: (
      { service, projectId, call, withOpenLink },
      {
        pageId,
        document,
        baseHash,
        baseRevision,
        response,
        components,
        remoteComponents,
        ...metadata
      },
    ) =>
      call(
        async () =>
          compactData(
            await withOpenLink(
              await service.savePage(
                projectId,
                pageId,
                validateDocument(document),
                baseHash,
                components as unknown as CompiledComponent[] | undefined,
                remoteComponents as unknown as
                  PublishedComponentLocator[] | undefined,
                baseRevision,
              ),
            ),
            response,
          ),
        metadata,
      ),
  },
  {
    name: "page_apply",
    access: "write",
    description: ({ localFiles }) =>
      `Apply operations by stable block id with the Page's baseHash. Insert components with {type:"component.insert",kind,data,parentId?,afterId?}, change their data with {type:"component.props.set",blockId,props} and switch a custom component to another revision with {type:"component.ref.set",blockId,version,integrity,componentId?} (keeps id and props). Comment with {type:"comment",text,blockId?,quote?} or {type:"comment",threadId,text?,resolved?}; page_read returns open comments. Other operations: guide authoring. Replies with a receipt whose changedBlocks.added lists new block ids; response:"source" adds the document.${
        localFiles ? " operationsFile reads the operations array from a JSON file." : ""
      }`,
    // Hosted connections keep operations required and accept no device path.
    input: ({ localFiles }) =>
      localFiles ? applyShape : { ...remoteApplyShape, operations: operationsSchema },
    run: (
      { service, projectId, call, localFiles },
      {
        pageId,
        baseHash,
        baseRevision,
        operations,
        operationsFile,
        datasetBases,
        response,
        ...metadata
      },
    ) =>
      call(async () => {
        const list = await inlineOrFile({
          inline: operations as Record<string, unknown>[] | undefined,
          inlineName: "operations",
          file: operationsFile,
          fileName: "operationsFile",
          limitBytes: CAPACITY.authoringRequestBytes,
          required: true,
          localFiles,
        });
        const parsed = operationsSchema.safeParse(list);
        if (!parsed.success)
          throw new CoreError(
            "INVALID_DATA",
            `${operationsFile ? `operationsFile ${String(operationsFile)}` : "operations"} must be an array of at most 1000 operation objects: ${parsed.error.issues
              .slice(0, 5)
              .map(
                (issue) =>
                  `${issue.path.length ? `[${issue.path.join("].[")}]` : "value"} ${issue.message}`,
              )
              .join("; ")}`,
          );
        return compactData(
          await service.applyPage(projectId, pageId, {
            baseHash,
            baseRevision,
            operations: parsed.data as PageOperation[],
            datasetBases,
          }),
          response,
        );
      }, metadata),
  },
  {
    name: "page_diff",
    access: "read",
    description: ({ localFiles }) =>
      `Compare a Page with an earlier read hash or revision: one entry per record-level change (lists of records by id), long values summarized, paged with offset/nextOffset; blockIds narrows it.${
        localFiles ? " out writes every entry unabridged to a JSON file." : ""
      }`,
    input: ({ localFiles }) => ({
      pageId: z.string(),
      sinceHash: z.string().min(1),
      blockIds: z.array(z.string().min(1)).min(1).max(200).optional(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(DIFF_MAX_LIMIT).optional(),
      ...(localFiles
        ? {
            out: z.string().min(1).optional(),
            overwrite: z.boolean().optional(),
          }
        : {}),
    }),
    run: (
      { service, projectId, call },
      { pageId, sinceHash, blockIds, offset, limit, out, overwrite },
    ) =>
      call(async () => {
        if (out !== undefined) assertLocalPath(out, "out");
        const { diff, entries, current } = await service.diffPageEntries(
          projectId,
          pageId,
          sinceHash,
        );
        if (out === undefined)
          return pageDiffView(diff, entries, {
            blockIds,
            offset,
            limit: limit ?? DIFF_DEFAULT_LIMIT,
            current,
          });
        const full = pageDiffView(diff, entries, {
          blockIds,
          limit: Number.MAX_SAFE_INTEGER,
          full: true,
          current,
        });
        await writeFile(String(out), JSON.stringify(full, null, 2), {
          flag: overwrite ? "w" : "wx",
        }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "EEXIST")
            throw new CoreError(
              "INVALID_PATH",
              `out ${String(out)} already exists. Choose another path or pass overwrite:true.`,
            );
          throw error;
        });
        const { changes: _changes, ...receipt } = full;
        return {
          ...receipt,
          nextOffset: null,
          out: await fileReceipt(String(out)),
        };
      }),
  },
  {
    name: "page_export",
    access: "write",
    description:
      "Export a Page as HTML, an inline conversation fragment or a static site at out; blockIds exports part of it. Files of this device (or data computed from them) return CONFIRMATION_REQUIRED with details.packaging (items, sizes, choices); repeat with packaging {itemId: choice} after the person decides.",
    input: () => ({
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
    }),
    run: (
      { service, projectId, call },
      {
        pageId,
        blockIds,
        format,
        components,
        reader,
        out,
        overwrite,
        presentation,
        packaging,
        externalData,
      },
    ) =>
      call(() =>
        service.export({
          projectId,
          pageId,
          blockIds,
          format,
          components,
          reader,
          out,
          overwrite,
          presentation,
          packaging,
          externalData,
        }),
      ),
  },
];

/** Presents a saved page in the conversation; registered after the other project tools. */
export const pagePresentTool: ToolDeclaration = {
  name: "page_present",
  access: "read",
  meta: readerToolMeta,
  description:
    "Present a saved Page, or selected blocks inline, and return host delivery references. display.reader is the inline preview's reader; readerReason says why it loads from the CDN. externalSnapshots lists embedded data from files outside the library; get the person's agreement before sharing those files.",
  input: () => ({
    pageId: z.string().min(1),
    blockIds: z.array(z.string().min(1)).min(1).optional(),
  }),
  async run({ service, projectId, options, withOpenLink }, { pageId, blockIds }) {
    try {
      const value = await presentPage({
        root: service.store.root,
        projectId,
        pageId,
        blockIds,
      });
      const delivery = options.storeProjectPresentation
        ? await options.storeProjectPresentation(value)
        : (
            await writePresentation(
              value,
              join(
                options.presentationDirectory ??
                  join(service.store.root, "local", "agent-previews"),
                randomUUID(),
                "page.html",
              ),
            )
          ).delivery;
      const location = (await withOpenLink({}, value.pageId)) as {
        projectName?: string;
        openUrl?: string;
      };
      return {
        ...mcpSuccess({
          title: value.title,
          pageId: value.pageId,
          projectId,
          ...location,
          hash: value.hash,
          revision: value.revision,
          delivery,
          bytes: value.bytes,
          persistence: value.persistence,
          synchronization: { state: "not_checked" },
          display: {
            resourceAttached: true,
            inlineAvailable: !!value.inline,
            ...inlineReader(value),
            onlineAvailable: !!value.online,
            compactAvailable: !!value.compact,
            fullPageAvailable: true,
            ...(blockIds ? { blockIds } : {}),
          },
          ...(value.inlineError ? { inlineError: value.inlineError } : {}),
          ...withConversation(
            conversationHandoff(
              value.compact,
              blockIds,
              options.presentation?.hostDisplay ?? hostDisplay(),
              "page_present",
              !!value.online,
            ),
          ),
          ...(value.externalSnapshots
            ? { externalSnapshots: value.externalSnapshots }
            : {}),
        }),
        _meta: {
          showai: {
            inline: value.inline,
            inlineError: value.inlineError,
            delivery,
          },
        },
      };
    } catch (error) {
      return mcpFailure(error);
    }
  },
};
