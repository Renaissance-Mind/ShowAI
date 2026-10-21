import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {mergePageContent} from "../core/page-merge-model";
import {createResource} from "./containers.mjs";
import {createPortableInk} from "./portable-ink.mjs";
import {stampInkDocument} from "./ink-wire.mjs";
import {nativeDocumentBodiesEqual} from "./native-document-content";
import {SourceRuntimeOwner,normalizeSourceDocument,type SourceSnapshotDelta,type SourceSnapshotRef} from "./source-runtime";
import type {ShowDocument} from "../types";
const body=(owner:SourceRuntimeOwner,ref:SourceSnapshotRef)=>(owner.execute({kind:"resolve",ref}) as {document:ShowDocument}).document;
function setup(){
 const raw=createResource(blankDocument(),"board") as ShowDocument,boardId=raw.content.attrs!.id as string;
 raw.createdAt="2026-10-21T00:00:00.000Z";raw.updatedAt="2026-10-22T00:00:00.000Z";
 raw.content.content=[{type:"drawing",attrs:{id:"observed-stroke",tool:"pen",color:"#111111",strokeWidth:2,extent:[40,30],points:[{x:1,y:2},{x:20,y:12}],ink:createPortableInk([{x:1,y:2,pressure:.5},{x:20,y:12,pressure:.8}],2,[40,30])}},
  {type:"surface",attrs:{id:"embedded-page",kind:"page",name:"Page"},content:[{type:"richText",attrs:{id:"empty-rich",name:"Empty text"},content:[{type:"paragraph",attrs:{id:"empty-paragraph"}}]}]}];
 raw.layout={...raw.layout,"observed-stroke":{x:0,y:0,width:40,height:30},"embedded-page":{x:60,y:0,width:300,height:160}};
 (raw as any).futureRoot={"é":1,"é":2};
 const current=normalizeSourceDocument(raw),incoming=stampInkDocument(raw,undefined,{actor:"actual-bootstrap",sequence:1});
 const owner=new SourceRuntimeOwner(),scope={homeId:"unchanged-home",projectId:"unchanged-project",pageId:raw.id};
 const seed=owner.execute({kind:"seed",scope,document:current,proof:"normalized",leaseId:"current"}) as SourceSnapshotDelta;
 const request={current:seed.next,publicationId:"actual-empty-operation-bootstrap",sourceVersion:1,packet:{pageId:raw.id,boardId,token:"actual-token",baseDocument:raw,document:incoming,operationIds:[],nativeContentActions:[]},leaseId:"output"};
 return{owner,raw,current,incoming,scope,seed,request};
}
it("reproduces raw three-way empty-rich-leaf reconstruction and registers genuine canonical P with zero author actions",()=>{
 const {owner,raw,current,incoming,request}=setup();
 const reconstructed=normalizeSourceDocument(mergePageContent(raw,current,incoming).document),expected=normalizeSourceDocument(incoming);
 expect(nativeDocumentBodiesEqual(reconstructed,expected)).toBe(false);
 expect((reconstructed.content.content![1].content![0].content![0] as any).content).toEqual([]);
 expect(Object.hasOwn(expected.content.content![1].content![0].content![0],"content")).toBe(false);
 const snapshot=owner.registerActualNativePublicationIfUnchanged(request)!;
 expect(snapshot).not.toBeNull();expect(body(owner,snapshot.next)).toEqual(expected);
 expect(owner.nativePublicationDocumentMatching({ref:snapshot.next,document:body(owner,snapshot.next)})?.publicationId).toBe(request.publicationId);
 expect(snapshot.history).toBeUndefined();expect(request.packet.operationIds).toEqual([]);
});
it("matches consuming and defensive factories, retains unknown literal keys, and retries the same actual P after UI apply",()=>{
 const {owner,request}=setup(),before=structuredClone(request);
 const first=owner.registerActualNativeJSONIfUnchanged(JSON.stringify(request))!;
 expect(request).toEqual(before);expect((body(owner,first.next) as any).futureRoot).toEqual({"é":1,"é":2});
 const repeated=owner.registerActualNativePublicationIfUnchanged({...request,current:first.next});
 expect(repeated).not.toBeNull();expect(body(owner,repeated!.next)).toEqual(body(owner,first.next));
 expect(()=>owner.registerActualNativePublicationIfUnchanged({...request,current:first.next,sourceVersion:2})).toThrow(/version/);
 expect(()=>owner.execute({kind:"registerActualNativePublicationIfUnchanged",...request} as any)).toThrow(/Unknown/);
});
it("refuses real UI title/unknown/createdAt/NFC and causal changes rather than declaring the current body Native",()=>{
 const {owner,seed,request}=setup();
 const edits=[{op:"set" as const,path:["title"],value:"Real UI author"},{op:"set" as const,path:["futureExtra"],value:{keep:true}},{op:"set" as const,path:["createdAt"],value:"2025-01-01T00:00:00.000Z"},{op:"set" as const,path:["futureRoot","é"],value:9}];
 for(const edit of edits){
  const changed=owner.execute({kind:"draft",base:seed.next,transactionId:JSON.stringify(edit),edits:[edit],leaseId:"author"}) as SourceSnapshotDelta;
  expect(owner.registerActualNativePublicationIfUnchanged({...request,current:changed.next})).toBeNull();
 }
 const causal=owner.execute({kind:"seed",scope:seed.next.scope,document:stampInkDocument(request.packet.document,undefined,{actor:"foreign-seed",sequence:1}),proof:"normalized",leaseId:"foreign"}) as SourceSnapshotDelta;
 expect(owner.registerActualNativePublicationIfUnchanged({...request,current:causal.next})).toBeNull();
});
it("checks actual timestamp capacity and invalid refs before registering a normalized result",()=>{
 const {owner,seed,request}=setup();
 const oversized=owner.execute({kind:"draft",base:seed.next,transactionId:"oversize-date",edits:[{op:"set",path:["updatedAt"],value:" ".repeat(16*1024*1024)+"2026-10-22"}],leaseId:"oversize"}) as SourceSnapshotDelta;
 expect(()=>owner.registerActualNativePublicationIfUnchanged({...request,current:oversized.next})).toThrow(/Page structure/);
 for(const patch of [{epoch:"expired"},{kind:"draft"},{scope:{...seed.next.scope,homeId:"other"}}])expect(()=>owner.registerActualNativePublicationIfUnchanged({...request,current:{...seed.next,...patch} as SourceSnapshotRef})).toThrow();
});
it("keeps Native content/history packets on the existing real factory instead of dropping their stages",()=>{
 const {owner,request,seed}=setup();
 const baseline=normalizeSourceDocument(request.packet.document);
 const active=owner.execute({kind:"seed",scope:seed.next.scope,document:baseline,proof:"normalized",leaseId:"history-current"}) as SourceSnapshotDelta;
 const incoming=structuredClone(baseline);incoming.title="Actual Native object action";
 const packet={...request.packet,baseDocument:baseline,document:incoming,nativeContentAction:true,nativeContentActions:[{groupId:"native-object",beforeDocument:baseline,document:incoming}]};
 expect(owner.registerActualNativePublicationIfUnchanged({...request,current:active.next,packet})).toBeNull();
 const merged=mergePageContent(baseline,body(owner,active.next),incoming);
 const result=owner.registerActualMergedPublication({...request,current:active.next,packet,result:merged});
 expect(result.history?.stages).toHaveLength(1);expect(body(owner,result.next).title).toBe(incoming.title);
 const before=body(owner,result.history!.sourceOnly.next),after=body(owner,result.history!.stages[0].delta.next);
 expect(before.title).toBe(request.packet.document.title);expect(after.title).toBe(incoming.title);
});
it("keeps actual unchanged-origin retries alive beyond replay cache pressure and fails closed after scope disposal",()=>{
 const {owner,seed,request}=setup();
 const first=owner.registerActualNativePublicationIfUnchanged(request)!;
 const current=body(owner,first.next);
 for(let index=0;index<70;index++){
  const leaseId=`pressure-${index}`;
  const next=owner.registerActualNativePublicationIfUnchanged({...request,current:first.next,publicationId:`actual-next-${index}`,sourceVersion:index+2,packet:{...request.packet,baseDocument:request.packet.document},leaseId});
  expect(next).not.toBeNull();owner.execute({kind:"release",leaseId});
 }
 expect(owner.nativePublicationDocumentMatching({ref:first.next,document:current})?.publicationId).toBe(request.publicationId);
 owner.execute({kind:"dispose",scope:seed.next.scope});
 expect(()=>owner.registerActualNativePublicationIfUnchanged(request)).toThrow(/expired/);
});
