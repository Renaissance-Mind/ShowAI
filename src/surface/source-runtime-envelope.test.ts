import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {appendNewPortableInk} from "./portable-ink-append.mjs";
import {longCubicInputFixture} from "./cubic-ink-chunks.fixture.mjs";
import {diffNativeSource} from "./native-source-delta.mjs";
import {SourceRuntimeOwner,type SourceSnapshotDelta,type SourceSnapshotRef,type NativeSourceEnvelope,type NativeSourceEnvelopeRequest,type NativeSourceEnvelopeResult} from "./source-runtime";
import type {ShowDocument} from "../types";
import type {JSONContent} from "@tiptap/core";
const body=(owner:SourceRuntimeOwner,ref:SourceSnapshotRef)=>(owner.execute({kind:"resolve",ref}) as {document:ShowDocument}).document;
function setup(options:ConstructorParameters<typeof SourceRuntimeOwner>[0]={}){
 const raw=createResource(blankDocument(),"board") as ShowDocument,owner=new SourceRuntimeOwner(options),scope={homeId:"envelope-home",projectId:"envelope-project",pageId:raw.id};
 const seed=owner.execute({kind:"seed",scope,document:raw,proof:"normalized",leaseId:"current"}) as SourceSnapshotDelta;
 const document=body(owner,seed.next),boardId=document.content.attrs!.id as string;
 const transportScope={projectId:scope.projectId,pageId:scope.pageId,boardId,token:"actual-captured-token"};
 const node=(id:string,count=257):JSONContent=>{const ink=longCubicInputFixture(count);return{type:"drawing",attrs:{id,tool:"pen",color:"#111111",strokeWidth:4,extent:ink.extent,points:[{x:0,y:100},{x:(count-1)*2,y:100}],ink}}};
 const authored=appendNewPortableInk(document,boardId,node("stroke-a"),{x:3,y:4,width:540,height:160});
 const packet={pageId:raw.id,boardId,token:transportScope.token,document:authored,baseDocument:document,operationIds:["actual-a"],nativeContentActions:[],futurePacket:{"é":1,"é":2,all:[false,null,"中文"]}};
 const envelope:NativeSourceEnvelope={format:"showai-native-source-v1",scope:transportScope,publicationId:"actual-first",basePublicationId:null,sourceVersion:1,full:packet};
 const request:NativeSourceEnvelopeRequest={current:seed.next,envelope,leaseId:"first-output"};
 return{owner,scope,seed,document,node,boardId,packet,request};
}
function output(value:NativeSourceEnvelopeResult):SourceSnapshotDelta{expect(value).not.toBeNull();expect(value).not.toEqual({requiresFull:true});return value as SourceSnapshotDelta}
function nextRequest(f:ReturnType<typeof setup>,first:SourceSnapshotDelta,id="actual-second"){
 const document=appendNewPortableInk(f.packet.document,f.boardId,f.node("stroke-b",65),{x:10,y:200,width:160,height:160});
 const packet={...f.packet,document,baseDocument:f.packet.document,operationIds:["actual-b"],futurePacket:{...f.packet.futurePacket,next:"all metadata retained"}};
 const envelope:NativeSourceEnvelope={format:"showai-native-source-v1",scope:f.request.envelope.scope,publicationId:id,basePublicationId:f.request.envelope.publicationId,sourceVersion:2,edits:diffNativeSource(f.packet,packet)};
 return{packet,request:{current:first.next,envelope,leaseId:"second-output"} satisfies NativeSourceEnvelopeRequest};
}
it("matches the complete existing canonical factory and independently preserves the caller's full envelope",()=>{
 const f=setup(),before=structuredClone(f.request),result=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request)));
 const oracle=new SourceRuntimeOwner(),seed=oracle.execute({kind:"seed",scope:f.scope,document:f.document,proof:"normalized",leaseId:"oracle"}) as SourceSnapshotDelta;
 const expected=oracle.registerActualNativeJSONIfUnchanged(JSON.stringify({current:seed.next,publicationId:f.request.envelope.publicationId,sourceVersion:1,packet:f.packet,leaseId:"oracle-output"}))!;
 expect(body(f.owner,result.next)).toEqual(body(oracle,expected.next));expect(f.request).toEqual(before);
 expect(f.owner.nativePublicationDocumentMatching({ref:result.next,document:body(f.owner,result.next)})?.publicationId).toBe("actual-first");
 const retry=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify({...f.request,current:result.next})));
 expect(body(f.owner,retry.next)).toEqual(body(f.owner,result.next));
});
it("applies actual transport edits against the retained packet and shares untouched editable input source",()=>{
 const f=setup(),first=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request))),next=nextRequest(f,first),raw=JSON.stringify(next.request);
 expect(raw).not.toContain('"full"');expect(raw.length).toBeLessThan(JSON.stringify({...next.request,envelope:{...next.request.envelope,edits:undefined,full:next.packet}}).length);
 const result=output(f.owner.registerActualNativeEnvelopeJSON(raw)),actual=body(f.owner,result.next),previous=body(f.owner,first.next);
 expect(actual.content.content).toHaveLength(2);expect(actual.content.content![0]).toBe(previous.content.content![0]);
 expect(actual.content.content![0].attrs!.ink.capture.raw).toHaveLength(257);expect(actual.content.content![1].attrs!.ink.capture.raw).toHaveLength(65);
 const oracle=new SourceRuntimeOwner(),seed=oracle.execute({kind:"seed",scope:f.scope,document:previous,proof:"normalized",leaseId:"oracle"}) as SourceSnapshotDelta;
 const expected=oracle.registerActualNativeJSONIfUnchanged(JSON.stringify({current:seed.next,publicationId:next.request.envelope.publicationId,sourceVersion:2,packet:next.packet,leaseId:"oracle-output"}))!;
 expect(actual).toEqual(body(oracle,expected.next));expect(f.owner.nativePublicationDocumentMatching({ref:result.next,document:actual})?.sourceVersion).toBe(2);
});
it("requests a captured full packet on an unknown base without publishing or inventing an output",()=>{
 const f=setup(),request={...f.request,envelope:{...f.request.envelope,basePublicationId:"not-retained",edits:[]}};delete request.envelope.full;
 expect(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(request))).toEqual({requiresFull:true});
 expect(body(f.owner,f.seed.next)).toBe(f.document);
 const full=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request)));expect(full.next.snapshotId).toBe("snapshot-2");
});
it("resolves an evicted packet through its actual pinned origin and refuses it after its scope retires",()=>{
 const f=setup({maximumResidentBytes:1,maximumUnleased:0}),first=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request))),next=nextRequest(f,first);
 const result=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(next.request)));expect(body(f.owner,result.next).content.content).toHaveLength(2);
 f.owner.execute({kind:"dispose",scope:f.scope});expect(()=>f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(next.request))).toThrow(/expired/);
});
it("checks real owner and epoch plus envelope Board, token, version, literal scope and exact edit structure",()=>{
 const f=setup(),first=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request))),next=nextRequest(f,first);
 const changes=[
  (v:any)=>{v.current.epoch="expired"},(v:any)=>{v.current.ownerId="foreign"},(v:any)=>{v.current.kind="draft"},
  (v:any)=>{v.envelope.scope.pageId="foreign"},(v:any)=>{v.envelope.scope.projectId="foreign"},
  (v:any)=>{v.envelope.scope.token="foreign"},(v:any)=>{v.envelope.scope.boardId="foreign"},(v:any)=>{v.envelope.sourceVersion=0},
  (v:any)=>{v.envelope.sourceVersion=0.5},(v:any)=>{v.envelope.edits=[{op:"set",path:["document","missing","title"],value:1}]},
  (v:any)=>{v.envelope.extra="asserted-proof"},(v:any)=>{v.envelope.full=next.packet},(v:any)=>{v.envelope.scope.extra="asserted-home"},
 ];
 for(const mutate of changes){const changed=structuredClone(next.request);mutate(changed);expect(()=>f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(changed))).toThrow()}
 expect(body(f.owner,first.next).content.content).toHaveLength(1);expect(output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(next.request))).next.kind).toBe("normalized");
 expect(()=>f.owner.execute({kind:"registerActualNativeEnvelopeJSON",...next.request} as any)).toThrow(/Unknown/);
});
it("rejects publication reuse with changed source or version instead of lending its normalization proof",()=>{
 const f=setup(),first=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request))),next=nextRequest(f,first);
 const actual=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(next.request))),before=body(f.owner,actual.next);
 for(const mutate of [(v:any)=>{v.envelope.sourceVersion=3},(v:any)=>{v.envelope.edits.push({op:"set",path:["document","title"],value:"changed"})},(v:any)=>{v.envelope.edits.push({op:"set",path:["futurePacket","é"],value:99})}]){
  const changed=structuredClone(next.request);mutate(changed);expect(()=>f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(changed))).toThrow(/identity|transport|version/);
 }
 expect(body(f.owner,actual.next)).toBe(before);
});
it("preserves actual foreign edits and native semantic actions on the ordinary merge route",()=>{
 const f=setup(),first=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request))),next=nextRequest(f,first);
 const foreign=f.owner.execute({kind:"draft",base:first.next,transactionId:"actual-foreign-title",edits:[{op:"set",path:["title"],value:"Actual concurrent B"}],leaseId:"foreign"}) as SourceSnapshotDelta;
 expect(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify({...next.request,current:foreign.next}))).toBeNull();expect(body(f.owner,foreign.next).title).toBe("Actual concurrent B");
 const content=nextRequest(f,first,"actual-semantic-action");content.packet.nativeContentActions=[{groupId:"real-object-action",beforeDocument:f.packet.document,document:content.packet.document} as never];
 content.request.envelope.edits=diffNativeSource(f.packet,content.packet);
 expect(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(content.request))).toBeNull();
});
it("preserves a pinned actual baseline after a canonical failure and still accepts its later correct delta",()=>{
 const f=setup({maximumResidentBytes:1,maximumUnleased:0}),first=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request))),before=body(f.owner,first.next);
 const invalid=nextRequest(f,first,"invalid-source"),node=invalid.packet.document.content.content![1];
 // Corrupt a genuinely generated source after its independent first capture.
 node.attrs!.ink.geometryVersion=2;invalid.request.envelope.edits=diffNativeSource(f.packet,invalid.packet);
 expect(()=>f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(invalid.request))).toThrow(/version|Unsupported|ink/);
 expect(body(f.owner,first.next)).toBe(before);expect(f.owner.nativePublicationDocumentMatching({ref:first.next,document:before})?.publicationId).toBe("actual-first");
 const next=nextRequest(f,first),result=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(next.request)));
 expect(body(f.owner,result.next).content.content).toHaveLength(2);
});
it("keeps the previous actual origin and lease intact when the new output exceeds retention budget",()=>{
 const f=setup({maximumPinned:2}),first=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(f.request))),before=body(f.owner,first.next),next=nextRequest(f,first);
 expect(()=>f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(next.request))).toThrow(/retention/);
 expect(body(f.owner,first.next)).toBe(before);expect(f.owner.nativePublicationDocumentMatching({ref:first.next,document:before})?.sourceVersion).toBe(1);
 f.owner.execute({kind:"release",leaseId:"current"});
 const result=output(f.owner.registerActualNativeEnvelopeJSON(JSON.stringify(next.request)));expect(body(f.owner,result.next).content.content).toHaveLength(2);
});
