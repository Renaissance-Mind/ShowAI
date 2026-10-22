import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {mergePageContent} from "../core/page-merge-model";
import {createResource} from "./containers.mjs";
import {normalizeSourceDocument,SourceRuntimeOwner,type SourceSnapshotDelta,type SourceSnapshotRef} from "./source-runtime";
import type {ShowDocument} from "../types";
const resolve=(owner:SourceRuntimeOwner,ref:SourceSnapshotRef)=>(owner.execute({kind:"resolve",ref}) as {document:ShowDocument}).document;
function setup(options:ConstructorParameters<typeof SourceRuntimeOwner>[0]={}){
 const document=createResource(blankDocument(),"board") as ShowDocument;
 document.createdAt="2026-10-21T00:00:00.000Z";document.updatedAt="2026-10-22T00:00:00.000Z";
 const owner=new SourceRuntimeOwner(options),scope={homeId:"origin-home",projectId:"origin-project",pageId:document.id};
 const seed=owner.execute({kind:"seed",scope,document,proof:"normalized",leaseId:"current"}) as SourceSnapshotDelta;
 return{owner,document:resolve(owner,seed.next),seed,scope};
}
function publication(document:ShowDocument,current:SourceSnapshotRef,id="initial-no-operations",sourceVersion=1):Parameters<SourceRuntimeOwner["registerActualMergedPublication"]>[0]{
 const raw=structuredClone(document);
 // Canonical defaults and an empty rich-text child demonstrate why a raw P
 // digest is not proof of the actual normalized factory output.
 for(const key of ["icon","cover","parentId","favorite","archived"] as const)delete (raw as any)[key];
 (raw as any).futureRoot={keep:["é","é",false]};
 return{current,publicationId:id,sourceVersion,packet:{pageId:document.id,boardId:document.content.attrs!.id as string,token:"actual-native-token",document:raw,baseDocument:document,operationIds:[],nativeContentActions:[]},result:{document:raw,conflicts:[]},leaseId:`output:${id}`};
}
it("authenticates the actual normalized zero-operation native publication without changing caller data",()=>{
 const {owner,document,seed,scope}=setup(),request=publication(document,seed.next),before=structuredClone(request);
 const out=owner.registerActualMergedPublication(request),body=resolve(owner,out.next);
 expect(body).not.toEqual(request.packet.document);expect(body.icon).toBe("✦");expect((body as any).futureRoot).toEqual((request.packet.document as any).futureRoot);
 expect(owner.nativePublicationDocumentMatching({ref:out.next,document:body})).toEqual({format:"showai-native-publication-origin-v1",publicationId:request.publicationId,scope,boardId:request.packet.boardId,token:request.packet.token,sourceVersion:1});
 expect(request).toEqual(before);expect(Object.isFrozen(request.packet)).toBe(false);
 request.packet.document.title="outside mutation";
 expect(owner.nativePublicationDocumentMatching({ref:out.next,document:body})?.publicationId).toBe(request.publicationId);
});
it("proves real canonical normalization differences but never a genuine foreign author change",()=>{
 const {owner,document,seed}=setup(),request=publication(document,seed.next);
 request.result={document:normalizeSourceDocument(request.packet.document),conflicts:[]};
 const out=owner.registerActualMergedJSON(JSON.stringify(request)),body=resolve(owner,out.next);
 expect(owner.nativePublicationDocumentMatching({ref:out.next,document:body})).not.toBeNull();
 const foreign=structuredClone(document);foreign.title="Foreign author";
 const changed=publication(document,seed.next,"foreign-merge",2);changed.result=mergePageContent(document,foreign,changed.packet.document);
 expect(changed.result.conflicts).toEqual([]);
 const merged=owner.registerActualMergedPublication(changed),actual=resolve(owner,merged.next);
 expect(actual.title).toBe("Foreign author");expect(owner.nativePublicationDocumentMatching({ref:merged.next,document:actual})).toBeNull();
});
it("does not accept a valid ref attached to another complete body, Unicode key, causal state or scope",()=>{
 const {owner,document,seed}=setup(),request=publication(document,seed.next),out=owner.registerActualMergedPublication(request),body=resolve(owner,out.next);
 for(const mutate of [(value:any)=>value.title="forged",(value:any)=>value.futureRoot.keep[0]="é",(value:any)=>value.futureExtra={unknown:true},(value:any)=>value.content.attrs.inkState={format:"forged-clock"}]){
  const other=structuredClone(body);mutate(other);expect(owner.nativePublicationDocumentMatching({ref:out.next,document:other})).toBeNull();
 }
 const timestamp={...body,updatedAt:"2026-10-22T01:00:00.000Z"};expect(owner.nativePublicationDocumentMatching({ref:out.next,document:timestamp})).toBeNull();
 for(const patch of [{epoch:"expired"},{kind:"draft"},{scope:{...out.next.scope,homeId:"other-home"}},{scope:{...out.next.scope,projectId:"other-project"}},{scope:{...out.next.scope,pageId:"other-page"}}])
  expect(()=>owner.nativePublicationDocumentMatching({ref:{...out.next,...patch} as SourceSnapshotRef,document:body})).toThrow(/owner|epoch|scope|proof|expired/);
});
it("inherits only the actual validated timestamp draft/saved chain; ordinary edits cannot carry authority",()=>{
 const {owner,document,seed,scope}=setup(),out=owner.registerActualMergedPublication(publication(document,seed.next));
 const draft=owner.execute({kind:"draft",base:out.next,transactionId:"timestamp",edits:[{op:"set",path:["updatedAt"],value:"2026-10-22T01:00:00.000Z"}],leaseId:"timestamp"}) as SourceSnapshotDelta;
 expect(draft.next.kind).toBe("draft");expect(owner.nativePublicationDocumentMatching({ref:draft.next,document:resolve(owner,draft.next)})?.publicationId).toBe(out.publicationId);
 const saved=owner.registerActualSavedSnapshot({scope,base:draft.next,document:{...structuredClone(resolve(owner,draft.next)),updatedAt:"2026-10-22T02:00:00.000Z"},leaseId:"saved"});
 expect(owner.nativePublicationDocumentMatching({ref:saved.next,document:resolve(owner,saved.next)})?.publicationId).toBe(out.publicationId);
 for(const edits of [[{op:"set" as const,path:["title"],value:"UI author"}],[{op:"set" as const,path:["futureUnknown"],value:1}],[{op:"set" as const,path:["updatedAt"],value:"not a timestamp"}]]){
  const changed=owner.execute({kind:"draft",base:out.next,transactionId:JSON.stringify(edits),edits,leaseId:"author"}) as SourceSnapshotDelta;
  expect(owner.nativePublicationDocumentMatching({ref:changed.next,document:resolve(owner,changed.next)})).toBeNull();
 }
});
it("never mints native origin via public publication/seed/normalization claims or an asserted field",()=>{
 const {owner,document,seed}=setup(),request=publication(document,seed.next);
 const out=owner.execute({kind:"publication",...request,nativeOrigin:true} as any) as SourceSnapshotDelta;
 expect(owner.nativePublicationDocumentMatching({ref:out.next,document:resolve(owner,out.next)})).toBeNull();
 const normalized=owner.normalizeActualProjection({base:seed.next,document:request.packet.document,leaseId:"normalized"});
 expect(owner.nativePublicationDocumentMatching({ref:normalized.next,document:resolve(owner,normalized.next)})).toBeNull();
 expect(()=>owner.execute({kind:"nativePublicationDocumentMatching",ref:normalized.next,document:resolve(owner,normalized.next)} as any)).toThrow(/Unknown/);
});
it("keeps pinned origin beyond the eight-publication/64-snapshot cache and retires it with its actual scope",()=>{
 const {owner,document,seed,scope}=setup({maximumResidentBytes:1,maximumUnleased:0});
 const first=owner.registerActualMergedPublication(publication(document,seed.next,"keep-first",1)),firstBody=resolve(owner,first.next);
 for(let index=0;index<70;index++){
  owner.registerActualMergedPublication(publication(document,seed.next,`new-${index}`,index+2));
  owner.execute({kind:"release",leaseId:`output:new-${index}`});
 }
 expect(owner.nativePublicationDocumentMatching({ref:first.next,document:firstBody})?.publicationId).toBe("keep-first");
 owner.execute({kind:"dispose",scope});expect(()=>owner.nativePublicationDocumentMatching({ref:first.next,document:firstBody})).toThrow(/expired/);
});
it("requires the same immutable sourceVersion/packet on retry and matches consuming versus defensive factories",()=>{
 const one=setup(),two=setup();
 const request=publication(one.document,one.seed.next);
 const out=one.owner.registerActualMergedPublication(request),body=resolve(one.owner,out.next);
 const repeated=one.owner.registerActualMergedJSON(JSON.stringify(request));expect(one.owner.nativePublicationDocumentMatching({ref:repeated.next,document:resolve(one.owner,repeated.next)})).toEqual(one.owner.nativePublicationDocumentMatching({ref:out.next,document:body}));
 expect(()=>one.owner.registerActualMergedPublication({...request,sourceVersion:2})).toThrow(/version|identity/);
 const other=publication(two.document,two.seed.next);other.packet.document=structuredClone(request.packet.document);other.packet.document.id=two.document.id;other.packet.document.content.attrs!.id=two.document.content.attrs!.id;other.result.document=other.packet.document;
 const parsed=two.owner.registerActualMergedJSON(JSON.stringify(other));expect(two.owner.nativePublicationDocumentMatching({ref:parsed.next,document:resolve(two.owner,parsed.next)})?.publicationId).toBe(other.publicationId);
});
it("never inherits origin for an actually over-capacity timestamp draft or invalid source metadata",()=>{
 const {owner,document,seed}=setup(),request=publication(document,seed.next),out=owner.registerActualMergedPublication(request);
 const timestamp=" ".repeat(16*1024*1024)+"2026-10-22";
 expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
 const draft=owner.execute({kind:"draft",base:out.next,transactionId:"oversize-timestamp",edits:[{op:"set",path:["updatedAt"],value:timestamp}],leaseId:"oversize"}) as SourceSnapshotDelta;
 expect(owner.nativePublicationDocumentMatching({ref:draft.next,document:resolve(owner,draft.next)})).toBeNull();
 for(const sourceVersion of [-1,Infinity,1.5])expect(()=>owner.registerActualMergedPublication({...request,publicationId:`invalid-${sourceVersion}`,sourceVersion})).toThrow(/version/);
});
it("rejects an invalid retry before replacing the last actual response lease under pressure",()=>{
 const {owner,document,seed}=setup({maximumResidentBytes:1,maximumUnleased:0}),request=publication(document,seed.next),out=owner.registerActualMergedPublication(request),body=resolve(owner,out.next);
 expect(()=>owner.registerActualMergedPublication({...request,sourceVersion:99})).toThrow(/version/);
 expect(owner.nativePublicationDocumentMatching({ref:out.next,document:body})?.sourceVersion).toBe(1);
});
it("does not retain an older origin when a real three-way author branch changes the new native publication",()=>{
 const {owner,document,seed}=setup();
 const firstRequest=publication(document,seed.next,"native-B",1);firstRequest.packet.document.title="B";firstRequest.result.document=firstRequest.packet.document;
 const first=owner.registerActualMergedPublication(firstRequest),current=resolve(owner,first.next);
 const baseline=structuredClone(current);baseline.title=document.title;
 const second=publication(document,first.next,"native-A",2);second.packet.document=structuredClone(baseline);second.packet.baseDocument=baseline;
 // Native P's writer saw A; current UI already contains B. The true merge
 // preserves B, so the second publication is not canonically Native A.
 second.result=mergePageContent(baseline,current,second.packet.document);
 expect(second.result.conflicts).toEqual([]);expect(second.result.document.title).toBe("B");
 const out=owner.registerActualMergedPublication(second),body=resolve(owner,out.next);
 expect(body.title).toBe("B");expect(owner.nativePublicationDocumentMatching({ref:out.next,document:body})).toBeNull();
});
it("preserves genuine concurrent ink heads and withholds Native origin even when the visible winning color matches P",async()=>{
 const {addNode}=await import("./editing"),{createPortableInk}=await import("./portable-ink.mjs"),{stampInkDocument}=await import("./ink-wire.mjs");
 let document=createResource(blankDocument(),"board") as ShowDocument;
 document.createdAt="2026-10-21T00:00:00.000Z";document.updatedAt="2026-10-22T00:00:00.000Z";
 const boardId=document.content.attrs!.id as string;
 document=addNode(document,{type:"drawing",attrs:{id:"actual-stroke",tool:"pen",color:"#111111",strokeWidth:2,extent:[40,30],points:[{x:1,y:2},{x:20,y:12}],ink:createPortableInk([{x:1,y:2,pressure:.5},{x:20,y:12,pressure:.8}],2,[40,30])}},{x:10,y:20,width:40,height:30},boardId) as ShowDocument;
 const base=stampInkDocument(document,undefined,{actor:"actual-seed",sequence:1}),left=structuredClone(base),right=structuredClone(base);
 left.content.content![0].attrs!.color="#ff0000";right.content.content![0].attrs!.color="#0000ff";
 const l=stampInkDocument(left,base,{actor:"actual-left",sequence:1}),r=stampInkDocument(right,base,{actor:"actual-right",sequence:1});
 const owner=new SourceRuntimeOwner(),scope={homeId:"real-conflict-home",projectId:"real-conflict-project",pageId:document.id};
 const current=owner.execute({kind:"seed",scope,document:l,proof:"normalized",leaseId:"current"}) as SourceSnapshotDelta;
 const merged=mergePageContent(base,l,r);expect(merged.conflicts).toMatchObject([{domain:"ink",retained:true}]);
 const out=owner.registerActualMergedPublication({current:current.next,publicationId:"real-concurrent-publication",sourceVersion:2,packet:{pageId:document.id,boardId,token:"actual-conflict-token",baseDocument:base,document:r,operationIds:["actual-right:1"]},result:merged,leaseId:"actual-output"});
 expect(out.inkCandidates.length).toBeGreaterThan(0);expect(owner.nativePublicationDocumentMatching({ref:out.next,document:resolve(owner,out.next)})).toBeNull();
});
it("does not treat a repaired timestamp as capacity proof for an oversized captured P",()=>{
 const {owner,document,seed}=setup(),request=publication(document,seed.next);
 request.result.document=structuredClone(request.packet.document);
 request.packet.document.updatedAt=" ".repeat(16*1024*1024)+"2026-10-22";
 request.result.document.updatedAt="2026-10-22T00:00:00.000Z";
 expect(()=>owner.registerActualMergedPublication(request)).toThrow(/Page structure/);
 expect(resolve(owner,seed.next)).toEqual(document);
});

it("binds a fully normalized actual host projection independently of a transport packet",()=>{
 const {owner,document,seed,scope}=setup();
 const body=structuredClone(document);body.title="Actual compensation result";(body as any).futureRoot={unknown:["é","é",null]};
 const origin={format:"showai-native-projection-origin-v1" as const,publicationId:"actual-inverse-result",scope,boardId:document.content.attrs!.id as string,token:"actual-token",sourceVersion:7};
 const output=owner.normalizeActualProjection({base:seed.next,document:body,origin,leaseId:"inverse"}),canonical=resolve(owner,output.next);
 expect(owner.nativePublicationDocumentMatching({ref:output.next,document:canonical})).toEqual(origin);
 expect(()=>owner.normalizeActualProjection({base:seed.next,document:{...canonical,title:"another actual body"},origin,leaseId:"inverse"})).toThrow(/identity/);
 expect(owner.nativePublicationDocumentMatching({ref:output.next,document:canonical})).toEqual(origin);
 body.title="Caller mutated after return";origin.sourceVersion=99;
 expect(owner.nativePublicationDocumentMatching({ref:output.next,document:canonical})?.sourceVersion).toBe(7);
 const timestamp=owner.execute({kind:"draft",base:output.next,transactionId:"storage-time",edits:[{op:"set",path:["updatedAt"],value:"2026-10-22T02:00:00.000Z"}],leaseId:"time"}) as SourceSnapshotDelta;
 expect(owner.nativePublicationDocumentMatching({ref:timestamp.next,document:resolve(owner,timestamp.next)})?.sourceVersion).toBe(7);
 const foreign=owner.execute({kind:"draft",base:timestamp.next,transactionId:"actual-foreign-edit",edits:[{op:"set",path:["futureRoot","unknown",0],value:"new foreign value"}],leaseId:"foreign"}) as SourceSnapshotDelta;
 expect(owner.nativePublicationDocumentMatching({ref:foreign.next,document:resolve(owner,foreign.next)})).toBeNull();
 expect(()=>owner.normalizeActualProjection({base:seed.next,document:{...document,createdAt:"invalid"},origin:{...origin,sourceVersion:8}})).toThrow(/ISO/);
 expect(()=>owner.normalizeActualProjection({base:seed.next,document,origin:{...origin,scope:{...scope,projectId:"other"}}})).toThrow(/scope/);
 expect(()=>owner.execute({kind:"normalizeActualProjection",base:seed.next,document,origin} as any)).toThrow(/Unknown/);
 owner.execute({kind:"dispose",scope});expect(()=>owner.resolveActualSnapshot(output.next)).toThrow(/expired/);
});
