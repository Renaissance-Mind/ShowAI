import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {nativeDocumentContentKey} from "./native-document-content";

it("timestamps and JSON object key order do not create another native editor mutation",()=>{
  const base=createResource(blankDocument(),"board"),next={...structuredClone(base),updatedAt:"2026-10-21T08:40:00Z"};
  next.content={...next.content,attrs:Object.fromEntries(Object.entries(next.content.attrs??{}).reverse())};
  expect(nativeDocumentContentKey(next)).toBe(nativeDocumentContentKey(base));
});
it("editable metadata, comments and causal heads remain real source mutations",()=>{
  const base=blankDocument(),key=nativeDocumentContentKey(base);
  expect(nativeDocumentContentKey({...base,title:"Remote title"})).not.toBe(key);
  expect(nativeDocumentContentKey({...base,comments:[{id:"comment",text:"remote",createdAt:base.createdAt,resolved:false}]})).not.toBe(key);
  const next=structuredClone(base);next.content.attrs={...next.content.attrs,inkState:{format:"showai-ink-state-v1",clock:{writer:1}}};
  expect(nativeDocumentContentKey(next)).not.toBe(key);
});
