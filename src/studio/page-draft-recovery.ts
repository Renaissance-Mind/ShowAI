import type {JSONContent} from "@tiptap/core";
import type {ShowDocument} from "../types";
import type {EditorDraftRecord} from "../core/editor-drafts";
import {mergePageContent} from "../core/page-merge-model";

export interface RetainedPageDraft {
  record:EditorDraftRecord;
  content:ShowDocument;
  baseContent?:ShowDocument;
}

export function pageContentKey(document: ShowDocument): string {
  const { createdAt: _created, updatedAt: _updated, ...content } = document;
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : value;
  return JSON.stringify(normalize(content));
}
// An absent child list and [] encode the same empty editor node. Restrict
// this normalization to the actual node tree; widget data/unknown fields retain
// all distinctions, including their own properties named "content".
function recoveryContentKey(document:ShowDocument):string {
  const node=(value:JSONContent):JSONContent=>{
    const {content,...fields}=value;
    return content?.length ? {...fields,content:content.map(node)}:fields;
  };
  return pageContentKey({...document,content:node(document.content)});
}
/** Classification never writes, deletes, publishes or restores a draft.
 * An exact equality or conflict-free no-op merge proves there is no independent
 * edit to recover. Missing ancestry, retained conflicts and errors stay visible. */
export function pageDraftNeedsRecovery(saved:ShowDocument,draft:RetainedPageDraft):boolean {
  if(draft.record.normalizationWarning || draft.content.id!==saved.id || draft.record.resourceId!==saved.id)return true;
  const savedKey=recoveryContentKey(saved),draftKey=recoveryContentKey(draft.content);
  if(draftKey===savedKey)return false;
  if(!draft.baseContent || draft.baseContent.id!==saved.id)return true;
  if(draftKey===recoveryContentKey(draft.baseContent))return false;
  const merged=mergePageContent(draft.baseContent,saved,draft.content);
  return merged.conflicts.length>0 || recoveryContentKey(merged.document)!==savedKey;
}
