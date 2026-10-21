import type {ShowDocument} from "../types";

/** A storage timestamp acknowledges a write; it is not another editor mutation.
 * Every editable field and every causal candidate remains in this identity. */
export function nativeDocumentContentKey(document:ShowDocument):string {
  const source={...document};delete (source as Partial<ShowDocument>).updatedAt;
  return JSON.stringify(source,(_key,value)=>value && typeof value==="object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value);
}
