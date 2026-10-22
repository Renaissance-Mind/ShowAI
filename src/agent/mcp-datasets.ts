import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AgentService } from "./service";
import { actionTool, type ToolAction } from "./mcp-actions";

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
    "Read shared datasets: list them, or read one's value, hash and the pages using it; path (e.g. a[id=o1].b) narrows the value.",
    {
      list: {
        fields: {},
        run: () => call(() => service.datasetList(projectId)),
      },
      read: {
        fields: { datasetId, path: path.optional() },
        run: ({ datasetId, path }) =>
          call(() =>
            service.datasetRead(projectId, datasetId as string, {
              path: path as z.infer<typeof path> | undefined,
            }),
          ),
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
  const actions: Record<string, ToolAction> = {
    create: {
      fields: {
        ...changeSchema,
        name: datasetName,
        datasetId: datasetId.optional(),
        description: description.optional(),
        value: z.unknown().optional(),
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
        schema,
        fromBlock,
        ...metadata
      }) =>
        call(
          () =>
            service.datasetCreate(projectId, {
              name: name as string,
              ...(datasetId ? { id: datasetId as string } : {}),
              description: description as string | undefined,
              value,
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
        operations: z.array(operation).max(5000),
        name: datasetName.optional(),
        description: description.nullable().optional(),
        schema: jsonObject.nullable().optional(),
      },
      run: ({
        datasetId,
        baseHash,
        operations,
        name,
        description,
        schema,
        ...metadata
      }) =>
        call(
          () =>
            service.datasetApply(projectId, datasetId as string, {
              baseHash: baseHash as string,
              operations: operations as z.infer<typeof operation>[],
              name: name as string | undefined,
              description: description as string | null | undefined,
              schema: schema as Record<string, unknown> | null | undefined,
            }),
          metadata,
        ),
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
        value,
        schema,
        baseHash,
        ...metadata
      }) =>
        call(() => {
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
        ? " link keeps the value in a .json/.csv/.tsv file outside the library; path:null copies it back."
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
