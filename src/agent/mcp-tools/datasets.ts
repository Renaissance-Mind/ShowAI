import { z } from "zod";
import type { ToolAction } from "../mcp-actions";
import { assertLocalPath, fileReceipt, inlineOrFile } from "../local-files";
import { readFile, writeFile } from "node:fs/promises";
import { CAPACITY } from "../../portable/capacity.mjs";
import { CoreError } from "../../core/model";
import { TRANSFORM_LIMITS } from "../../core/dataset-transform";
import { changeSchema, type ToolConnection, type ToolDeclaration } from "./tool";

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

/** Shared datasets: one value that several page blocks read and write. */
const recordQuerySchema = z
  .object({
    filter: z.record(z.string(), z.unknown()).optional(),
    sorts: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
    search: z.string().max(1000).optional(),
  })
  .strict();
/** dataset_read query: {filter?, sorts?, search?}; filter and sorts are checked by the record query. */
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
// Large values and operation lists can come from a JSON file on this device.
const filePath = z.string().min(1).max(4096).optional();

function readActions({
  service,
  projectId,
  call,
  localFiles,
}: ToolConnection): Record<string, ToolAction> {
  return {
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
          refresh: z.boolean().optional(),
          // Checked in the handler, so the listed schema stays small.
          query: jsonObject.optional(),
          ...(localFiles
            ? {
                out: z.string().min(1).max(4096).optional(),
                overwrite: z.boolean().optional(),
              }
            : {}),
        },
        run: ({
          datasetId,
          path,
          sinceHash,
          offset,
          limit,
          refresh,
          query,
          out,
          overwrite,
        }) =>
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
                refresh: refresh === true,
                ...(query ? { query: recordQueryInput(query) } : {}),
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
  };
}

function writeActions({
  service,
  projectId,
  call,
  localFiles,
}: ToolConnection): Record<string, ToolAction> {
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
  // Online data is not a file of this device, so every transport links it;
  // files (and copying a file's data back) need a local connection.
  actions.link = {
    fields: {
      ...changeSchema,
      datasetId: datasetId.optional(),
      ...(localFiles
        ? { path: z.union([z.string().min(1).max(4096), z.null()]).optional() }
        : {}),
      url: z.string().min(1).max(2048).optional(),
      format: z.enum(["json", "csv", "tsv", "xlsx"]).optional(),
      refreshSeconds: z.number().int().min(0).max(86_400).optional(),
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
      url,
      format,
      refreshSeconds,
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
            throw new CoreError(
              "INVALID_DATA",
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
          ...(path !== undefined ? { path: path as string } : {}),
          ...(url !== undefined ? { url: url as string } : {}),
          format: format as "json" | "csv" | "tsv" | "xlsx" | undefined,
          ...(refreshSeconds !== undefined
            ? { refreshSeconds: refreshSeconds as number }
            : {}),
          use: use as "file" | "dataset" | undefined,
          name: name as string | undefined,
          description: description as string | undefined,
          value,
          schema: schema as Record<string, unknown> | undefined,
        });
      }, metadata),
  };
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
  actions.transform = {
    fields: {
      ...changeSchema,
      datasetId: datasetId.optional(),
      baseHash: baseHash.optional(),
      name: datasetName.optional(),
      description: description.nullable().optional(),
      schema: jsonObject.nullable().optional(),
      inputs: transformInputs.optional(),
      script: z.string().min(1).max(TRANSFORM_LIMITS.scriptBytes).optional(),
      ...(localFiles ? { scriptFile: filePath } : {}),
      dryRun: z.boolean().optional(),
    },
    run: ({
      datasetId,
      baseHash,
      name,
      description,
      schema,
      inputs,
      script: inlineScript,
      scriptFile,
      dryRun,
      ...metadata
    }) =>
      call(async () => {
        if (scriptFile !== undefined && inlineScript !== undefined)
          throw new CoreError(
            "INVALID_DATA",
            "Pass script or scriptFile, not both.",
          );
        let script = inlineScript as string | undefined;
        if (scriptFile !== undefined) {
          const path = assertLocalPath(scriptFile, "scriptFile");
          const bytes = await readFile(path);
          if (bytes.length > TRANSFORM_LIMITS.scriptBytes)
            throw new CoreError(
              "INVALID_DATA",
              `scriptFile ${path} has more than ${TRANSFORM_LIMITS.scriptBytes} bytes.`,
            );
          script = bytes.toString("utf8");
        }
        const definition = {
          ...(inputs !== undefined
            ? { inputs: inputs as Record<string, string> }
            : {}),
          ...(script !== undefined ? { script } : {}),
        };
        if (dryRun === true)
          return service.datasetTryTransform(projectId, {
            ...(datasetId ? { datasetId: datasetId as string } : {}),
            ...definition,
          });
        // With baseHash, datasetId names the transform to change; otherwise the new one's id.
        return service.datasetTransform(projectId, {
          ...(datasetId
            ? baseHash
              ? { datasetId: datasetId as string }
              : { id: datasetId as string }
            : {}),
          ...(baseHash ? { baseHash: baseHash as string } : {}),
          ...(name !== undefined ? { name: name as string } : {}),
          ...(description !== undefined
            ? { description: description as string | null }
            : {}),
          ...(schema !== undefined
            ? { schema: schema as Record<string, unknown> | null }
            : {}),
          ...definition,
        });
      }, metadata),
  };
  return actions;
}

/** Shared datasets: one value that several page blocks read and write. */
export const datasetTools: ToolDeclaration[] = [
  {
    name: "dataset_read",
    access: "read",
    summary: ({
      localFiles,
    }) => `Read shared datasets: list them, or read one's value, hash, status (ok/stale/empty), editable, warnings and the pages using it; path (e.g. a[id=o1].b) narrows the value. refresh:true fetches online data now. sinceHash (e.g. from page_read datasetBases) returns record-level changes since then, paged with offset/limit. query {filter, sorts, search} reads a {columns, rows} value as records with derived values, filtered like a database view.${
      localFiles ? " out writes the value or comparison to a JSON file." : ""
    }`,
    actions: readActions,
  },
  {
    name: "dataset_write",
    access: "write",
    summary: ({
      localFiles,
    }) => `Change shared datasets (guide datasets). create: value, or fromBlock {pageId,blockId,baseHash} to share and bind a block's props. apply: read baseHash + operations {op:"set",path,value}, {op:"remove",path}, {op:"insert",path:list,value,after?}, {op:"move",path:item,after}; path selects records by id ([id=t1]). link url: online json/csv/tsv/xlsx, read-only. transform: read-only data from script "function transform(inputs, helpers)", inputs {name:datasetId}; dryRun:true runs it unsaved.${
      localFiles
        ? " link path: value in a local json/csv/tsv file (xlsx read-only); path:null copies it back. *File fields read from a file."
        : ""
    }`,
    actions: writeActions,
  },
  {
    name: "dataset_delete",
    access: "write",
    hints: { destructiveHint: true },
    description:
      "Delete a dataset that no block uses; otherwise fails with details.references.",
    input: () => ({
      ...changeSchema,
      datasetId: z.string().min(1),
      baseHash: z.string().min(1),
    }),
    run: ({ service, projectId, call }, { datasetId, baseHash, ...metadata }) =>
      call(
        () => service.datasetDelete(projectId, datasetId, baseHash),
        metadata,
      ),
  },
];
