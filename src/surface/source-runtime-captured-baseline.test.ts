import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {appendNewPortableInk} from "./portable-ink-append.mjs";
import {longCubicInputFixture} from "./cubic-ink-chunks.fixture.mjs";
import {mergePageContent} from "../core/page-merge-model";
import {SourceRuntimeOwner,type SourceSnapshotDelta,type SourceSnapshotRef,type NativeSourceEnvelope} from "./source-runtime";
import type {ShowDocument} from "../types";
const body=(owner:SourceRuntimeOwner,ref:SourceSnapshotRef)=>(owner.execute({kind:"resolve",ref}) as {document:ShowDocument}).document;
function setup(){
 let document=createResource(blankDocument(),"board") as ShowDocument;
 document.createdAt="2026-10-21T00:00:00Z";document.updatedAt="2026-10-22T00:00:00Z";
 const ink=longCubicInputFixture(321),boardId=document.content.attrs!.id as string;
 document=appendNewPortableInk(document,boardId,{type:"drawing",attrs:{id:"existing",tool:"pen",color:"#111111",strokeWidth:4,extent:ink.extent,points:[{x:0,y:100},{x:640,y:100}],ink}},{x:4,y:5,width:650,height:160});
 (document as any).futureRoot={"é":"NFC","é":"NFD",items:[false,null,"中文"]};
 const scope={homeId:"captured-home",projectId:"captured-project",pageId:document.id},owner=new SourceRuntimeOwner({ownerId:"actual-owner",epoch:"actual-epoch"});
 const seed=owner.execute({kind:"seed",scope,document,proof:"normalized",leaseId:"seed"}) as SourceSnapshotDelta;
 const base=body(owner,seed.next),packet={pageId:base.id,boardId,token:"real-native-token",document:base,baseDocument:base,operationIds:[],futurePacket:{keep:"unknown"}};
 const envelope:NativeSourceEnvelope={format:"showai-native-source-v1",scope:{projectId:scope.projectId,pageId:scope.pageId,boardId,token:packet.token},publicationId:"first",basePublicationId:null,sourceVersion:1,full:packet};
 const raw=JSON.stringify({current:seed.next,envelope,leaseId:"result"});return{owner,scope,seed,base,packet,envelope,raw};
}
it("matches complete full publication semantics and retains actual source leaves on its first captured envelope",()=>{
 const f=setup(),oracle=new SourceRuntimeOwner({ownerId:f.owner.ownerId,epoch:f.owner.epoch}),seed=oracle.execute({kind:"seed",scope:f.scope,document:f.base,proof:"normalized",leaseId:"seed"}) as SourceSnapshotDelta;
 const result=f.owner.registerActualNativeEnvelopeJSON(f.raw,undefined,f.seed.next) as SourceSnapshotDelta,expected=oracle.registerActualNativeEnvelopeJSON(f.raw) as SourceSnapshotDelta;
 expect(result).toEqual(expected);expect(body(f.owner,result.next)).toEqual(body(oracle,expected.next));expect(seed.next).toEqual(f.seed.next);
 expect(body(f.owner,result.next).content.content![0]).toBe(f.base.content.content![0]);
 expect(body(f.owner,result.next).content.content![0].attrs!.ink.capture.raw).toBe(f.base.content.content![0].attrs!.ink.capture.raw);
 expect(f.owner.nativePublicationDocumentMatching({ref:result.next,document:body(f.owner,result.next)})?.sourceVersion).toBe(1);
});
it("retains missing-default and unknown literal fields identically to the existing native JSON route",()=>{
 const f=setup(),document=structuredClone(f.base);for(const key of ["icon","cover","parentId","favorite","archived"] as const)delete document[key];
 const request={current:f.seed.next,publicationId:"defaults",sourceVersion:1,packet:{...f.packet,document},leaseId:"default-output"};
 const result=f.owner.registerActualNativeJSONIfUnchanged(JSON.stringify(request),undefined,f.seed.next)!;
 expect(body(f.owner,result.next).icon).toBe("✦");expect(body(f.owner,result.next).cover).toBe("none");expect((body(f.owner,result.next) as any).futureRoot).toEqual((f.base as any).futureRoot);
 expect(body(f.owner,result.next).content.content![0]).toBe(f.base.content.content![0]);
});
it("keeps real concurrent UI fields on the existing merged route and never treats candidate identity as equality",()=>{
 const f=setup(),foreign=f.owner.execute({kind:"draft",base:f.seed.next,transactionId:"foreign",edits:[{op:"set",path:["title"],value:"Foreign UI"}],leaseId:"foreign"}) as SourceSnapshotDelta;
 expect(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify({...JSON.parse(f.raw),current:foreign.next}),undefined,foreign.next)).toBeNull();
 const incoming=structuredClone(f.base);incoming.comments=[{id:"actual",text:"Native comment",createdAt:incoming.createdAt,resolved:false}];
 const merged=mergePageContent(f.base,body(f.owner,foreign.next),incoming);expect(merged.conflicts).toEqual([]);
 const request={current:foreign.next,publicationId:"real-merge",packet:{...f.packet,document:incoming},result:merged,leaseId:"merged"};
 const result=f.owner.registerActualMergedJSON(JSON.stringify(request),undefined,foreign.next);
 expect(body(f.owner,result.next).title).toBe("Foreign UI");expect(body(f.owner,result.next).comments![0].text).toBe("Native comment");expect(body(f.owner,result.next).content.content![0].attrs!.ink.capture.raw).toBe(f.base.content.content![0].attrs!.ink.capture.raw);
});
it("resolves expected refs before parsing and rejects a different live raw ref before publication/cache mutation",()=>{
 const f=setup(),other=f.owner.execute({kind:"draft",base:f.seed.next,transactionId:"other",edits:[{op:"set",path:["title"],value:"other"}],leaseId:"other"}) as SourceSnapshotDelta;
 expect(()=>f.owner.registerActualNativeEnvelopeJSON(f.raw,undefined,other.next)).toThrow(/separately retained/);
 for(const patch of [{epoch:"foreign"},{ownerId:"foreign"},{kind:"draft"},{scope:{...f.scope,projectId:"another"}}])expect(()=>f.owner.registerActualNativeEnvelopeJSON("not JSON",undefined,{...f.seed.next,...patch} as SourceSnapshotRef)).toThrow(/owner|epoch|scope|proof/);
 const result=f.owner.registerActualNativeEnvelopeJSON(f.raw,undefined,f.seed.next) as SourceSnapshotDelta;expect(result.next.snapshotId).toBe("snapshot-3");
 f.owner.execute({kind:"dispose",scope:f.scope});expect(()=>f.owner.registerActualNativeEnvelopeJSON(f.raw,undefined,f.seed.next)).toThrow(/expired/);
});
it("registers actual saved JSON from the live base with strict scope/ref checks and isolated object callers",()=>{
 const f=setup(),document=structuredClone(f.base);document.updatedAt="2026-10-22T01:02:03Z";
 const request={scope:f.scope,base:f.seed.next,document,leaseId:"saved"},stages:string[]=[],saved=f.owner.registerActualSavedJSON(JSON.stringify(request),f.seed.next,(stage)=>stages.push(stage)),actual=body(f.owner,saved.next);
 expect(stages).toContain("parse");expect(stages).toContain("saved.capture");expect(stages).toContain("register.share");
 expect(actual).toEqual(document);expect(actual.content).toBe(f.base.content);expect(actual.content.content![0].attrs!.ink.capture.raw).toBe(f.base.content.content![0].attrs!.ink.capture.raw);
 expect(f.owner.normalizedDocumentMatching({ref:saved.next,document:actual})).toBe(actual);
 const edited=structuredClone(document);edited.title="actual backend modification";const changed=f.owner.registerActualSavedJSON(JSON.stringify({...request,document:edited}),f.seed.next);expect(body(f.owner,changed.next).title).toBe(edited.title);
 expect(()=>f.owner.registerActualSavedJSON(JSON.stringify({...request,base:saved.next}),f.seed.next)).toThrow(/separately retained/);
 expect(()=>f.owner.registerActualSavedJSON(JSON.stringify({...request,scope:{...f.scope,homeId:"other"}}),f.seed.next)).toThrow(/scope|crosses/);
 const outside=structuredClone(document),result=f.owner.registerActualSavedSnapshot({...request,document:outside});outside.title="mutated later";expect(body(f.owner,result.next).title).toBe(document.title);
 expect(()=>f.owner.execute({kind:"saved",...request} as any)).toThrow(/Unknown/);
});
it("rejects malformed root-set suffixes atomically and keeps old pins usable through failed output retention",()=>{
 const f=setup(),first=f.owner.registerActualNativeEnvelopeJSON(f.raw,undefined,f.seed.next) as SourceSnapshotDelta,before=body(f.owner,first.next);
 const request={current:first.next,envelope:{...f.envelope,full:undefined,publicationId:"next",basePublicationId:"first",sourceVersion:2,edits:[{op:"set",path:[],value:f.packet},{op:"set",path:["document","missing","bad"],value:1}]},leaseId:"next"};delete request.envelope.full;
 expect(()=>f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(request),undefined,first.next)).toThrow(/missing/);expect(body(f.owner,first.next)).toBe(before);
 request.envelope.edits=[{op:"set",path:["futurePacket","keep"],value:"changed captured metadata"}] as any;
 const result=f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(request),undefined,first.next) as SourceSnapshotDelta;
 expect(body(f.owner,result.next)).toEqual(before);
 const pressured=new SourceRuntimeOwner({maximumResidentBytes:1,maximumUnleased:0,maximumPinned:1}),seed=pressured.execute({kind:"seed",scope:f.scope,document:f.base,proof:"normalized",leaseId:"pinned"}) as SourceSnapshotDelta;
 expect(()=>pressured.registerActualSavedJSON(JSON.stringify({scope:f.scope,base:seed.next,document:f.base,leaseId:"over-budget"}),seed.next)).toThrow(/retention/);
 expect(body(pressured,seed.next)).toEqual(f.base);pressured.execute({kind:"release",leaseId:"pinned"});
 expect(()=>pressured.registerActualSavedJSON(JSON.stringify({scope:f.scope,base:seed.next,document:f.base}),seed.next)).toThrow(/expired/);
});
it("uses the held expected ref after entry and re-resolves it after a reentrant observer retires its scope",()=>{
 const f=setup(),external=structuredClone(f.seed.next);
 const result=f.owner.registerActualNativeEnvelopeJSON(f.raw,(stage)=>{if(stage==="parse"){external.snapshotId="changed-outside";external.scope.homeId="changed-outside"}},external) as SourceSnapshotDelta;
 expect(body(f.owner,result.next)).toEqual(f.base);
 const retired=setup();expect(()=>retired.owner.registerActualNativeEnvelopeJSON(retired.raw,(stage)=>{if(stage==="parse")retired.owner.execute({kind:"dispose",scope:retired.scope})},retired.seed.next)).toThrow(/expired/);
 const saved=setup(),request={scope:saved.scope,base:saved.seed.next,document:saved.base,leaseId:"saved"};
 expect(()=>saved.owner.registerActualSavedJSON(JSON.stringify(request),saved.seed.next,(stage)=>{if(stage==="parse")saved.owner.execute({kind:"dispose",scope:saved.scope})})).toThrow(/expired/);
});

it("preserves a native origin across the actual timestamp-only saved receipt without comparing the retained body again",()=>{
 const f=setup(),first=f.owner.registerActualNativeEnvelopeJSON(f.raw,undefined,f.seed.next) as SourceSnapshotDelta;
 const baseline=body(f.owner,first.next),document=structuredClone(baseline);document.updatedAt="2026-10-22T03:04:05Z";
 const stages:string[]=[],saved=f.owner.registerActualSavedJSON(JSON.stringify({scope:f.scope,base:first.next,document,leaseId:"saved-native"}),first.next,(stage)=>stages.push(stage));
 const actual=body(f.owner,saved.next);
 expect(actual).toEqual(document);expect(actual.content).toBe(baseline.content);
 expect(actual.content.content![0].attrs!.ink.capture.raw).toBe(baseline.content.content![0].attrs!.ink.capture.raw);
 expect(f.owner.nativePublicationDocumentMatching({ref:saved.next,document:actual})?.sourceVersion).toBe(1);
 expect(stages).not.toContain("register.nativeOrigin.compare");
 for(const edit of [(d:ShowDocument)=>{d.title="backend title"},(d:ShowDocument)=>{d.content.content![0].attrs!.color="#abcdef"},(d:ShowDocument)=>{(d as any).futureRoot.extra="backend root"}]){
  const changed=structuredClone(document);edit(changed);const compared:string[]=[];
  const result=f.owner.registerActualSavedJSON(JSON.stringify({scope:f.scope,base:saved.next,document:changed,leaseId:"changed-native"}),saved.next,(stage)=>compared.push(stage));
  const resultBody=body(f.owner,result.next);expect(resultBody).toEqual(changed);
  expect(compared).toContain("register.nativeOrigin.compare");
  expect(f.owner.nativePublicationDocumentMatching({ref:result.next,document:resultBody})).toBeNull();
 }
});
