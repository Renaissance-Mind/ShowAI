import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export type ResponseProfile = "full" | "source" | "receipt";
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
    "capture",
    "layout",
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
    "blockCount",
    "offset",
    "nextOffset",
    "omitted",
    "migration",
    "out",
  ];
  const selected = Object.fromEntries(
    fields.filter((key) => key in record).map((key) => [key, record[key]]),
  );
  const outlineOrMarkdown =
    record.format === "outline" || record.format === "markdown";
  if (
    record.document &&
    typeof record.document === "object" &&
    !Array.isArray(record.document)
  ) {
    const document = record.document as Record<string, unknown>;
    selected.pageId ??= document.id;
    selected.title ??= document.title;
    if (profile === "source" && !outlineOrMarkdown)
      selected.document = document;
  }
  if (profile === "source") {
    if (!outlineOrMarkdown && Array.isArray(record.bindings))
      selected.bindings = record.bindings;
    if (outlineOrMarkdown && Array.isArray(record.outline))
      selected.outline = record.outline;
    if (record.format === "markdown" && typeof record.markdown === "string")
      selected.markdown = record.markdown;
  }
  selected.response = profile;
  return selected;
}
