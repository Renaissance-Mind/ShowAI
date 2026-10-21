import {expect,it} from "vitest";
import {SourceRuntimeOwner,cloneSourceValue,ownSourceValue,isOwnedSource,type SourceSnapshotDelta,type SourceSnapshotRef} from "./source-runtime";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import type {ShowDocument} from "../types";
const source=()=>createResource(blankDocument(),"board") as ShowDocument;
const actualScope=(document:ShowDocument)=>({homeId:"actual-home",projectId:"actual-project",pageId:document.id});
const delta=(value:unknown)=>value as SourceSnapshotDelta;
function setup(options:ConstructorParameters<typeof SourceRuntimeOwner>[0]={}){const owner=new SourceRuntimeOwner(options),document=source(),scope=actualScope(document),seed=delta(owner.execute({kind:"seed",scope,document,proof:"normalized",leaseId:"current"}));return{owner,document,scope,seed};}
const resolve=(owner:SourceRuntimeOwner,ref:SourceSnapshotRef)=>(owner.execute({kind:"resolve",ref}) as {document:ShowDocument}).document;
it("registers a private immutable exact draft and canonical normalization preserves unknown root fields",()=>{
 const owner=new SourceRuntimeOwner(),document=source();(document as any).futureRoot={unknown:["é","é",null]};
 const snapshot=delta(owner.execute({kind:"seed",scope:actualScope(document),document,proof:"normalized",leaseId:"current"})),body=resolve(owner,snapshot.next);
 expect((body as any).futureRoot).toEqual((document as any).futureRoot);expect(body).not.toBe(document);expect(body.content).not.toBe(document.content);
 expect(Object.isFrozen(body)).toBe(true);expect(()=>{body.title="illegal"}).toThrow();expect(()=>{body.content.attrs!.future="illegal"}).toThrow();
 document.title="outside mutable writer";expect(body.title).not.toBe(document.title);
});
it("rejects foreign owner, epoch, project, home, page and forged proof references",()=>{
 const {owner,seed}=setup();for(const change of [{ownerId:"different"},{epoch:"different"},{kind:"draft"},{scope:{...seed.next.scope,homeId:"different"}},{scope:{...seed.next.scope,projectId:"different"}},{scope:{...seed.next.scope,pageId:"different"}}])
  expect(()=>owner.execute({kind:"resolve",ref:{...seed.next,...change} as SourceSnapshotRef})).toThrow();
});
it("admits small draft patches without canonical validation and normalizes only at the real barrier",()=>{
 const {owner,seed}=setup();
 const edited=delta(owner.execute({kind:"draft",base:seed.next,transactionId:"actual-command-1",edits:[{op:"set",path:["title"],value:"Immediate text"}],leaseId:"pending-1"}));
 expect(edited.next.kind).toBe("draft");expect(edited.edits).toEqual([{op:"set",path:["title"],value:"Immediate text"}]);
 expect(resolve(owner,edited.next).content).toBe(resolve(owner,seed.next).content);
 const invalid=delta(owner.execute({kind:"draft",base:edited.next,transactionId:"actual-command-2",edits:[{op:"set",path:["createdAt"],value:"not an ISO date"}],leaseId:"pending-2"}));
 expect(()=>owner.execute({kind:"normalize",ref:invalid.next,leaseId:"save"})).toThrow(/ISO/);
 expect(resolve(owner,invalid.next).title).toBe("Immediate text");
 const normalized=delta(owner.execute({kind:"normalize",ref:edited.next,leaseId:"save"}));expect(normalized.next.kind).toBe("normalized");expect(resolve(owner,normalized.next).title).toBe("Immediate text");
});
it("deduplicates actual transactions and rejects changed bodies with the same transaction identity",()=>{
 const {owner,seed}=setup(),request={kind:"draft" as const,base:seed.next,transactionId:"actual-command",edits:[{op:"set" as const,path:["title"],value:"one"}],leaseId:"draft"};
 const one=delta(owner.execute(request)),again=delta(owner.execute(request));expect(again.next).toEqual(one.next);
 expect(()=>owner.execute({...request,edits:[{op:"set",path:["title"],value:"two"}]})).toThrow(/identity/);
});
it("keeps writer baseline separate from latest transport source and merges complete unknown fields",()=>{
 const {owner,document,seed}=setup(),current=delta(owner.execute({kind:"draft",base:seed.next,transactionId:"actual-local-title",edits:[{op:"set",path:["title"],value:"Local B"},{op:"set",path:["futureLocal"],value:{keep:true}}],leaseId:"current"}));
 const incoming=cloneSourceValue(document);incoming.comments=[{id:"remote",text:"Remote comment",createdAt:document.createdAt,resolved:false}];
 const packet={pageId:document.id,document:incoming,baseDocument:document,unknownPacket:{keep:"all metadata"}},before=cloneSourceValue(packet);
 const publication=delta(owner.execute({kind:"publication",current:current.next,publicationId:"actual-publication",packet,leaseId:"publication"})),merged=resolve(owner,publication.next);
 expect(merged.title).toBe("Local B");expect((merged as any).futureLocal).toEqual({keep:true});expect(merged.comments![0].text).toBe("Remote comment");expect(packet).toEqual(before);
 expect(()=>owner.execute({kind:"publication",current:current.next,publicationId:"actual-publication",packet:{...packet,unknownPacket:{keep:"changed"}},leaseId:"bad"})).toThrow(/identity/);
 const projected=delta(owner.execute({kind:"delta",base:seed.next,next:publication.next}));expect(projected.base).toEqual(seed.next);expect(projected.next).toEqual(publication.next);
});
it("retains pins across multiple projects and evicts only explicitly unleased snapshots",()=>{
 const owner=new SourceRuntimeOwner({maximumUnleased:1,maximumPinned:2}),one=source(),two={...source(),id:one.id};
 const first=delta(owner.execute({kind:"seed",scope:actualScope(one),document:one,leaseId:"first"}));
 const other=delta(owner.execute({kind:"seed",scope:{...actualScope(two),projectId:"other-project"},document:two,leaseId:"other"}));
 for(let index=0;index<5;index++)owner.execute({kind:"seed",scope:actualScope(one),document:{...one,title:`unleased-${index}`}});
 expect(resolve(owner,first.next).id).toBe(one.id);expect(resolve(owner,other.next).id).toBe(two.id);
 owner.execute({kind:"release",leaseId:"first"});for(let index=0;index<3;index++)owner.execute({kind:"seed",scope:actualScope(one),document:{...one,title:`new-${index}`}});
 expect(()=>resolve(owner,first.next)).toThrow(/expired/);expect(resolve(owner,other.next).id).toBe(two.id);
});
it("owns immediate mutable drafts without letting retained caller objects modify canonical views",()=>{
 const original=ownSourceValue({title:"initial",nested:{keep:1}}),external={...original,title:"immediate",newData:{values:[1,2]}};
 const captured=ownSourceValue(external);expect(captured.nested).toBe(original.nested);expect(captured.newData).not.toBe(external.newData);
 external.newData.values.push(3);expect(captured.newData.values).toEqual([1,2]);expect(isOwnedSource(captured)).toBe(true);expect(()=>{captured.newData.values.push(9)}).toThrow();
 const cycle:any={};cycle.self=cycle;expect(()=>ownSourceValue(cycle)).toThrow(/cycle/);expect(()=>ownSourceValue({value:undefined})).toThrow(/non-JSON/);
});
it("registers actual saved metadata as a distinct exact body and keeps its private adapter out of public dispatch",()=>{
 const {owner,seed}=setup(),body=cloneSourceValue(resolve(owner,seed.next));body.createdAt="2026-01-01T00:00:00Z";body.updatedAt="2026-10-21T22:00:00Z";
 const saved=owner.registerActualSavedSnapshot({scope:seed.next.scope,document:body,base:seed.next,leaseId:"saved"});
 expect(saved.next).not.toEqual(seed.next);expect(resolve(owner,saved.next).createdAt).toBe(body.createdAt);
 expect(resolve(owner,seed.next).createdAt).not.toBe(body.createdAt);
 expect(()=>owner.execute({kind:"registerActualSavedSnapshot",document:body} as any)).toThrow(/Unknown source runtime request/);
});

it("never returns an already evicted new snapshot under byte pressure and rolls back rejected pins",()=>{
 const tiny=new SourceRuntimeOwner({maximumResidentBytes:1,maximumUnleased:0}),document=source();
 const admitted=delta(tiny.execute({kind:"seed",scope:actualScope(document),document}));
 expect(resolve(tiny,admitted.next).id).toBe(document.id);
 const {owner,seed}=setup({maximumPinned:1});
 expect(()=>owner.execute({kind:"draft",base:seed.next,transactionId:"rejected-budget",edits:[{op:"set",path:["title"],value:"pending"}],leaseId:"pending"})).toThrow(/retention/);
 expect(resolve(owner,seed.next).id).toBe(seed.next.scope.pageId);
 expect(()=>resolve(owner,{...seed.next,snapshotId:"snapshot-2",kind:"draft"})).toThrow(/expired/);
 owner.execute({kind:"release",leaseId:"current"});
 const next=delta(owner.execute({kind:"seed",scope:seed.next.scope,document:sourceWithId(seed.next.scope.pageId),leaseId:"next"}));
 expect(resolve(owner,next.next).id).toBe(seed.next.scope.pageId);
});
function sourceWithId(id:string){return{...source(),id}}
