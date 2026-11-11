import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export type ResponseProfile = "full" | "source" | "receipt";
/** Keep complete storage/rendering results while choosing one model-facing representation. */
export function compactMcpResult(
  result: CallToolResult,
  profile: ResponseProfile,
): CallToolResult {
  const data = result.structuredContent?.data;
  if (
    profile === "full" ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  )
    return result;
  const selected = compactData(data, profile) as Record<string, unknown>;
  return {
    ...result,
    content: result.content.map((item) =>
      item.type === "text"
        ? { ...item, text: JSON.stringify({ ok: true, data: selected }) }
        : item,
    ),
    structuredContent: { ...result.structuredContent, data: selected },
  };
}

/**
 * The model-facing part of a tool result before it is serialized, so a receipt
 * never pays for encoding the full document.
 */
export function compactData(data: unknown, profile: ResponseProfile): unknown {
  if (
    profile === "full" ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  )
    return data;
  const record = data as Record<string, unknown>;
  const fields = [
    "projectId",
    "projectName",
    "openUrl",
    "pageId",
    "title",
    "hash",
    "revision",
    "view",
    "partial",
    "blockIds",
    "componentRefs",
    "format",
    "path",
    "url",
    "state",
    "capturedAt",
    "reader",
    "image",
    "metadataPath",
    "workspaceConflicts",
    "retainedSyncConflicts",
    "synchronization",
    "persistence",
    "delivery",
    "snapshotId",
    "sourceHash",
    "currentHash",
    "currentSourceChanged",
    "expiresAt",
    "origin",
    "datasetSchemas",
    "datasetBases",
    "comments",
    "references",
    "warnings",
    "changedBlocks",
    "omitted",
    "migration",
    "out",
  ];
  const selected = Object.fromEntries(
    fields.filter((key) => key in record).map((key) => [key, record[key]]),
  );
  if (
    record.document &&
    typeof record.document === "object" &&
    !Array.isArray(record.document)
  ) {
    const document = record.document as Record<string, unknown>;
    selected.pageId ??= document.id;
    selected.title ??= document.title;
    if (profile === "source") selected.document = document;
  }
  // Bound blocks keep only their binding in the source; their props live in a dataset.
  if (profile === "source" && Array.isArray(record.bindings))
    selected.bindings = record.bindings;
  selected.response = profile;
  return selected;
}
