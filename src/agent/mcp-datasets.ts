import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AgentService } from "./service";

export const datasetTools = [
  "dataset_list",
  "dataset_read",
  "dataset_create",
  "dataset_apply",
  "dataset_link",
  "dataset_delete",
] as const;
export const datasetWriteTools = new Set<string>([
  "dataset_create",
  "dataset_apply",
  "dataset_link",
  "dataset_delete",
]);
/** Tools that read or write files of the connected device. */
export const datasetLocalTools = new Set<string>(["dataset_link"]);

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
) {
  register(
    "dataset_list",
    {
      description:
        "List the project's shared datasets (id, name, hash, size). Blocks on any page can bind to one; read guide datasets first.",
      inputSchema: {},
      annotations: annotations.readOnly,
    },
    () => call(() => service.datasetList(projectId)),
  );
  register(
    "dataset_read",
    {
      description:
        "Read a dataset's value, hash and the pages of this project whose blocks use it. path (e.g. objectives[id=o1].keyResults) narrows the value. Keep the hash for dataset_apply.",
      inputSchema: { datasetId: z.string().min(1), path: path.optional() },
      annotations: annotations.readOnly,
    },
    ({ datasetId, path }) =>
      call(() => service.datasetRead(projectId, datasetId, { path })),
  );
  register(
    "dataset_create",
    {
      description:
        "Create a dataset from a JSON value, or share an existing component block with fromBlock {pageId, blockId, baseHash, baseRevision?, local?}: its props move into the dataset (except local keys) and the block is bound to it in the same save.",
      inputSchema: {
        ...changeSchema,
        name: z.string().min(1).max(200),
        datasetId: z.string().min(1).max(128).optional(),
        description: z.string().max(4000).optional(),
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
      annotations: annotations.write,
    },
    ({ name, datasetId, description, value, schema, fromBlock, ...metadata }) =>
      call(
        () =>
          service.datasetCreate(projectId, {
            name,
            ...(datasetId ? { id: datasetId } : {}),
            description,
            value,
            schema,
            fromBlock,
          }),
        metadata,
      ),
  );
  register(
    "dataset_apply",
    {
      description:
        'Change a dataset with id-addressed operations and the baseHash you read: {op:"set",path,value}, {op:"remove",path}, {op:"insert",path:list,value,after?}, {op:"move",path:item,after}. Paths select records by id ({"id":"t1"} or [id=t1]). Changes since your read merge per record and field; a field changed differently by both returns CONFLICT with details.conflicts and writes nothing.',
      inputSchema: {
        ...changeSchema,
        datasetId: z.string().min(1),
        baseHash: z.string().min(1),
        operations: z.array(operation).max(5000),
        name: z.string().min(1).max(200).optional(),
        description: z.union([z.string().max(4000), z.null()]).optional(),
        schema: z.union([jsonObject, z.null()]).optional(),
      },
      annotations: annotations.write,
    },
    ({
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
          service.datasetApply(projectId, datasetId, {
            baseHash,
            operations,
            name,
            description,
            schema,
          }),
        metadata,
      ),
  );
  register(
    "dataset_link",
    {
      description:
        'Keep a dataset\'s value in a file outside the content library (.json any JSON value; .csv/.tsv as {columns, rows}). Without datasetId, create a dataset from an existing file, or with value write a new file. With datasetId, move the dataset\'s value into a new file (use "dataset"), replace it with an existing file (use "file"), or link this device\'s copy of an external dataset\'s file. path null copies the current file content into the library and stops reading the file (the file is kept). Files are never overwritten by linking; later writes to the dataset write the file. The link is per device; exports that embed such data need externalData "embed" after the person agrees (see guide datasets).',
      inputSchema: {
        ...changeSchema,
        datasetId: z.string().min(1).max(128).optional(),
        path: z.union([z.string().min(1).max(4096), z.null()]),
        format: z.enum(["json", "csv", "tsv"]).optional(),
        use: z.enum(["file", "dataset"]).optional(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(4000).optional(),
        value: z.unknown().optional(),
        schema: jsonObject.optional(),
        baseHash: z.string().min(1).optional(),
      },
      annotations: annotations.write,
    },
    ({
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
          return service.datasetEmbed(projectId, datasetId, baseHash);
        }
        return service.datasetLink(projectId, {
          ...(datasetId ? { datasetId } : {}),
          path,
          format,
          use,
          name,
          description,
          value,
          schema,
        });
      }, metadata),
  );
  register(
    "dataset_delete",
    {
      description:
        "Delete a dataset no block uses. While pages still bind to it the call fails with details.references; detach those blocks first with page_apply component.binding.remove.",
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
