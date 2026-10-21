import {expect,it} from "vitest";
import {CAPACITY} from "../portable/capacity.mjs";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {mergePageContent} from "../core/page-merge-model";
import {SourceRuntimeOwner,type SourceSnapshotDelta,type SourceSnapshotRef} from "./source-runtime";
import type {ShowDocument} from "../types";
type Publication=Parameters<SourceRuntimeOwner["registerActualMergedPublication"]>[0];
function pair(){
 const document=createResource(blankDocument(),"board") as ShowDocument;
 document.createdAt="2026-10-21T00:00:00Z";document.updatedAt="2026-10-22T00:00:00Z";
 const scope={homeId:"consuming-home",projectId:"consuming-project",pageId:document.id};
 const standard=new SourceRuntimeOwner({ownerId:"same-test-owner",epoch:"same-test-epoch"});
 const consuming=new SourceRuntimeOwner({ownerId:"same-test-owner",epoch:"same-test-epoch"});
 const seed={kind:"seed" as const,scope,document,proof:"normalized" as const,leaseId:"base"};
 const one=standard.execute(seed) as SourceSnapshotDelta,two=consuming.execute(seed) as SourceSnapshotDelta;
 expect(one.next).toEqual(two.next);
 return{document,standard,consuming,ref:one.next};
}
const body=(owner:SourceRuntimeOwner,ref:SourceSnapshotRef)=>(owner.execute({kind:"resolve",ref}) as {document:ShowDocument}).document;
function request(document:ShowDocument,current:SourceSnapshotRef):Publication{
 const next=structuredClone(document);next.title="Actual parsed native result";
 (next as any).futureRoot={literal:["é","é",null,false],"__proto__":null};
 (next as any).literalKeys=JSON.parse('{"é":1,"é":2}');
 next.comments=[{id:"comment",text:"保持批注",createdAt:document.createdAt,resolved:false,futureComment:{keep:true}} as any];
 for(const key of ["icon","cover","parentId","favorite","archived"] as const)delete (next as any)[key];
 return{current,publicationId:"actual-parsed-publication",packet:{pageId:document.id,baseDocument:document,document:next,unknownPacket:{keep:[1,2,3]}},result:{document:next,conflicts:[]},leaseId:"output"};
}
it("matches standard object factory bytes/defaults/unknown fields and keeps general caller objects independent",()=>{
 const {document,standard,consuming,ref}=pair(),input=request(document,ref),before=structuredClone(input);
 const regular=standard.registerActualMergedPublication(input),parsed=consuming.registerActualMergedJSON(JSON.stringify(input));
 expect(JSON.stringify(parsed)).toBe(JSON.stringify(regular));expect(input).toEqual(before);
 const actual=body(consuming,parsed.next);expect(actual.icon).toBe("✦");expect(actual.cover).toBe("none");expect(actual.parentId).toBeNull();expect(actual.favorite).toBe(false);expect(actual.archived).toBe(false);
 expect((actual as any).futureRoot).toEqual((input.result.document as any).futureRoot);expect(actual.comments![0]).toEqual(input.result.document.comments![0]);
 expect((actual as any).literalKeys).toEqual((input.result.document as any).literalKeys);expect(({} as any).keep).toBeUndefined();
 expect(Object.isFrozen(input.packet)).toBe(false);expect(Object.isFrozen(input.result.document.content)).toBe(false);
 (input.result.document as any).futureRoot.literal.push("external mutation");input.packet.baseDocument.title="external base mutation";
 expect((body(standard,regular.next) as any).futureRoot.literal).not.toContain("external mutation");expect(body(consuming,ref).title).toBe(before.packet.baseDocument.title);
});
it("preserves complete generic history stages and immutable publication retry identity",()=>{
 const {document,standard,consuming,ref}=pair(),input=request(document,ref);
 input.packet.nativeContentActions=[{groupId:"title",beforeDocument:document,document:input.packet.document}];
 const plain=standard.registerActualMergedPublication(input),parsed=consuming.registerActualMergedJSON(JSON.stringify(input));
 expect(JSON.stringify(parsed)).toBe(JSON.stringify(plain));expect(parsed.history!.stages).toHaveLength(1);
 const repeated=consuming.registerActualMergedJSON(JSON.stringify(input));expect(body(consuming,repeated.next)).toEqual(body(consuming,parsed.next));
 const altered=structuredClone(input);altered.packet.unknownPacket={keep:"different"};expect(()=>consuming.registerActualMergedJSON(JSON.stringify(altered))).toThrow(/identity/);
 expect(()=>consuming.execute({kind:"registerActualMergedJSON",raw:JSON.stringify(input)} as any)).toThrow(/Unknown/);
});
it("matches the genuine three-way foreign/local merge while retaining the normalized author baseline",()=>{
 const {document,standard,consuming,ref}=pair();
 const edit={kind:"draft" as const,base:ref,transactionId:"foreign-title",edits:[{op:"set" as const,path:["title"],value:"Foreign title"}],leaseId:"foreign"};
 const one=standard.execute(edit) as SourceSnapshotDelta,two=consuming.execute(edit) as SourceSnapshotDelta;expect(one.next).toEqual(two.next);
 const incoming=structuredClone(document);incoming.comments=[{id:"native",text:"Native comment",createdAt:document.createdAt,resolved:false}];
 (incoming as any).nativeUnknown={keep:true};const current=body(standard,one.next),merged=mergePageContent(document,current,incoming);
 expect(merged.conflicts).toEqual([]);
 const input:Publication={current:one.next,publicationId:"genuine-three-way",packet:{pageId:document.id,document:incoming,baseDocument:document},result:merged,leaseId:"merged-output"};
 const plain=standard.registerActualMergedPublication(input),parsed=consuming.registerActualMergedJSON(JSON.stringify(input));
 expect(JSON.stringify(parsed)).toBe(JSON.stringify(plain));const result=body(consuming,parsed.next);
 expect(result.title).toBe("Foreign title");expect(result.comments![0].text).toBe("Native comment");expect((result as any).nativeUnknown.keep).toBe(true);
 expect(body(consuming,ref).title).toBe(document.title);expect(body(consuming,ref).comments).not.toEqual(incoming.comments);
});
it("rejects parsed nonfinite values, malformed JSON, actual invalid references and invalid document fields",()=>{
 const {document,standard,consuming,ref}=pair(),input=request(document,ref);
 (input.packet as any).numeric=987654321;
 const nonfinite=JSON.stringify(input).replace('"numeric":987654321','"numeric":1e999');
 expect(()=>consuming.registerActualMergedJSON(nonfinite)).toThrow(/non-JSON|finite/);
 (input.packet as any).numeric=Infinity;expect(()=>standard.registerActualMergedPublication(input)).toThrow(/non-JSON/);
 expect(()=>consuming.registerActualMergedJSON('{"broken":')).toThrow();
 for(const patch of [{epoch:"expired"},{kind:"draft"},{scope:{...ref.scope,homeId:"another-home"}}]){
  const invalid=request(document,{...ref,...patch} as SourceSnapshotRef);expect(()=>consuming.registerActualMergedJSON(JSON.stringify(invalid))).toThrow(/epoch|proof|scope|expired/);
 }
 const invalid=request(document,ref);invalid.publicationId="invalid-date";invalid.result.document.createdAt="invalid date";expect(()=>consuming.registerActualMergedJSON(JSON.stringify(invalid))).toThrow(/ISO/);
 const reserved=request(document,ref);reserved.publicationId="reserved-key";(reserved.result.document as any).literalKeys=JSON.parse('{"__proto__":{"keep":true}}');
 expect(()=>standard.registerActualMergedPublication(reserved)).toThrow(/reserved key/);
 expect(()=>consuming.registerActualMergedJSON(JSON.stringify(reserved))).toThrow(/reserved key/);expect(({} as any).keep).toBeUndefined();
});
it("retains full document capacity rejection on the exclusive parsed path",()=>{
 const {document,standard,consuming,ref}=pair(),input=request(document,ref);
 (input.result.document as any).futureTooLarge="x".repeat(CAPACITY.pageStructureBytes+1);
 expect(()=>standard.registerActualMergedPublication(input)).toThrow(/Page structure/);
 expect(()=>consuming.registerActualMergedJSON(JSON.stringify(input))).toThrow(/Page structure/);
});
