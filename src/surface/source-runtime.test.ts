import {CAPACITY} from "../portable/capacity.mjs";
import {createHash} from "node:crypto";
import {installInkDigestProvider} from "./ink-operations.mjs";
import {stampInkDocument} from "./ink-wire.mjs";
import {createPortableInk} from "./portable-ink.mjs";
import {addNode} from "./editing";
import {expect,it} from "vitest";
import {SourceRuntimeOwner,cloneSourceValue,ownSourceValue,isOwnedSource,type SourceSnapshotDelta,type SourceSnapshotRef,normalizeSourceDocument} from "./source-runtime";
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
it("accepts only the private actual merge adapter and prepares exact generic history snapshots in its worker",()=>{
 const {owner,document,seed}=setup();
 const incoming=cloneSourceValue(document);incoming.title="Actual native title";
 const packet={pageId:document.id,document:incoming,baseDocument:document,nativeContentActions:[{groupId:"actual-native-title",beforeDocument:document,document:incoming}]};
 const publication=owner.registerActualMergedPublication({current:seed.next,publicationId:"actual-trusted-pub",packet,result:{document:incoming,conflicts:[]},leaseId:"actual-output"});
 expect(resolve(owner,publication.next).title).toBe("Actual native title");
 expect(publication.history).toBeDefined();
 expect(publication.history!.stages).toHaveLength(1);
 // History includes all authored fields, rather than a canvas whitelist.
 expect(resolve(owner,publication.history!.sourceOnly.next).title).toBe(document.title);
 expect(()=>owner.execute({kind:"registerActualMergedPublication",packet,result:{document:incoming,conflicts:[]}} as any)).toThrow(/Unknown/);
 expect(()=>owner.registerActualMergedPublication({current:seed.next,publicationId:"actual-trusted-pub",packet:{...packet,other:"changed"},result:{document:incoming,conflicts:[]},leaseId:"changed"})).toThrow(/identity/);
});

it("normalizes real host undo projections without a public client validated flag",()=>{
 const {owner,seed}=setup(),body=cloneSourceValue(resolve(owner,seed.next));
 body.title="Actual compensated source";(body as any).futureRoot={value:"retained"};
 const projection=owner.normalizeActualProjection({base:seed.next,document:body,leaseId:"host-result"});
 expect(resolve(owner,projection.next).title).toBe(body.title);expect((resolve(owner,projection.next) as any).futureRoot).toEqual({value:"retained"});
 expect(()=>owner.normalizeActualProjection({base:seed.next,document:{...body,createdAt:"invalid"},leaseId:"bad"})).toThrow(/ISO/);
 expect(()=>owner.execute({kind:"normalizeActualProjection",base:seed.next,document:body} as any)).toThrow(/Unknown/);
});
it("rebases generic history over complete foreign root changes in the real owner",()=>{
 const {owner,seed}=setup(),base=resolve(owner,seed.next);
 const local=delta(owner.execute({kind:"draft",base:seed.next,transactionId:"author-root",edits:[{op:"set",path:["title"],value:"Own title"}],leaseId:"local"}));
 const remote=delta(owner.execute({kind:"draft",base:local.next,transactionId:"foreign-root",edits:[{op:"set",path:["futureRoot"],value:{keep:"foreign"}},{op:"set",path:["comments"],value:[{id:"foreign",text:"Foreign",createdAt:base.createdAt,resolved:false}]}],leaseId:"remote"}));
 const result=owner.execute({kind:"history",base:local.next,current:remote.next,entries:[seed.next],leaseId:"history"});
 expect("rebasedHistory" in result).toBe(true);if(!("rebasedHistory" in result))return;
 const target=resolve(owner,result.rebasedHistory[0].delta.next);
 expect(target.title).toBe(base.title);expect((target as any).futureRoot).toEqual({keep:"foreign"});expect(target.comments![0].text).toBe("Foreign");expect(result.rebasedHistory[0].unchanged).toBe(false);
 const changed=delta(owner.execute({kind:"draft",base:remote.next,transactionId:"remote-same-field",edits:[{op:"set",path:["title"],value:"Foreign title"}],leaseId:"remote"}));
 const same=owner.execute({kind:"history",base:local.next,current:changed.next,entries:[seed.next],leaseId:"history"});
 if(!("rebasedHistory" in same))throw new Error("Missing actual history response");expect(resolve(owner,same.rebasedHistory[0].delta.next).title).toBe("Foreign title");expect(same.rebasedHistory[0].unchanged).toBe(true);
});

it("reuses the actual normalized snapshot, retained ink conflicts and lease without registering or hashing it again",()=>{
 let document=source();const boardId=document.content.attrs!.id;
 document=addNode(document,{type:"drawing",attrs:{id:"actual-stroke",tool:"pen",color:"#111111",strokeWidth:2,extent:[40,30],points:[{x:1,y:2},{x:20,y:12}],ink:createPortableInk([{x:1,y:2,pressure:.5},{x:20,y:12,pressure:.8}],2,[40,30])}},{x:10,y:20,width:40,height:30},boardId) as ShowDocument;
 const base=stampInkDocument(document,undefined,{actor:"actual-seed",sequence:1}),left=cloneSourceValue(base),right=cloneSourceValue(base);
 left.content.content![0].attrs!.color="#ff0000";right.content.content![0].attrs!.color="#0000ff";
 const owner=new SourceRuntimeOwner(),scope=actualScope(document),seed=(document:ShowDocument,leaseId:string)=>delta(owner.execute({kind:"seed",scope,document,proof:"normalized",leaseId}));
 const b=seed(base,"base"),l=seed(stampInkDocument(left,base,{actor:"actual-left",sequence:1}),"left"),r=seed(stampInkDocument(right,base,{actor:"actual-right",sequence:1}),"right");
 const merged=delta(owner.execute({kind:"merge",base:b.next,current:l.next,incoming:r.next,leaseId:"merged"})),body=resolve(owner,merged.next),expected=normalizeSourceDocument(body);
 expect(merged.conflicts).toMatchObject([{domain:"ink",retained:true}]);expect(merged.inkCandidates.length).toBeGreaterThan(0);
 let hashes=0;installInkDigestProvider(input=>{hashes++;return createHash("sha256").update(input,"utf8").digest("hex")});hashes=0;
 try{
  const normalized=delta(owner.execute({kind:"normalize",ref:merged.next,leaseId:"saved-view"}));
  expect(normalized.base).toBe(merged.next);expect(normalized.next).toBe(merged.next);expect(normalized.edits).toEqual([]);expect(normalized.conflicts).toBe(merged.conflicts);expect(normalized.inkCandidates).toBe(merged.inkCandidates);expect(hashes).toBe(0);
  expect(resolve(owner,normalized.next)).toEqual(expected);
  const next=seed(base,"new");expect(Number(next.next.snapshotId.split("-")[1])).toBe(Number(merged.next.snapshotId.split("-")[1])+1);
 }finally{installInkDigestProvider(null)}
});
it("checks normalized proof, scope and epoch, keeps its lease under pressure, and still rejects invalid drafts",()=>{
 const {owner,seed,document}=setup({maximumResidentBytes:1,maximumUnleased:0});
 const stable=delta(owner.execute({kind:"normalize",ref:seed.next,leaseId:"normalized-reader"}));expect(stable.next).toEqual(seed.next);
 owner.execute({kind:"release",leaseId:"current"});for(let index=0;index<4;index++)owner.execute({kind:"seed",scope:seed.next.scope,document:{...document,title:`Cache pressure ${index}`}});
 expect(resolve(owner,stable.next)).toEqual(resolve(owner,seed.next));
 for(const change of [{epoch:"forged"},{scope:{...seed.next.scope,projectId:"forged"}},{scope:{...seed.next.scope,homeId:"forged"}}])expect(()=>owner.execute({kind:"normalize",ref:{...stable.next,...change}})).toThrow();
 const draft=delta(owner.execute({kind:"draft",base:stable.next,transactionId:"invalid-created-at",edits:[{op:"set",path:["createdAt"],value:"invalid"}],leaseId:"draft"}));
 expect(()=>owner.execute({kind:"normalize",ref:{...draft.next,kind:"normalized"}})).toThrow(/proof|scope|expired/);
 expect(()=>owner.execute({kind:"normalize",ref:draft.next,proof:"normalized"} as any)).toThrow(/ISO/);
 owner.execute({kind:"release",leaseId:"normalized-reader"});owner.execute({kind:"release",leaseId:"draft"});owner.execute({kind:"seed",scope:seed.next.scope,document});
 expect(()=>owner.execute({kind:"normalize",ref:stable.next})).toThrow(/expired/);
});
it("matches only exact actual registered validated bodies, including proven timestamp-only drafts",()=>{
 const {owner,seed}=setup(),body=resolve(owner,seed.next),copy=cloneSourceValue(body);
 expect(owner.normalizedDocumentMatching({ref:seed.next,document:copy})).toBe(body);
 for(const patch of [{title:"Different"},{updatedAt:"2026-10-22T01:00:00Z"},{futureRoot:{value:true}}])expect(owner.normalizedDocumentMatching({ref:seed.next,document:{...copy,...patch}} as any)).toBeNull();
 const timestamp=delta(owner.execute({kind:"draft",base:seed.next,transactionId:"actual-storage-time",edits:[{op:"set",path:["updatedAt"],value:"2026-10-22T01:00:00.000Z"}],leaseId:"timestamp"}));
 expect(timestamp.next.kind).toBe("draft");expect(()=>owner.normalizedDocumentMatching({ref:{...timestamp.next,kind:"normalized"},document:resolve(owner,timestamp.next)})).toThrow();expect(owner.normalizedDocumentMatching({ref:timestamp.next,document:cloneSourceValue(resolve(owner,timestamp.next))})).toBe(resolve(owner,timestamp.next));
 const invalid=delta(owner.execute({kind:"draft",base:seed.next,transactionId:"invalid-storage-time",edits:[{op:"set",path:["updatedAt"],value:"invalid"}],leaseId:"invalid-time"}));
 expect(owner.normalizedDocumentMatching({ref:invalid.next,document:resolve(owner,invalid.next)})).toBeNull();expect(()=>owner.execute({kind:"normalize",ref:invalid.next})).toThrow(/ISO/);
 const edited=delta(owner.execute({kind:"draft",base:timestamp.next,transactionId:"ordinary-edit",edits:[{op:"set",path:["title"],value:"Ordinary draft"}],leaseId:"edited"}));expect(owner.normalizedDocumentMatching({ref:edited.next,document:resolve(owner,edited.next)})).toBeNull();
 const following=delta(owner.execute({kind:"draft",base:edited.next,transactionId:"timestamp-after-unvalidated-edit",edits:[{op:"set",path:["updatedAt"],value:"2026-10-22T02:00:00Z"}],leaseId:"following"}));expect(owner.normalizedDocumentMatching({ref:following.next,document:resolve(owner,following.next)})).toBeNull();
 for(const change of [{epoch:"forged"},{kind:"draft"},{scope:{...seed.next.scope,projectId:"forged"}}])expect(()=>owner.normalizedDocumentMatching({ref:{...seed.next,...change} as SourceSnapshotRef,document:body})).toThrow();
 expect(()=>owner.execute({kind:"normalizedSourceDocumentMatching",ref:seed.next,document:body} as any)).toThrow(/Unknown/);
});
it("reports private merged worker phases without changing its exact source result",()=>{
 const {owner,document,seed}=setup(),next=cloneSourceValue(document);next.title="Actual native merge";const packet={document:next,baseDocument:document};
 const stages:{stage:string;duration:number}[]=[];
 const observed=owner.registerActualMergedPublication({current:seed.next,publicationId:"timed-native",packet,result:{document:next,conflicts:[]},leaseId:"observed"},(stage,duration)=>stages.push({stage,duration}));
 expect(stages.map(item=>item.stage)).toEqual(["rememberPublication","normalize","register.share","register.freeze","register.candidates","register.account","register.retain","register.diff","history","bodyCompare"]);
 expect(stages.every(item=>Number.isFinite(item.duration)&&item.duration>=0)).toBe(true);
 const plain=owner.registerActualMergedPublication({current:seed.next,publicationId:"timed-native",packet,result:{document:next,conflicts:[]},leaseId:"plain"});expect(resolve(owner,observed.next)).toEqual(resolve(owner,plain.next));expect(observed.edits).toEqual(plain.edits);
});

it("retains an oversized timestamp draft without promoting its optional validation proof",()=>{
 const {owner,seed}=setup(),timestamp=" ".repeat(CAPACITY.pageStructureBytes)+"2026-10-22";
 expect(Number.isFinite(Date.parse(timestamp))).toBe(true);
 const draft=delta(owner.execute({kind:"draft",base:seed.next,transactionId:"oversized-valid-date",edits:[{op:"set",path:["updatedAt"],value:timestamp}],leaseId:"recoverable-oversize"}));
 const body=resolve(owner,draft.next);expect(body.updatedAt).toBe(timestamp);expect(draft.next.kind).toBe("draft");expect(owner.normalizedDocumentMatching({ref:draft.next,document:body})).toBeNull();
 expect(()=>owner.execute({kind:"normalize",ref:draft.next})).toThrow(/Page structure/);
});
