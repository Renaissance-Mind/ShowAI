import { diffDocuments } from "./diff";
import { mergePageContent, type PageMergeResult } from "./page-merge-model";
import type { ShowDocument } from "./model";
export { describeMergeConflict } from "./page-merge-model";
export type { PageMergeConflict } from "./page-merge-model";
export interface PageMergePreview extends PageMergeResult {
  changes: ReturnType<typeof diffDocuments>;
}
export function previewPageMerge(
  base: ShowDocument,
  ours: ShowDocument,
  theirs: ShowDocument,
): PageMergePreview {
  const result = mergePageContent(base, ours, theirs);
  return { ...result, changes: diffDocuments(ours, result.document) };
}
