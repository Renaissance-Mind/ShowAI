import {
  compileBinding,
  componentProps,
  readBinding,
  resolveBinding,
  shareBlock,
  snapshotBinding,
  splitBindingChange,
  withComponentProps,
  type DatasetBinding,
} from "../datasets/binding.mjs";
import {
  applyOperations as applyDatasetOperations,
  parsePath,
  valueAt,
  type DatasetOperation,
} from "../datasets/operations.mjs";
import {
  DatasetBaselines,
  DatasetStore,
  sharedPropsSchema,
  type DatasetLinkInput,
  type DatasetRecord,
} from "../core/datasets";
import { applyOperations } from "../core/diff";
import { CoreError } from "../core/model";
import type { FileStore } from "../core/store";
import type { PageOperation, ShowDocument, JSONContent } from "../core/model";
import { getComponent, lockDocumentComponents } from "../core/catalog";
import { readCustomBlockData } from "../components/custom/contract";
import { visitNodes } from "../surface/document.mjs";
import type { JsonSchema } from "../components/custom/types";

type BindingOperation = Extract<
  PageOperation,
  { type: "component.binding.set" | "component.binding.remove" }
>;

function findWidget(document: ShowDocument, blockId: string): JSONContent {
  let found: JSONContent | undefined;
  visitNodes(document.content, (node) => {
    if (!found && node.type !== "text" && node.attrs?.id === blockId)
      found = node;
  });
  if (!found)
    throw new CoreError("NOT_FOUND", `Block ${blockId} does not exist.`);
  if (found.type !== "widget")
    throw new CoreError(
      "INVALID_DATA",
      `Block ${blockId} is not a component block.`,
    );
  return found;
}

function invalidData(
  message: string,
  details?: Record<string, unknown>,
): never {
  const error = new CoreError("INVALID_DATA", message);
  if (details) error.details = details;
  throw error;
}

/** Agent-facing dataset operations, and routing of page writes to bound blocks. */
export class DatasetService {
  readonly datasets: DatasetStore;
  constructor(readonly store: FileStore) {
    this.datasets = new DatasetStore(store);
  }

  list(projectId: string) {
    return this.datasets.list(projectId);
  }

  async read(
    projectId: string,
    datasetId: string,
    options: { path?: unknown } = {},
  ) {
    const record = await this.datasets.read(projectId, datasetId);
    await new DatasetBaselines(this.store.root).remember(projectId, record);
    const references = await this.datasets.references(
      projectId,
      datasetId,
      "project",
    );
    if (options.path === undefined) return { ...record, references };
    const path = parsePath(options.path);
    return {
      ...record,
      dataset: { ...record.dataset, value: undefined },
      path,
      value: valueAt(record.dataset.value, path),
      references,
    };
  }

  references(projectId: string, datasetId: string) {
    return this.datasets.references(projectId, datasetId);
  }

  async create(
    projectId: string,
    input: {
      id?: string;
      name: string;
      description?: string;
      value?: unknown;
      schema?: JsonSchema;
      fromBlock?: {
        pageId: string;
        blockId: string;
        baseHash: string;
        baseRevision?: string;
        local?: string[];
      };
    },
  ) {
    if (!input.fromBlock) {
      if (input.value === undefined)
        invalidData("Provide value, or fromBlock to share an existing block.");
      return this.datasets.create(
        projectId,
        input as typeof input & { value: unknown },
      );
    }
    if (input.value !== undefined)
      invalidData("fromBlock takes the value from the block; omit value.");
    const { pageId, blockId, baseHash, baseRevision } = input.fromBlock;
    const page = await this.store.readPage(projectId, pageId);
    if (page.hash !== baseHash)
      throw new CoreError(
        "CONFLICT",
        "The page changed since it was read. Read it again before sharing a block.",
        {
          currentHash: page.hash,
          currentRevision: page.revision,
        },
      );
    const node = findWidget(page.document, blockId);
    if (readBinding(node.attrs?.data))
      invalidData(`Block ${blockId} already uses a dataset.`);
    const kind = String(node.attrs!.kind);
    const local = input.fromBlock.local ?? [];
    let schema = input.schema;
    let componentId: string | undefined;
    if (kind === "custom") {
      const ref = readCustomBlockData(node.attrs!.data);
      const component = await getComponent(
        this.store.root,
        ref.componentId,
        ref.version,
        projectId,
        {
          integrity: ref.integrity,
          scope: ref.scope,
        },
      );
      schema ??= sharedPropsSchema(component.schema, local);
      componentId = ref.componentId;
    }
    const datasetId = input.id ?? crypto.randomUUID();
    const shared = shareBlock(kind, node.attrs!.data, datasetId, local);
    const record = await this.datasets.create(projectId, {
      id: datasetId,
      name: input.name,
      description: input.description,
      value: shared.value,
      origin: {
        kind,
        ...(componentId ? { componentId } : {}),
        pageId,
        blockId,
      },
      ...(schema ? { schema } : {}),
    });
    const document = await lockDocumentComponents(
      this.store.root,
      applyOperations(page.document, [
        { type: "block.attrs.set", blockId, attrs: { data: shared.data } },
      ]),
      projectId,
    );
    // The hash check above ran in this transaction, so the page revision read with it is current.
    const saved = await this.store.savePage(
      projectId,
      pageId,
      document,
      baseHash,
      baseRevision ?? page.revision,
    );
    return {
      ...record,
      page: { pageId, blockId, hash: saved.hash, revision: saved.revision },
    };
  }

  apply(
    projectId: string,
    datasetId: string,
    input: {
      baseHash: string;
      operations: unknown[];
      name?: string;
      description?: string | null;
      schema?: JsonSchema | null;
    },
  ) {
    return this.datasets.apply(projectId, datasetId, input, {
      throwOnConflict: true,
    });
  }

  /** Keeps a dataset's value in a file outside the library (see DatasetStore.link). */
  link(projectId: string, input: DatasetLinkInput) {
    return this.datasets.link(projectId, input);
  }

  /** Copies an external dataset's value into the library and stops reading its file. */
  embed(projectId: string, datasetId: string, baseHash?: string) {
    return this.datasets.embed(projectId, datasetId, { baseHash });
  }

  async remove(projectId: string, datasetId: string, baseHash: string) {
    return this.datasets.remove(projectId, datasetId, { baseHash });
  }

  /** The value the writer of a bound block last read. */
  private async basis(
    projectId: string,
    record: DatasetRecord,
    bases: Record<string, string> | undefined,
  ): Promise<unknown> {
    const key = `${projectId}/${record.dataset.id}`;
    const hash = bases?.[key] ?? bases?.[record.dataset.id];
    const baselines = new DatasetBaselines(this.store.root);
    if (hash) {
      if (hash === record.hash) return record.dataset.value;
      const value = await baselines.read(projectId, record.dataset.id, hash);
      if (value !== undefined) return value;
    } else {
      const latest = await baselines.latest(projectId, record.dataset.id);
      if (latest)
        return latest.hash === record.hash
          ? record.dataset.value
          : latest.value;
    }
    throw new CoreError(
      "MISSING_BASELINE",
      `Read the page (page_read) or dataset ${record.dataset.id} (dataset_read) before writing its bound block, so changes made since are merged rather than overwritten.`,
      { currentHash: record.hash, currentRevision: record.revision },
    );
  }

  /**
   * Applies page operations; component.props.set on a bound block writes the
   * dataset, component.binding.set/remove change the binding. Returns the new
   * page document and commits dataset writes in the caller's transaction.
   */
  async applyPageOperations(
    projectId: string,
    document: ShowDocument,
    operations: PageOperation[],
    bases?: Record<string, string>,
  ): Promise<{ document: ShowDocument; commit: () => Promise<void> }> {
    const bindingOps = (operation: PageOperation) =>
      operation.type === "component.binding.set" ||
      operation.type === "component.binding.remove" ||
      (operation.type === "component.props.set" &&
        !!this.boundIn(document, operation.blockId));
    if (!operations.some(bindingOps))
      return {
        document: applyOperations(document, operations),
        commit: async () => {},
      };
    let working = document;
    let batch: PageOperation[] = [];
    const flush = () => {
      if (batch.length) working = applyOperations(working, batch);
      batch = [];
    };
    const records = new Map<string, DatasetRecord>();
    const values = new Map<string, unknown>();
    const writes = new Map<
      string,
      { projectId: string; datasetId: string; operations: DatasetOperation[] }
    >();
    const load = async (project: string, datasetId: string) => {
      const key = `${project}/${datasetId}`;
      if (!records.has(key)) {
        const record = await this.datasets.read(project, datasetId);
        records.set(key, record);
        values.set(key, record.dataset.value);
      }
      return { key, record: records.get(key)! };
    };
    for (const operation of operations) {
      if (operation.type === "component.binding.set") {
        flush();
        const node = findWidget(working, operation.blockId);
        const kind = String(node.attrs!.kind);
        let compiled;
        try {
          compiled = compileBinding(operation.binding);
        } catch (error) {
          invalidData(error instanceof Error ? error.message : String(error));
        }
        await load(compiled.project ?? projectId, compiled.dataset);
        let props = componentProps(kind, node.attrs!.data);
        // Shared keys come from the dataset now; stale copies in the block are dropped.
        if (compiled.props)
          props = Object.fromEntries(
            Object.entries(props).filter(([key]) =>
              compiled.props!.local.has(key),
            ),
          );
        const data = withComponentProps(
          kind,
          node.attrs!.data,
          props,
          operation.binding as unknown as DatasetBinding,
        );
        working = applyOperations(working, [
          {
            type: "block.attrs.set",
            blockId: operation.blockId,
            attrs: { data },
          },
        ]);
      } else if (operation.type === "component.binding.remove") {
        flush();
        const node = findWidget(working, operation.blockId);
        const binding = readBinding(node.attrs?.data);
        if (!binding)
          invalidData(`Block ${operation.blockId} does not use a dataset.`);
        const kind = String(node.attrs!.kind);
        let data;
        if (operation.keep === "local")
          data = withComponentProps(
            kind,
            node.attrs!.data,
            componentProps(kind, node.attrs!.data),
            null,
          );
        else {
          const { key } = await load(
            binding.project ?? projectId,
            binding.dataset,
          );
          data = snapshotBinding(kind, node.attrs!.data, values.get(key));
        }
        working = applyOperations(working, [
          {
            type: "block.attrs.set",
            blockId: operation.blockId,
            attrs: { data },
          },
        ]);
      } else if (
        operation.type === "component.props.set" &&
        this.boundIn(working, operation.blockId)
      ) {
        flush();
        const node = findWidget(working, operation.blockId);
        const binding = readBinding(node.attrs!.data)!;
        const kind = String(node.attrs!.kind);
        const project = binding.project ?? projectId;
        const { key, record } = await load(project, binding.dataset);
        const basis = await this.basis(project, record, bases);
        const basisProps = resolveBinding(kind, node.attrs!.data, basis).props;
        if (
          !operation.props ||
          typeof operation.props !== "object" ||
          Array.isArray(operation.props)
        )
          invalidData("component.props.set requires a props object.");
        const split = splitBindingChange({
          kind,
          data: node.attrs!.data,
          value: values.get(key),
          nextProps: { ...basisProps, ...structuredClone(operation.props) },
          basis: { value: basis, props: basisProps },
        });
        if (split.rejected.length)
          invalidData(
            `Block ${operation.blockId} shows dataset records that cannot change this way: ${split.rejected
              .map(
                (item) =>
                  `${item.id ?? ""}${item.field ? `.${item.field}` : ""} (${item.reason})`,
              )
              .join(
                ", ",
              )}. Mapped rows are removed or renamed in their source; derived fields are read-only.`,
            { rejected: split.rejected },
          );
        if (split.operations.length) {
          const result = applyDatasetOperations(
            values.get(key),
            split.operations,
          );
          if (result.conflicts.length) {
            const error = new CoreError(
              "CONFLICT",
              `The dataset ${record.dataset.id} changed in the same fields since it was read. Nothing was written. Read the page again and decide each field.`,
              { currentHash: record.hash, currentRevision: record.revision },
            );
            error.details = {
              datasetId: record.dataset.id,
              conflicts: result.conflicts,
            };
            throw error;
          }
          values.set(key, result.value);
          const write = writes.get(key) ?? {
            projectId: project,
            datasetId: binding.dataset,
            operations: [],
          };
          write.operations.push(...split.operations);
          writes.set(key, write);
        }
        if (split.data !== node.attrs!.data)
          working = applyOperations(working, [
            {
              type: "block.attrs.set",
              blockId: operation.blockId,
              attrs: { data: split.data },
            },
          ]);
      } else batch.push(operation);
    }
    flush();
    return {
      document: working,
      commit: async () => {
        for (const [key, write] of writes)
          await this.datasets.apply(
            write.projectId,
            write.datasetId,
            { baseHash: records.get(key)!.hash, operations: write.operations },
            { throwOnConflict: true },
          );
      },
    };
  }

  private boundIn(document: ShowDocument, blockId: string): boolean {
    let bound = false;
    visitNodes(document.content, (node) => {
      if (
        node.type === "widget" &&
        node.attrs?.id === blockId &&
        readBinding(node.attrs?.data)
      )
        bound = true;
    });
    return bound;
  }

  /** Rejects saving shared props into a bound block's stored data. */
  assertBoundBlocks(document: ShowDocument) {
    visitNodes(document.content, (node) => {
      if (node.type !== "widget") return;
      const binding = readBinding(node.attrs?.data);
      if (!binding) return;
      let compiled;
      try {
        compiled = compileBinding(binding);
      } catch (error) {
        invalidData(
          `Block ${node.attrs?.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!compiled.props) return;
      const extra = Object.keys(
        componentProps(String(node.attrs!.kind), node.attrs!.data),
      ).filter((key) => !compiled.props!.local.has(key));
      if (extra.length)
        invalidData(
          `Block ${node.attrs?.id} takes ${extra.join(", ")} from dataset ${binding.dataset}. Change them with component.props.set (page_apply) or dataset_write(action:apply) instead of storing them in the page.`,
        );
    });
  }
}

export type { BindingOperation };
