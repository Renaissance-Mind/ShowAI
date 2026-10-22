import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {appendNewPortableInk} from "./portable-ink-append.mjs";
import {longCubicInputFixture} from "./cubic-ink-chunks.fixture.mjs";
import {parseOwnedJSON,capturedContentSummary} from "../portable/owned-json.mjs";
import {SourceRuntimeOwner,freezeOwnedSource,type SourceSnapshotDelta,type SourceSnapshotRef,type SourceRuntimeRequest} from "./source-runtime";
import type {ShowDocument} from "../types";
const resolve=(owner:SourceRuntimeOwner,ref:SourceSnapshotRef)=>(owner.execute({kind:"resolve",ref}) as {document:ShowDocument}).document;
function setup(){
 let document=createResource(blankDocument(),"board") as ShowDocument;
 document.createdAt="2026-10-21T00:00:00.000Z";document.updatedAt="2026-10-22T00:00:00.000Z";
 const ink=longCubicInputFixture(321),boardId=document.content.attrs!.id as string;
 document=appendNewPortableInk(document,boardId,{type:"drawing",attrs:{id:"first",tool:"pen",color:"#111111",strokeWidth:4,extent:ink.extent,points:[{x:0,y:100},{x:640,y:100}],ink}},{x:4,y:5,width:650,height:160});
 (document as any).futureRoot={"é":"NFC","é":"NFD",comments:["中文",null,false]};
 const scope={homeId:"registry-home",projectId:"registry-project",pageId:document.id},owner=new SourceRuntimeOwner();
 return{document,scope,owner,boardId,ink};
}
it("keeps actual private JSON capture through seed and timestamp draft without minting model proof",()=>{
 const f=setup(),request=parseOwnedJSON(JSON.stringify({kind:"seed",scope:f.scope,document:f.document,proof:"draft",leaseId:"seed"})) as SourceRuntimeRequest;
 const input=(request as Extract<SourceRuntimeRequest,{kind:"seed"}>).document,first=f.owner.execute(request) as SourceSnapshotDelta,base=resolve(f.owner,first.next);
 expect(base).toBe(input);expect(capturedContentSummary(base)).toBeDefined();expect(first.next.kind).toBe("draft");
 expect(f.owner.normalizedDocumentMatching({ref:first.next,document:base})).toBeNull();
 const draftRequest=parseOwnedJSON(JSON.stringify({kind:"draft",base:first.next,transactionId:"timestamp",edits:[{op:"set",path:["updatedAt"],value:"2026-10-22T01:00:00.000Z"}],leaseId:"next"})) as SourceRuntimeRequest;
 const next=f.owner.execute(draftRequest) as SourceSnapshotDelta,current=resolve(f.owner,next.next);
 expect(current.content).toBe(base.content);expect(capturedContentSummary(current)).toBeDefined();expect(current.updatedAt).toBe("2026-10-22T01:00:00.000Z");
 expect(f.owner.normalizedDocumentMatching({ref:next.next,document:current})).toBeNull();
});
it("keeps arbitrary mutable and generic frozen callers on their independent boundary",()=>{
 const f=setup(),first=f.owner.execute({kind:"seed",scope:f.scope,document:f.document,proof:"draft",leaseId:"mutable"}) as SourceSnapshotDelta;
 f.document.title="outside mutation";expect(resolve(f.owner,first.next).title).not.toBe(f.document.title);
 const outside=freezeOwnedSource(structuredClone(f.document)),next=f.owner.execute({kind:"seed",scope:f.scope,document:outside,proof:"draft",leaseId:"generic-freeze"}) as SourceSnapshotDelta;
 expect(resolve(f.owner,next.next)).not.toBe(outside);expect(capturedContentSummary(outside)).toBeUndefined();
});
it("keeps full native and ordinary canonical results equal after real captured seed and author drafts",()=>{
 const f=setup(),seed=f.owner.execute(parseOwnedJSON(JSON.stringify({kind:"seed",scope:f.scope,document:f.document,proof:"draft",leaseId:"seed"})) as SourceRuntimeRequest) as SourceSnapshotDelta;
 const base=resolve(f.owner,seed.next),canonical=f.owner.execute({kind:"normalize",ref:seed.next,leaseId:"canonical"}) as SourceSnapshotDelta;
 const packet={pageId:base.id,boardId:f.boardId,token:"actual-token",document:base,baseDocument:base,operationIds:[],futurePacket:{"é":1,"é":2}};
 const request={current:seed.next,envelope:{format:"showai-native-source-v1",scope:{projectId:f.scope.projectId,pageId:f.scope.pageId,boardId:f.boardId,token:packet.token},publicationId:"one",basePublicationId:null,sourceVersion:1,full:packet},leaseId:"publication"};
 const result=f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(request),undefined,seed.next) as SourceSnapshotDelta;
 expect(resolve(f.owner,result.next)).toEqual(resolve(f.owner,canonical.next));expect(result.next.kind).toBe("normalized");
 expect(resolve(f.owner,result.next).content.content![0].attrs!.ink.capture.raw).toBe(base.content.content![0].attrs!.ink.capture.raw);
 const current=resolve(f.owner,result.next),foreign=f.owner.execute(parseOwnedJSON(JSON.stringify({kind:"draft",base:result.next,transactionId:"foreign",edits:[{op:"set",path:["title"],value:"Foreign root"}],leaseId:"foreign"})) as SourceRuntimeRequest) as SourceSnapshotDelta;
 expect(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify({...request,current:foreign.next,envelope:{...request.envelope,publicationId:"foreign"}}),undefined,foreign.next)).toBeNull();
 expect(resolve(f.owner,foreign.next).title).toBe("Foreign root");expect(resolve(f.owner,foreign.next).content).toBe(current.content);
});

it("reuses only an actual validated exact writer baseline and still validates missing defaults and malformed fields",()=>{
 const f=setup(),seed=f.owner.execute(parseOwnedJSON(JSON.stringify({kind:"seed",scope:f.scope,document:f.document,proof:"normalized",leaseId:"seed"})) as SourceRuntimeRequest) as SourceSnapshotDelta;
 const current=resolve(f.owner,seed.next),packet={pageId:current.id,boardId:f.boardId,token:"exact-writer",document:current,baseDocument:current,operationIds:[]};
 const request={current:seed.next,publicationId:"exact-base",sourceVersion:1,packet,leaseId:"output"},stages:string[]=[];
 const result=f.owner.registerActualNativeJSONIfUnchanged(JSON.stringify(request),(stage)=>stages.push(stage),seed.next)!;
 expect(resolve(f.owner,result.next)).toEqual(current);expect(stages).not.toContain("unchanged.normalizeBase");
 expect(stages).toContain("unchanged.normalizeIncoming");
 const missing={...packet,document:structuredClone(packet.document),baseDocument:structuredClone(packet.baseDocument)};delete (missing.document as Partial<ShowDocument>).icon;delete (missing.document as Partial<ShowDocument>).cover;
 const normalized=f.owner.registerActualNativeJSONIfUnchanged(JSON.stringify({...request,publicationId:"defaults",packet:missing}),undefined,seed.next)!;
 expect(resolve(f.owner,normalized.next).icon).toBe("✦");expect(resolve(f.owner,normalized.next).cover).toBe("none");
 for(const change of [(p:typeof packet)=>{p.baseDocument.updatedAt="invalid"},(p:typeof packet)=>{p.document.content.content![0].attrs!.ink.segments[0].radius[0]=-1}]){
  const invalid={...packet,document:structuredClone(packet.document),baseDocument:structuredClone(packet.baseDocument)};change(invalid);
  expect(()=>f.owner.registerActualNativeJSONIfUnchanged(JSON.stringify({...request,publicationId:"invalid",packet:invalid}),undefined,seed.next)).toThrow();
 }
});
