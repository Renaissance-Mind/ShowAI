import {
  readBinding,
  resolveBinding,
  snapshotBinding,
  type BindingIssue,
} from "../datasets/binding.mjs";
import { visitNodes } from "../surface/document.mjs";
import { DatasetBaselines, DatasetStore, type DatasetRecord } from "./datasets";
import { CoreError } from "./model";
import type { FileStore } from "./store";
import type { ShowDocument } from "./model";

/** How a bound block of a page resolved, as reported to Agents and readers. */
export interface BindingRead {
  blockId: string;
  kind: string;
  projectId: string;
  datasetId: string;
  name?: string;
  hash?: string;
  revision?: string;
  /** The props the component renders, when requested. */
  props?: Record<string, unknown>;
  /** Items of collection mappings, by target prop. */
  mapped?: Record<string, number>;
  issues: BindingIssue[];
  error?: string;
}

/**
 * Resolves every bound block of a document. The returned document carries the
 * resolved props in place of the bindings (a snapshot for rendering and
 * export); unavailable datasets leave the block bound and report an error.
 */
export async function resolveDocumentDatasets(
  store: FileStore,
  projectId: string,
  document: ShowDocument,
  options: { includeProps?: boolean; remember?: boolean } = {},
): Promise<{ document: ShowDocument; bindings: BindingRead[] }> {
  const bound: { node: ShowDocument["content"] }[] = [];
  visitNodes(document.content, (node) => {
    if (node.type === "widget" && readBinding(node.attrs?.data))
      bound.push({ node });
  });
  if (!bound.length) return { document, bindings: [] };
  const datasets = new DatasetStore(store);
  const records = new Map<string, Promise<DatasetRecord>>();
  const load = (project: string, id: string) => {
    const key = `${project}/${id}`;
    let record = records.get(key);
    if (!record) {
      record = datasets.read(project, id);
      records.set(key, record);
    }
    return record;
  };
  const snapshot = structuredClone(document);
  const bindings: BindingRead[] = [];
  const replacements = new Map<string, Record<string, unknown>>();
  for (const { node } of bound) {
    const binding = readBinding(node.attrs!.data)!;
    const kind = String(node.attrs!.kind);
    const blockId = String(node.attrs!.id ?? "");
    const project = binding.project ?? projectId;
    const read: BindingRead = {
      blockId,
      kind,
      projectId: project,
      datasetId: binding.dataset,
      issues: [],
    };
    bindings.push(read);
    let record: DatasetRecord;
    try {
      record = await load(project, binding.dataset);
    } catch (error) {
      read.error =
        error instanceof CoreError && error.code === "NOT_FOUND"
          ? `The dataset ${binding.dataset} is missing in project ${project}.`
          : error instanceof Error
            ? error.message
            : String(error);
      continue;
    }
    Object.assign(read, {
      name: record.dataset.name,
      hash: record.hash,
      ...(record.revision ? { revision: record.revision } : {}),
    });
    try {
      const resolved = resolveBinding(
        kind,
        node.attrs!.data,
        record.dataset.value,
      );
      read.issues = resolved.issues;
      if (options.includeProps) read.props = resolved.props;
      const mapped: Record<string, number> = {};
      for (const item of resolved.projected.values())
        mapped[item.into] = (mapped[item.into] ?? 0) + 1;
      if (Object.keys(mapped).length) read.mapped = mapped;
      replacements.set(
        blockId,
        snapshotBinding(kind, node.attrs!.data, record.dataset.value),
      );
    } catch (error) {
      read.error = error instanceof Error ? error.message : String(error);
    }
  }
  visitNodes(snapshot.content, (node) => {
    if (node.type === "widget" && replacements.has(String(node.attrs?.id)))
      node.attrs!.data = replacements.get(String(node.attrs!.id));
  });
  if (options.remember) {
    const baselines = new DatasetBaselines(store.root);
    for (const [key, record] of records) {
      const value = await record.catch(() => undefined);
      if (value) await baselines.remember(key.split("/")[0], value);
    }
  }
  return { document: snapshot, bindings };
}
