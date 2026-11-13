import { z } from "zod";
import { CoreError } from "../../core/model";
import { TRANSFORM_LIMITS } from "../../core/dataset-transform";
import type { AgentService } from "../service";
import { operation } from "./operation";

// Shared datasets: one value that several page blocks read and write.
// Shared by the CLI (datasets *) and MCP (dataset_read, dataset_write,
// dataset_delete). Reading files of the device stays with each entry.

const jsonObject = z.record(z.string(), z.unknown());
const segment = z.union([
  z.string().min(1),
  z.number().int().min(0),
  z.object({ id: z.union([z.string().min(1), z.number()]) }).strict(),
]);
const path = z.union([z.array(segment).max(64), z.string().max(2000)]);
export const datasetOperation = z
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
export const datasetOperations = z.array(datasetOperation).max(5000);

const recordQuerySchema = z
  .object({
    filter: z.record(z.string(), z.unknown()).optional(),
    sorts: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
    search: z.string().max(1000).optional(),
  })
  .strict();
/** dataset read query: {filter?, sorts?, search?}; filter and sorts are checked by the record query. */
function recordQueryInput(value: unknown) {
  const result = recordQuerySchema.safeParse(value);
  if (!result.success)
    throw new CoreError(
      "INVALID_DATA",
      result.error.issues
        .map(
          (issue) =>
            `query${issue.path.map((part) => `.${String(part)}`).join("")} ${issue.message}`,
        )
        .join("; "),
    );
  return result.data as { filter?: unknown; sorts?: unknown; search?: string };
}

const datasetId = z.string().min(1).max(128);
const datasetName = z.string().min(1).max(200);
const description = z.string().max(4000);
const baseHash = z.string().min(1);
const transformInputs = z
  .record(
    z.string().min(1).max(64),
    z.union([
      datasetId,
      z.object({ project: datasetId, dataset: datasetId }).strict(),
    ]),
  )
  .refine(
    (inputs) =>
      Object.keys(inputs).length >= 1 &&
      Object.keys(inputs).length <= TRANSFORM_LIMITS.maxInputs,
    `1–${TRANSFORM_LIMITS.maxInputs} inputs`,
  );

export const datasetList = operation({
  id: "dataset.list",
  access: "read",
  input: {},
  run: ({ service, projectId }) => service.datasetList(projectId),
});

export const datasetRead = operation({
  id: "dataset.read",
  access: "read",
  input: {
    datasetId,
    path: path.optional(),
    sinceHash: z.string().min(1).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    refresh: z.boolean().optional(),
    // Checked in run, so the listed schema stays small.
    query: jsonObject.optional(),
    /** The whole value or comparison, for an entry that writes it to a file. */
    full: z.boolean().optional(),
  },
  run: (
    { service, projectId },
    { datasetId, path, sinceHash, offset, limit, refresh, query, full },
  ) =>
    service.datasetRead(projectId, datasetId, {
      path,
      sinceHash,
      offset,
      limit,
      full,
      refresh: refresh === true,
      ...(query ? { query: recordQueryInput(query) } : {}),
    }),
});

export const datasetCreate = operation({
  id: "dataset.create",
  access: "write",
  input: {
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
  run: (
    { service, projectId },
    { name, datasetId, description, value, schema, fromBlock },
  ) =>
    service.datasetCreate(projectId, {
      name,
      ...(datasetId ? { id: datasetId } : {}),
      description,
      value,
      schema,
      fromBlock,
    }),
});

export const datasetApply = operation({
  id: "dataset.apply",
  access: "write",
  input: {
    datasetId,
    baseHash,
    operations: datasetOperations,
    name: datasetName.optional(),
    description: description.nullable().optional(),
    schema: jsonObject.nullable().optional(),
  },
  run: (
    { service, projectId },
    { datasetId, baseHash, operations, name, description, schema },
  ) =>
    service.datasetApply(projectId, datasetId, {
      baseHash,
      operations,
      name,
      description,
      schema,
    }),
});

export const datasetLink = operation({
  id: "dataset.link",
  access: "write",
  input: {
    datasetId: datasetId.optional(),
    /** A file of this device; null copies a linked value back into the library. */
    path: z.union([z.string().min(1).max(4096), z.null()]).optional(),
    url: z.string().min(1).max(2048).optional(),
    format: z.enum(["json", "csv", "tsv", "xlsx"]).optional(),
    refreshSeconds: z.number().int().min(0).max(86_400).optional(),
    use: z.enum(["file", "dataset"]).optional(),
    name: datasetName.optional(),
    description: description.optional(),
    value: z.unknown().optional(),
    schema: jsonObject.optional(),
    baseHash: baseHash.optional(),
  },
  run: (
    { service, projectId },
    {
      datasetId,
      path,
      url,
      format,
      refreshSeconds,
      use,
      name,
      description,
      value,
      schema,
      baseHash,
    },
  ) => {
    if (path === null) {
      if (!datasetId)
        throw new CoreError(
          "INVALID_DATA",
          "path null needs the datasetId to copy into the library.",
        );
      return service.datasetEmbed(projectId, datasetId, baseHash);
    }
    return service.datasetLink(projectId, {
      ...(datasetId ? { datasetId } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(url !== undefined ? { url } : {}),
      format,
      ...(refreshSeconds !== undefined ? { refreshSeconds } : {}),
      use,
      name,
      description,
      value,
      schema,
    } as Parameters<AgentService["datasetLink"]>[1]);
  },
});

export const datasetTransform = operation({
  id: "dataset.transform",
  access: "write",
  input: {
    datasetId: datasetId.optional(),
    baseHash: baseHash.optional(),
    name: datasetName.optional(),
    description: description.nullable().optional(),
    schema: jsonObject.nullable().optional(),
    inputs: transformInputs.optional(),
    script: z.string().min(1).max(TRANSFORM_LIMITS.scriptBytes).optional(),
    dryRun: z.boolean().optional(),
  },
  run: (
    { service, projectId },
    { datasetId, baseHash, name, description, schema, inputs, script, dryRun },
  ) => {
    const definition = {
      ...(inputs !== undefined
        ? { inputs: inputs as Record<string, string> }
        : {}),
      ...(script !== undefined ? { script } : {}),
    };
    if (dryRun === true)
      return service.datasetTryTransform(projectId, {
        ...(datasetId ? { datasetId } : {}),
        ...definition,
      });
    // With baseHash, datasetId names the transform to change; otherwise the new one's id.
    return service.datasetTransform(projectId, {
      ...(datasetId ? (baseHash ? { datasetId } : { id: datasetId }) : {}),
      ...(baseHash ? { baseHash } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(schema !== undefined ? { schema } : {}),
      ...definition,
    });
  },
});

export const datasetDelete = operation({
  id: "dataset.delete",
  access: "write",
  input: { datasetId: z.string().min(1), baseHash: z.string().min(1) },
  run: ({ service, projectId }, { datasetId, baseHash }) =>
    service.datasetDelete(projectId, datasetId, baseHash),
});
