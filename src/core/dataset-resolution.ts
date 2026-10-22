import {
  componentProps,
  readBinding,
  resolveBinding,
  snapshotBinding,
  withComponentProps,
  type BindingIssue,
} from "../datasets/binding.mjs";
import { visitNodes } from "../surface/document.mjs";
import { formatPath } from "../datasets/operations.mjs";
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
  /** Source record path of each mapped item (when props are included). */
  sources?: Record<string, string>;
  issues: BindingIssue[];
  error?: string;
  /** The dataset reads a file outside the library (see dataset-sources). */
  source?: {
    format: string;
    name?: string;
    path?: string;
    bytes?: number;
    available: boolean;
  };
  /** Bytes the resolved snapshot adds to the block's stored data. */
  snapshotBytes?: number;
}

/** One external dataset whose snapshot an export would embed. */
export interface ExternalSnapshot {
  projectId: string;
  datasetId: string;
  name?: string;
  format: string;
  path?: string;
  /** Size of the linked file when it was read. */
  fileBytes?: number;
  /** JSON bytes the export adds for this dataset, over all its blocks. */
  snapshotBytes: number;
  blocks: { pageId: string; blockId: string }[];
  /** False when the file cannot be read: its blocks are exported without data. */
  available: boolean;
  error?: string;
}
export interface ExternalSnapshotReport {
  datasets: ExternalSnapshot[];
  snapshotBytes: number;
}

/**
 * Aggregates the external datasets of resolved pages, optionally limited to
 * selected blocks, so the person can decide before their data is embedded.
 */
export function externalSnapshotReport(
  pages: { pageId: string; bindings: BindingRead[]; blockIds?: string[] }[],
): ExternalSnapshotReport {
  const datasets = new Map<string, ExternalSnapshot>();
  for (const page of pages)
    for (const binding of page.bindings) {
      if (!binding.source) continue;
      if (page.blockIds && !page.blockIds.includes(binding.blockId)) continue;
      const key = `${binding.projectId}/${binding.datasetId}`;
      const entry = datasets.get(key) ?? {
        projectId: binding.projectId,
        datasetId: binding.datasetId,
        ...(binding.name ? { name: binding.name } : {}),
        format: binding.source.format,
        ...(binding.source.path ? { path: binding.source.path } : {}),
        ...(binding.source.bytes !== undefined
          ? { fileBytes: binding.source.bytes }
          : {}),
        snapshotBytes: 0,
        blocks: [],
        available: binding.source.available,
        ...(binding.error ? { error: binding.error } : {}),
      };
      entry.snapshotBytes += binding.snapshotBytes ?? 0;
      entry.blocks.push({ pageId: page.pageId, blockId: binding.blockId });
      datasets.set(key, entry);
    }
  const list = [...datasets.values()].sort(
    (a, b) => b.snapshotBytes - a.snapshotBytes,
  );
  return {
    datasets: list,
    snapshotBytes: list.reduce((sum, item) => sum + item.snapshotBytes, 0),
  };
}

const jsonBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value ?? null));

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
      if (error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE") {
        const details = error.details as {
          name?: string;
          source?: { format: string; name?: string; path?: string };
        };
        if (details.name) read.name = details.name;
        read.source = { ...details.source!, available: false };
      }
      read.error =
        error instanceof CoreError && error.code === "NOT_FOUND"
          ? `The dataset ${binding.dataset} is missing in project ${project}.`
          : error instanceof Error
            ? error.message
            : String(error);
      continue;
    }
    if (record.external)
      read.source = {
        format: record.external.format,
        ...(record.dataset.source?.name
          ? { name: record.dataset.source.name }
          : {}),
        path: record.external.path,
        bytes: record.external.bytes,
        available: true,
      };
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
      if (options.includeProps && resolved.projected.size)
        read.sources = Object.fromEntries(
          [...resolved.projected.values()].map((item) => [
            item.id,
            item.source ? formatPath(item.source) : "",
          ]),
        );
      const snapshot = snapshotBinding(
        kind,
        node.attrs!.data,
        record.dataset.value,
      );
      replacements.set(blockId, snapshot);
      // What the dataset adds beyond the block's own values (its binding settings aside).
      if (record.external)
        read.snapshotBytes = Math.max(
          0,
          jsonBytes(snapshot) -
            jsonBytes(
              withComponentProps(
                kind,
                node.attrs!.data,
                componentProps(kind, node.attrs!.data),
                null,
              ),
            ),
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
