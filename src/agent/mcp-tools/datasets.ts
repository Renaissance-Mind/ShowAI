import { z } from "zod";
import type { ToolAction } from "../mcp-actions";
import { assertLocalPath, fileReceipt, inlineOrFile } from "../local-files";
import { readFile, writeFile } from "node:fs/promises";
import { CAPACITY } from "../../portable/capacity.mjs";
import { CoreError } from "../../core/model";
import { TRANSFORM_LIMITS } from "../../core/dataset-transform";
import { pick, type OperationContext } from "../operations/operation";
import {
  datasetApply,
  datasetCreate,
  datasetDelete,
  datasetLink,
  datasetList,
  datasetOperations,
  datasetRead,
  datasetTransform,
} from "../operations/datasets";
import { changeSchema, type ToolConnection, type ToolDeclaration } from "./tool";

export const datasetWriteTools = new Set<string>([
  "dataset_write",
  "dataset_delete",
]);

// Large values and operation lists can come from a JSON file on this device.
const filePath = z.string().min(1).max(4096).optional();
const context = ({ service, projectId }: ToolConnection): OperationContext => ({
  service,
  projectId,
});

function readActions(connection: ToolConnection): Record<string, ToolAction> {
  const { call, localFiles } = connection;
  return {
    list: {
      fields: datasetList.input,
      run: () => call(() => datasetList.run(context(connection), {})),
    },
    read: {
      fields: {
        ...pick(datasetRead.input, [
          "datasetId",
          "path",
          "sinceHash",
          "offset",
          "limit",
          "refresh",
          "query",
        ]),
        ...(localFiles
          ? {
              out: z.string().min(1).max(4096).optional(),
              overwrite: z.boolean().optional(),
            }
          : {}),
      },
      run: ({ out, overwrite, ...input }) =>
        call(async () => {
          if (out !== undefined) assertLocalPath(out, "out");
          const result = await datasetRead.run(context(connection), {
            ...(input as Parameters<typeof datasetRead.run>[1]),
            full: out !== undefined,
          });
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

function writeActions(connection: ToolConnection): Record<string, ToolAction> {
  const { call, localFiles } = connection;
  const valueFile: { valueFile?: typeof filePath } = localFiles
    ? { valueFile: filePath }
    : {};
  const operationsFile: { operationsFile?: typeof filePath } = localFiles
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
  const { path: linkPath, ...linkFields } = datasetLink.input;
  return {
    create: {
      fields: {
        ...changeSchema,
        ...pick(datasetCreate.input, ["name", "datasetId", "description", "value"]),
        ...valueFile,
        ...pick(datasetCreate.input, ["schema", "fromBlock"]),
      },
      run: ({ value, valueFile, operationId, message, groupId, ...input }) =>
        call(
          async () =>
            datasetCreate.run(context(connection), {
              ...(input as Parameters<typeof datasetCreate.run>[1]),
              value: await fileValue(value, valueFile),
            }),
          { operationId, message, groupId } as Record<string, string>,
        ),
    },
    apply: {
      fields: {
        ...changeSchema,
        ...pick(datasetApply.input, ["datasetId", "baseHash"]),
        operations: localFiles
          ? datasetApply.input.operations.optional()
          : datasetApply.input.operations,
        ...operationsFile,
        ...pick(datasetApply.input, ["name", "description", "schema"]),
      },
      run: ({
        operations,
        operationsFile,
        operationId,
        message,
        groupId,
        ...input
      }) =>
        call(
          async () => {
            const list = await inlineOrFile({
              inline: operations,
              inlineName: "operations",
              file: operationsFile,
              fileName: "operationsFile",
              limitBytes: CAPACITY.authoringRequestBytes,
              required: true,
              localFiles,
            });
            const parsed = datasetOperations.safeParse(list);
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
            return datasetApply.run(context(connection), {
              ...(input as Parameters<typeof datasetApply.run>[1]),
              operations: parsed.data,
            });
          },
          { operationId, message, groupId } as Record<string, string>,
        ),
    },
    // Online data is not a file of this device, so every transport links it;
    // files (and copying a file's data back) need a local connection.
    link: {
      fields: {
        ...changeSchema,
        datasetId: linkFields.datasetId,
        ...(localFiles ? { path: linkPath } : {}),
        ...pick(linkFields, [
          "url",
          "format",
          "refreshSeconds",
          "use",
          "name",
          "description",
          "value",
        ]),
        ...valueFile,
        ...pick(linkFields, ["schema", "baseHash"]),
      },
      run: ({ value, valueFile, operationId, message, groupId, ...input }) =>
        call(
          async () =>
            datasetLink.run(context(connection), {
              ...(input as Parameters<typeof datasetLink.run>[1]),
              value: await fileValue(value, valueFile),
            }),
          { operationId, message, groupId } as Record<string, string>,
        ),
    },
    transform: {
      fields: {
        ...changeSchema,
        ...pick(datasetTransform.input, [
          "datasetId",
          "baseHash",
          "name",
          "description",
          "schema",
          "inputs",
          "script",
        ]),
        ...(localFiles ? { scriptFile: filePath } : {}),
        dryRun: datasetTransform.input.dryRun,
      },
      run: ({
        script: inlineScript,
        scriptFile,
        operationId,
        message,
        groupId,
        ...input
      }) =>
        call(
          async () => {
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
            return datasetTransform.run(context(connection), {
              ...(input as Parameters<typeof datasetTransform.run>[1]),
              script,
            });
          },
          { operationId, message, groupId } as Record<string, string>,
        ),
    },
  };
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
    input: () => ({ ...changeSchema, ...datasetDelete.input }),
    run: (connection, { datasetId, baseHash, ...metadata }) =>
      connection.call(
        () => datasetDelete.run(context(connection), { datasetId, baseHash }),
        metadata,
      ),
  },
];
