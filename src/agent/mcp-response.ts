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
  const record = data as Record<string, unknown>;
  const fields = [
    "projectId",
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
  selected.response = profile;
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
