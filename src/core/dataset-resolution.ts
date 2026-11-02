import {
  componentProps,
  readBinding,
  resolveBinding,
  snapshotBinding,
  withComponentProps,
  type BindingIssue,
} from "../datasets/binding.mjs";
import { bindingEditable } from "../datasets/editable.mjs";
import { visitNodes } from "../surface/document.mjs";
import { formatPath } from "../datasets/operations.mjs";
import type {
  DatasetReadStatus,
  DatasetWarning,
  Editable,
} from "../datasets/warnings.mjs";
import {
  DatasetBaselines,
  DatasetStore,
  unavailableWarnings,
  type DatasetRecord,
} from "./datasets";
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
  /**
   * ok: current data; stale: the source cannot be read and the props show
   * the last value read on this device; empty: no data (see warnings/error).
   */
  status: DatasetReadStatus;
  /**
   * What edits of the block can change: true, false, or { paths } when only
   * part of it can (see datasets/editable.mjs): e.g. mapped fields of a
   * read-only dataset next to the block's own items and fields.
   */
  editable: Editable;
  warnings: DatasetWarning[];
  /** The dataset reads a file or online data outside the library (see dataset-sources). */
  source?: {
    kind?: "file" | "url";
    format: string;
    name?: string;
    path?: string;
    url?: string;
    bytes?: number;
    /** Read from the synchronized copy of another device's file. */
    bundled?: boolean;
    /** False when the source cannot be read now (status stale or empty). */
    available: boolean;
  };
  /**
   * The dataset is computed by a transform script from these datasets
   * ("projectId/datasetId" by input name); its values are read-only.
   */
  transform?: { inputs: Record<string, string> };
  /** Bytes the resolved snapshot adds to the block's stored data. */
  snapshotBytes?: number;
}

/**
 * What a reader shows for a bound block without data: the dataset name and
 * only the file name of its source, never a path of this device.
 */
export interface DataNotice {
  status: "empty";
  dataset?: string;
  file?: string;
  /** The person left the data out of this copy (packaging skip). */
  omitted?: true;
}
/** Block data key of a DataNotice in resolved (rendered, exported) documents. */
export const DATA_NOTICE_KEY = "$dataState";

/** The last segment of a path or address, without query or fragment. */
export function sourceFileName(source: {
  name?: string;
  path?: string;
  url?: string;
}): string | undefined {
  if (source.name) return source.name;
  if (source.path) return source.path.split(/[\\/]/).pop() || undefined;
  if (source.url) {
    const url = new URL(source.url);
    return (
      decodeURIComponent(url.pathname.split("/").pop() ?? "") || url.hostname
    );
  }
  return undefined;
}

/** One external dataset whose snapshot an export would embed. */
export interface ExternalSnapshot {
  projectId: string;
  datasetId: string;
  name?: string;
  format: string;
  path?: string;
  url?: string;
  /** Size of the linked file (or online data) when it was read. */
  fileBytes?: number;
  /** JSON bytes the export adds for this dataset, over all its blocks. */
  snapshotBytes: number;
  blocks: { pageId: string; blockId: string }[];
  /**
   * False when the source cannot be read: with status stale the blocks are
   * exported with the last value read on this device, otherwise without data.
   */
  available: boolean;
  status: DatasetReadStatus;
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
        ...(binding.source.url ? { url: binding.source.url } : {}),
        ...(binding.source.bytes !== undefined
          ? { fileBytes: binding.source.bytes }
          : {}),
        snapshotBytes: 0,
        blocks: [],
        available: binding.source.available,
        status: binding.status,
        ...(binding.error
          ? { error: binding.error }
          : binding.status === "stale" && binding.warnings[0]
            ? { error: binding.warnings[0].message }
            : {}),
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
  const notices = new Map<string, DataNotice>();
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
      status: "empty",
      editable: false,
      warnings: [],
    };
    bindings.push(read);
    let record: DatasetRecord;
    try {
      record = await load(project, binding.dataset);
    } catch (error) {
      if (error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE") {
        const details = error.details as {
          name?: string;
          source?: {
            kind?: "file" | "url";
            format: string;
            name?: string;
            path?: string;
            url?: string;
          };
        };
        if (details.name) read.name = details.name;
        if (details.source) {
          const { refreshSeconds: _refresh, ...source } = details.source as {
            refreshSeconds?: number;
          } & NonNullable<typeof details.source>;
          read.source = { ...source, available: false };
        }
        read.warnings = unavailableWarnings(error);
        const file = details.source ? sourceFileName(details.source) : undefined;
        notices.set(blockId, {
          status: "empty",
          ...(details.name ? { dataset: details.name } : {}),
          ...(file ? { file } : {}),
        });
      }
      read.error =
        error instanceof CoreError && error.code === "NOT_FOUND"
          ? `The dataset ${binding.dataset} is missing in project ${project}.`
          : error instanceof Error
            ? error.message
            : String(error);
      continue;
    }
    const origin = record.external ?? record.remote ?? record.bundled;
    if (origin)
      read.source = {
        kind: record.remote ? "url" : "file",
        format: origin.format,
        ...(record.dataset.source?.name
          ? { name: record.dataset.source.name }
          : {}),
        ...(record.external ? { path: record.external.path } : {}),
        ...(record.remote ? { url: record.remote.url } : {}),
        bytes: origin.bytes,
        ...(record.bundled ? { bundled: true } : {}),
        available: record.status === "ok",
      };
    if (record.transform)
      read.transform = {
        inputs: Object.fromEntries(
          Object.entries(record.transform.inputs).map(([name, input]) => [
            name,
            `${input.projectId}/${input.datasetId}`,
          ]),
        ),
      };
    Object.assign(read, {
      name: record.dataset.name,
      hash: record.hash,
      ...(record.revision ? { revision: record.revision } : {}),
      status: record.status,
      editable: record.editable,
      warnings: record.warnings,
    });
    try {
      const resolved = resolveBinding(
        kind,
        node.attrs!.data,
        record.dataset.value,
        undefined,
        { writable: record.editable === true },
      );
      read.issues = resolved.issues;
      read.editable = bindingEditable(resolved);
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
      if (origin || record.transform)
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
    if (node.type !== "widget") return;
    const id = String(node.attrs?.id);
    if (replacements.has(id)) node.attrs!.data = replacements.get(id);
    else if (notices.has(id))
      node.attrs!.data = {
        ...(node.attrs!.data as Record<string, unknown>),
        [DATA_NOTICE_KEY]: notices.get(id),
      };
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

/**
 * A resolved document in which the given blocks show the name-only notice
 * instead of their data: the block keeps its own values and binding, as
 * for a dataset without data (used when an export leaves data out).
 */
export function withDataNotices(
  resolved: ShowDocument,
  original: ShowDocument,
  notices: Map<string, DataNotice>,
): ShowDocument {
  if (!notices.size) return resolved;
  const own = new Map<string, unknown>();
  visitNodes(original.content, (node) => {
    const id = node.attrs?.id;
    if (node.type === "widget" && typeof id === "string" && notices.has(id))
      own.set(id, node.attrs!.data);
  });
  const copy = structuredClone(resolved);
  visitNodes(copy.content, (node) => {
    const id = node.attrs?.id;
    if (node.type !== "widget" || typeof id !== "string" || !own.has(id))
      return;
    node.attrs!.data = {
      ...structuredClone(own.get(id) as Record<string, unknown>),
      [DATA_NOTICE_KEY]: notices.get(id),
    };
  });
  return copy;
}
