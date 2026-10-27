import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AgentService } from "./service";
import { actionTool, type ToolAction } from "./mcp-actions";
import { assertLocalPath, fileReceipt, inlineOrFile } from "./local-files";
import { writeFile } from "node:fs/promises";
import { CAPACITY } from "../portable/capacity.mjs";
import { CoreError } from "../core/model";

export const datasetWriteTools = new Set<string>([
  "dataset_write",
  "dataset_delete",
]);

const jsonObject = z.record(z.string(), z.unknown());
const segment = z.union([
  z.string().min(1),
  z.number().int().min(0),
  z.object({ id: z.union([z.string().min(1), z.number()]) }).strict(),
]);
const path = z.union([z.array(segment).max(64), z.string().max(2000)]);
const operation = z
  .object({
    op: z.enum(["set", "remove", "insert", "move"]),
    path,
    value: z.unknown().optional(),
    before: z.unknown().optional(),
    absent: z.literal(true).optional(),
    after: z.union([z.string(), z.number(), z.null()]).optional(),
    index: z.number().int().min(0).optional(),
    from: z.union([z.string(), z.number(), z.null()]).optional(),
  })
  .strict();

type Call = (
  handler: () => Promise<unknown>,
  metadata?: { operationId?: string; message?: string; groupId?: string },
) => Promise<CallToolResult>;

/** Shared datasets: one value that several page blocks read and write. */
export function registerDatasetTools(
  register: McpServer["registerTool"],
  service: AgentService,
  projectId: string,
  call: Call,
  annotations: {
    readOnly: Record<string, boolean>;
    write: Record<string, boolean>;
  },
  changeSchema: z.ZodRawShape,
  /** Linking reads and writes files of the connected device. */
  localFiles: boolean,
) {
  const datasetId = z.string().min(1).max(128);
  const datasetName = z.string().min(1).max(200);
  const description = z.string().max(4000);
  const baseHash = z.string().min(1);
  const read = actionTool(
    `Read shared datasets: list them, or read one's value, hash and the pages using it; path (e.g. a[id=o1].b) narrows the value. sinceHash (a hash you read earlier, e.g. from page_read datasetBases) returns record-level changes since then instead, paged with offset/limit.${
      localFiles ? " out writes the value or comparison to a JSON file." : ""
    }`,
    {
      list: {
        fields: {},
        run: () => call(() => service.datasetList(projectId)),
      },
      read: {
        fields: {
          datasetId,
          path: path.optional(),
          sinceHash: z.string().min(1).optional(),
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(500).optional(),
          ...(localFiles
            ? {
                out: z.string().min(1).max(4096).optional(),
                overwrite: z.boolean().optional(),
              }
            : {}),
        },
        run: ({ datasetId, path, sinceHash, offset, limit, out, overwrite }) =>
          call(async () => {
            if (out !== undefined) assertLocalPath(out, "out");
            const result = await service.datasetRead(
              projectId,
              datasetId as string,
              {
                path: path as z.infer<typeof path> | undefined,
                sinceHash: sinceHash as string | undefined,
                offset: offset as number | undefined,
                limit: limit as number | undefined,
                full: out !== undefined,
              },
            );
            if (out === undefined) return result;
            // The value or comparison goes to the file; the reply keeps identity.
            await writeFile(String(out), JSON.stringify(result, null, 2), {
              flag: overwrite === true ? "w" : "wx",
            }).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "EEXIST")
                throw new CoreError(
                  "INVALID_PATH",
                  `out ${String(out)} already exists. Choose another path or pass overwrite:true.`,
                );
              throw error;
            });
            const record = result as Record<string, unknown> & {
              dataset: Record<string, unknown>;
            };
            const { value: _value, ...dataset } = record.dataset;
            return {
              dataset,
              hash: record.hash,
              ...(record.revision ? { revision: record.revision } : {}),
              ...("summary" in record ? { summary: record.summary } : {}),
              out: await fileReceipt(String(out)),
            };
          }),
      },
    },
  );
  register(
    "dataset_read",
    {
      description: read.description,
      inputSchema: read.inputSchema,
      annotations: annotations.readOnly,
    },
    read.handler,
  );
  // Large values and operation lists can come from a JSON file on this device.
  const filePath = z.string().min(1).max(4096).optional();
  const valueFile: z.ZodRawShape = localFiles ? { valueFile: filePath } : {};
  const operationsFile: z.ZodRawShape = localFiles
    ? { operationsFile: filePath }
    : {};
  const fileValue = (value: unknown, file: unknown) =>
    inlineOrFile({
      inline: value,
      inlineName: "value",
      file,
      fileName: "valueFile",
      limitBytes: CAPACITY.datasetBytes,
      localFiles,
    });
  const actions: Record<string, ToolAction> = {
    create: {
      fields: {
        ...changeSchema,
        name: datasetName,
        datasetId: datasetId.optional(),
        description: description.optional(),
        value: z.unknown().optional(),
        ...valueFile,
        schema: jsonObject.optional(),
        fromBlock: z
          .object({
            pageId: z.string().min(1),
            blockId: z.string().min(1),
            baseHash: z.string().min(1),
            baseRevision: z.string().optional(),
            local: z.array(z.string().min(1)).max(200).optional(),
          })
          .strict()
          .optional(),
      },
      run: ({
        name,
        datasetId,
        description,
        value,
        valueFile,
        schema,
        fromBlock,
        ...metadata
      }) =>
        call(
          async () =>
            service.datasetCreate(projectId, {
              name: name as string,
              ...(datasetId ? { id: datasetId as string } : {}),
              description: description as string | undefined,
              value: await fileValue(value, valueFile),
              schema: schema as Record<string, unknown> | undefined,
              fromBlock: fromBlock as Parameters<
                typeof service.datasetCreate
              >[1]["fromBlock"],
            }),
          metadata,
        ),
    },
    apply: {
      fields: {
        ...changeSchema,
        datasetId,
        baseHash,
        operations: localFiles
          ? z.array(operation).max(5000).optional()
          : z.array(operation).max(5000),
        ...operationsFile,
        name: datasetName.optional(),
        description: description.nullable().optional(),
        schema: jsonObject.nullable().optional(),
      },
      run: ({
        datasetId,
        baseHash,
        operations,
        operationsFile,
        name,
        description,
        schema,
        ...metadata
      }) =>
        call(async () => {
          const list = await inlineOrFile({
            inline: operations,
            inlineName: "operations",
            file: operationsFile,
            fileName: "operationsFile",
            limitBytes: CAPACITY.authoringRequestBytes,
            required: true,
            localFiles,
          });
          const parsed = z.array(operation).max(5000).safeParse(list);
          if (!parsed.success)
            throw new CoreError(
              "INVALID_DATA",
              `${operationsFile ? `operationsFile ${String(operationsFile)}` : "operations"}: ${parsed.error.issues
                .slice(0, 5)
                .map(
                  (issue) =>
                    `${issue.path.length ? `[${issue.path.join("].")}` : "value"} ${issue.message}`,
                )
                .join("; ")}`,
            );
          return service.datasetApply(projectId, datasetId as string, {
            baseHash: baseHash as string,
            operations: parsed.data,
            name: name as string | undefined,
            description: description as string | null | undefined,
            schema: schema as Record<string, unknown> | null | undefined,
          });
        }, metadata),
    },
  };
  if (localFiles)
    actions.link = {
      fields: {
        ...changeSchema,
        datasetId: datasetId.optional(),
        path: z.union([z.string().min(1).max(4096), z.null()]),
        format: z.enum(["json", "csv", "tsv"]).optional(),
        use: z.enum(["file", "dataset"]).optional(),
        name: datasetName.optional(),
        description: description.optional(),
        value: z.unknown().optional(),
        ...valueFile,
        schema: jsonObject.optional(),
        baseHash: baseHash.optional(),
      },
      run: ({
        datasetId,
        path,
        format,
        use,
        name,
        description,
        value: inlineValue,
        valueFile,
        schema,
        baseHash,
        ...metadata
      }) =>
        call(async () => {
          const value = await fileValue(inlineValue, valueFile);
          if (path === null) {
            if (!datasetId)
              throw new Error(
                "path null needs the datasetId to copy into the library.",
              );
            return service.datasetEmbed(
              projectId,
              datasetId as string,
              baseHash as string | undefined,
            );
          }
          return service.datasetLink(projectId, {
            ...(datasetId ? { datasetId: datasetId as string } : {}),
            path: path as string,
            format: format as "json" | "csv" | "tsv" | undefined,
            use: use as "file" | "dataset" | undefined,
            name: name as string | undefined,
            description: description as string | undefined,
            value,
            schema: schema as Record<string, unknown> | undefined,
          });
        }, metadata),
    };
  const write = actionTool(
    `Change shared datasets (guide datasets). create takes value, or fromBlock {pageId,blockId,baseHash} to move a block's props into the dataset and bind it. apply takes the read baseHash and operations {op:"set",path,value}, {op:"remove",path}, {op:"insert",path:list,value,after?}, {op:"move",path:item,after}; path segments select records by id ([id=t1]).${
      localFiles
        ? " link keeps the value in a .json/.csv/.tsv file outside the library; path:null copies it back. valueFile/operationsFile read value or operations from a JSON file."
        : ""
    }`,
    actions,
  );
  register(
    "dataset_write",
    {
      description: write.description,
      inputSchema: write.inputSchema,
      annotations: annotations.write,
    },
    write.handler,
  );
  register(
    "dataset_delete",
    {
      description:
        "Delete a dataset that no block uses; otherwise fails with details.references.",
      inputSchema: {
        ...changeSchema,
        datasetId: z.string().min(1),
        baseHash: z.string().min(1),
      },
      annotations: { ...annotations.write, destructiveHint: true },
    },
    ({ datasetId, baseHash, ...metadata }) =>
      call(
        () => service.datasetDelete(projectId, datasetId, baseHash),
        metadata,
      ),
  );
}
