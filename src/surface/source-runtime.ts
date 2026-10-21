import type {ShowDocument} from "../types";
import {reconcileSurface,artifactVersion} from "./document.mjs";
import {parseArtifact} from "../portable/validation.mjs";
import {mergePageContent,canCommitPageMerge,type PageMergeConflict} from "../core/page-merge-model";
import {inkWireResolutionCandidates} from "./ink-wire.mjs";
import {nativeDocumentBodiesEqual} from "./native-document-content";
import {applyNativeSourceDelta,diffNativeSource,shareNativeSource,type NativeSourceEdit} from "./native-source-delta.mjs";

export interface SourceScope {homeId:string;projectId:string;pageId:string}
export interface SourceSnapshotRef {
  format:"showai-source-snapshot-v1";ownerId:string;epoch:string;snapshotId:string;
  scope:SourceScope;kind:"draft"|"normalized";
}
export interface SourceSnapshotDelta {
  format:"showai-owned-source-v1";base:SourceSnapshotRef|null;next:SourceSnapshotRef;
  full?:ShowDocument;edits?:NativeSourceEdit[];conflicts:PageMergeConflict[];
  inkCandidates:ReturnType<typeof inkWireResolutionCandidates>;
  publicationId?:string;nativeBodyUnchanged?:boolean;
}
interface Lease {leaseId?:string}
export type SourceRuntimeRequest =
 | ({kind:"seed";scope:SourceScope;document:ShowDocument;proof?:"draft"|"normalized"}&Lease)
 | ({kind:"draft";base:SourceSnapshotRef;edits:NativeSourceEdit[];transactionId:string}&Lease)
 | ({kind:"normalize";ref:SourceSnapshotRef}&Lease)
 | ({kind:"publication";current:SourceSnapshotRef;publicationId:string;packet:{document:ShowDocument;baseDocument:ShowDocument;pageId?:string;[key:string]:unknown}}&Lease)
 | ({kind:"merge";base:SourceSnapshotRef;current:SourceSnapshotRef;incoming:SourceSnapshotRef;mode?:"history"}&Lease)
 | {kind:"delta";base:SourceSnapshotRef;next:SourceSnapshotRef}
 | {kind:"resolve";ref:SourceSnapshotRef}
 | {kind:"serialize";ref:SourceSnapshotRef}
 | {kind:"retain";leaseId:string;refs:SourceSnapshotRef[]}
 | {kind:"release";leaseId:string}
 | {kind:"dispose";scope:SourceScope};
export type SourceRuntimeResponse=SourceSnapshotDelta|{ref:SourceSnapshotRef;document:ShowDocument}|{ref:SourceSnapshotRef;json:string}|{retained:number};
export class SourceRuntimeError extends Error {constructor(readonly code:string,message:string){super(message)}}
const fail=(message:string):never=>{throw new SourceRuntimeError("SOURCE_OWNERSHIP_CONFLICT",message)};
const scopeKey=(scope:SourceScope)=>JSON.stringify([scope.homeId,scope.projectId,scope.pageId]);
function scope(value:SourceScope){if(!value||[value.homeId,value.projectId,value.pageId].some(part=>typeof part!=="string"||!part))fail("Source scope requires its actual home, project and page");return value}
export const sameSourceRef=(one:SourceSnapshotRef|null|undefined,two:SourceSnapshotRef|null|undefined)=>!!one&&!!two&&one.ownerId===two.ownerId&&one.epoch===two.epoch&&one.snapshotId===two.snapshotId&&one.kind===two.kind&&scopeKey(one.scope)===scopeKey(two.scope);
const owned=new WeakSet<object>();
const metrics=new WeakMap<object,{bytes:number;children:object[]}>();
/** Only objects recursively owned by this module may skip future freeze walks.
 * An externally shallow-frozen parent is never evidence about its children. */
export function freezeOwnedSource<T>(value:T):T{
 if(value&&typeof value==="object"&&!owned.has(value)){
  for(const key of Object.keys(value))freezeOwnedSource((value as Record<string,unknown>)[key]);
  const children:object[]=[],keys=Object.keys(value);let bytes=48+keys.length*8;
  for(const key of keys){const child=(value as Record<string,unknown>)[key];
   if(!Array.isArray(value))bytes+=key.length*2;
   if(child&&typeof child==="object")children.push(child);
   else bytes+=typeof child==="string"?child.length*2:8;
  }
  metrics.set(value,{bytes,children});Object.freeze(value);owned.add(value);
 }
 return value;
}
export const isOwnedSource=(value:unknown):boolean=>!!value&&typeof value==="object"&&owned.has(value);
/** Independent boundary for an arbitrary external value. Exact JSON cloning
 * rejects undefined, holes, cycles and non-finite numbers instead of dropping. */
export function cloneSourceValue<T>(value:T):T{return applyNativeSourceDelta(null,[{op:"set",path:[],value}]) as T}
/** Read-only COW capture: existing owned branches may be reused; all outside
 * objects become independent before they can enter current/history/save. */
export function ownSourceValue<T>(value:T):T{
 const ancestors=new Set<object>();
 const capture=(value:unknown):unknown=>{
  if(isOwnedSource(value))return value;
  if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))return value;
  if(!value||typeof value!=="object")return fail("Mutable draft contains a non-JSON value");
  if(ancestors.has(value))fail("Mutable draft contains a cycle");ancestors.add(value);
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)fail("Mutable draft requires plain JSON objects");
  if(Array.isArray(value)&&Object.keys(value).length!==value.length)fail("Mutable draft array is sparse or decorated");
  const copy=Array.isArray(value)?[]:{};
  for(const key of Object.keys(value))Object.defineProperty(copy,key,{value:capture((value as Record<string,unknown>)[key]),enumerable:true,writable:true,configurable:true});
  ancestors.delete(value);return freezeOwnedSource(copy);
 };return capture(value) as T;
}
/** Full canonical validation belongs on an owner worker. Keep its normalized
 * graph rather than validateDocument's selected-field return value: unknown
 * source fields are part of the user's exact source body. */
export function normalizeSourceDocument(document:ShowDocument):ShowDocument{
 const normalized=reconcileSurface(document);
 parseArtifact({format:"showai",version:artifactVersion(normalized),document:normalized});
 return normalized;
}
interface Snapshot {ref:SourceSnapshotRef;document:ShowDocument;candidates:SourceSnapshotDelta["inkCandidates"];conflicts:PageMergeConflict[]}
/** Same synchronous service runs in Native JSC, a browser worker or Node.
 * No transport/client is allowed to construct a registered reference itself. */
export class SourceRuntimeOwner {
 readonly ownerId:string;readonly epoch:string;
 private nextId=0;
 private snapshots=new Map<string,Snapshot>();
 private leases=new Map<string,Set<string>>();
 private transactions=new Map<string,{base:SourceSnapshotRef;edits:NativeSourceEdit[];next:SourceSnapshotRef}>();
 private publications=new Map<string,unknown>();
 private references=new Map<object,number>();
 private residentBytes=0;
 private account(value:object,direction:1|-1){
  const count=this.references.get(value)??0,next=count+direction;
  if(next<0)throw new Error("Source graph ownership count underflow");
  if(next)this.references.set(value,next);else this.references.delete(value);
  if(direction===1&&count||direction===-1&&next)return;
  const metric=metrics.get(value);if(!metric)throw new Error("Source graph is not recursively owned");
  this.residentBytes+=direction*metric.bytes;
  for(const child of metric.children)this.account(child,direction);
 }
 private forget(id:string){const entry=this.snapshots.get(id);if(entry){this.snapshots.delete(id);this.account(entry.document,-1)}}
 constructor(options:{ownerId?:string;epoch?:string;maximumUnleased?:number;maximumPinned?:number;maximumResidentBytes?:number}={}){
  this.ownerId=options.ownerId??crypto.randomUUID();this.epoch=options.epoch??crypto.randomUUID();this.limits={unleased:options.maximumUnleased??64,pinned:options.maximumPinned??256,bytes:options.maximumResidentBytes??96*1024*1024};
 }
 private limits:{unleased:number;pinned:number;bytes:number};
 private get(ref:SourceSnapshotRef):Snapshot{
  if(!ref||ref.format!=="showai-source-snapshot-v1"||ref.ownerId!==this.ownerId||ref.epoch!==this.epoch)fail("Source owner or epoch differs");
  scope(ref.scope);const snapshot=this.snapshots.get(ref.snapshotId);
  if(!snapshot||!sameSourceRef(ref,snapshot.ref))fail("Source snapshot has expired or its scope/proof differs");
  return snapshot!;
 }
 private prune(){
  const pinned=new Set([...this.leases.values()].flatMap(set=>[...set])),perScope=new Map<string,number>();
  for(const id of pinned){const entry=this.snapshots.get(id);if(entry){const key=scopeKey(entry.ref.scope);perScope.set(key,(perScope.get(key)??0)+1)}}
  if([...perScope.values()].some(count=>count>this.limits.pinned))fail("Live page source retention exceeds its explicit per-scope budget");
  const unleased=[...this.snapshots.keys()].filter(id=>!pinned.has(id));
  let remaining=unleased.length;
  for(const id of unleased){if(remaining<=this.limits.unleased&&this.residentBytes<=this.limits.bytes)break;this.forget(id);remaining--}
  // Explicit pins always win over cache pressure. Callers can persist/retire an
  // inactive scope; no author/history state is silently evicted to hit bytes.
  while(this.transactions.size>512)this.transactions.delete(this.transactions.keys().next().value!);
  while(this.publications.size>8){const key=this.publications.keys().next().value!,value=this.publications.get(key);this.publications.delete(key);if(value&&typeof value==="object")this.account(value,-1)}
 }
 private retain(leaseId:string,refs:SourceSnapshotRef[]){
  if(!leaseId)fail("Source lease requires an identity");
  const ids=new Set(refs.map(ref=>this.get(ref).ref.snapshotId)),previous=this.leases.get(leaseId);
  this.leases.set(leaseId,ids);
  try{this.prune()}catch(error){if(previous)this.leases.set(leaseId,previous);else this.leases.delete(leaseId);throw error}
  return {retained:ids.size};
 }
 private register(targetScope:SourceScope,document:ShowDocument,kind:SourceSnapshotRef["kind"],base:Snapshot|null,leaseId?:string,conflicts:PageMergeConflict[]=[],preparedEdits?:NativeSourceEdit[]):SourceSnapshotDelta{
  scope(targetScope);if(document.id!==targetScope.pageId)fail("Source body belongs to another page");
  const body=freezeOwnedSource(base&&!preparedEdits?shareNativeSource(base.document,document):document);
  const ref=freezeOwnedSource({format:"showai-source-snapshot-v1" as const,ownerId:this.ownerId,epoch:this.epoch,snapshotId:`snapshot-${++this.nextId}`,scope:{...targetScope},kind});
  const candidates=kind==="normalized"?inkWireResolutionCandidates(body):[];
  this.snapshots.set(ref.snapshotId,{ref,document:body,candidates,conflicts});this.account(body,1);
  if(leaseId)this.retain(leaseId,[ref]);else this.prune();
  return {format:"showai-owned-source-v1",base:base?.ref??null,next:ref,...(base?{edits:preparedEdits??diffNativeSource(base.document,body)}:{full:body}),conflicts,inkCandidates:candidates};
 }
 /** Trusted host adapter only: actual backend normalization/CAS has already
  * completed. Never reachable through the client request discriminant. */
 registerActualSavedSnapshot(request:{scope:SourceScope;document:ShowDocument;base:SourceSnapshotRef;leaseId?:string}):SourceSnapshotDelta{
  const base=this.get(request.base);
  if(scopeKey(scope(request.scope))!==scopeKey(base.ref.scope))fail("Saved source crosses its actual home/project/page");
  return this.register(base.ref.scope,cloneSourceValue(request.document),"normalized",base,request.leaseId);
 }
 execute(request:SourceRuntimeRequest):SourceRuntimeResponse{
  switch(request.kind){
   case "seed":{
    const copy=cloneSourceValue(request.document),proof=request.proof??"draft";
    return this.register(request.scope,proof==="normalized"?normalizeSourceDocument(copy):copy,proof,null,request.leaseId);
   }
   case "draft":{
    const base=this.get(request.base);if(!request.transactionId)fail("Source draft requires an actual transaction identity");
    const key=scopeKey(base.ref.scope)+"\u0000"+request.transactionId,known=this.transactions.get(key);
    if(known){if(!sameSourceRef(known.base,base.ref)||diffNativeSource(known.edits,request.edits).length)fail("Source transaction identity names different edits");const next=this.get(known.next);return{format:"showai-owned-source-v1",base:base.ref,next:next.ref,edits:cloneSourceValue(known.edits),conflicts:[],inkCandidates:next.candidates};}
    const target=applyNativeSourceDelta(base.document,request.edits),result=this.register(base.ref.scope,target,"draft",base,request.leaseId,[],freezeOwnedSource(cloneSourceValue(request.edits)));
    this.transactions.set(key,{base:base.ref,edits:freezeOwnedSource(cloneSourceValue(request.edits)),next:result.next});return result;
   }
   case "normalize":{
    const current=this.get(request.ref);return this.register(current.ref.scope,normalizeSourceDocument(current.document),"normalized",current,request.leaseId);
   }
   case "merge":{
    const base=this.get(request.base),current=this.get(request.current),incoming=this.get(request.incoming);
    if(scopeKey(base.ref.scope)!==scopeKey(current.ref.scope)||scopeKey(base.ref.scope)!==scopeKey(incoming.ref.scope))fail("Source merge crosses its home/project/page");
    const merged=mergePageContent(base.document,current.document,incoming.document,request.mode);
    if(!canCommitPageMerge(merged))throw new SourceRuntimeError("SOURCE_MERGE_CONFLICT","Source edits require explicit conflict resolution");
    return this.register(current.ref.scope,normalizeSourceDocument(merged.document),"normalized",current,request.leaseId,merged.conflicts);
   }
   case "publication":{
    const current=this.get(request.current),packet=request.packet;
    if(!request.publicationId||packet.document?.id!==current.ref.scope.pageId||packet.baseDocument?.id!==current.ref.scope.pageId||packet.pageId&&packet.pageId!==current.ref.scope.pageId)fail("Native publication has no matching actual source scope");
    const key=scopeKey(current.ref.scope)+"\u0000"+request.publicationId,known=this.publications.get(key);
    if(known&&diffNativeSource(known,packet).length)fail("Native publication identity names a different complete packet");
    if(!known){
     const previous=[...this.publications.values()].at(-1),ownedPacket=freezeOwnedSource(previous?shareNativeSource(previous,cloneSourceValue(packet)):cloneSourceValue(packet));
     this.publications.set(key,ownedPacket);this.account(ownedPacket,1);
    }
    const merged=nativeDocumentBodiesEqual(packet.baseDocument,current.document)?{document:packet.document,conflicts:[]}:mergePageContent(packet.baseDocument,current.document,packet.document);
    if(!canCommitPageMerge(merged))throw new SourceRuntimeError("SOURCE_MERGE_CONFLICT","Native publication requires explicit conflict resolution");
    const result=this.register(current.ref.scope,normalizeSourceDocument(merged.document),"normalized",current,request.leaseId,merged.conflicts);
    return {...result,publicationId:request.publicationId,nativeBodyUnchanged:nativeDocumentBodiesEqual(packet.document,this.get(result.next).document)};
   }
   case "delta":{
    const base=this.get(request.base),next=this.get(request.next);
    if(scopeKey(base.ref.scope)!==scopeKey(next.ref.scope))fail("Source delta crosses its actual home/project/page");
    return{format:"showai-owned-source-v1",base:base.ref,next:next.ref,edits:diffNativeSource(base.document,next.document),conflicts:next.conflicts,inkCandidates:next.candidates};
   }
   case "resolve":{const value=this.get(request.ref);return{ref:value.ref,document:value.document};}
   case "serialize":{const value=this.get(request.ref);return{ref:value.ref,json:JSON.stringify(value.document)};}
   case "retain":return this.retain(request.leaseId,request.refs);
   case "release":this.leases.delete(request.leaseId);this.prune();return{retained:0};
   case "dispose":{
    const key=scopeKey(scope(request.scope));for(const [id,value]of this.snapshots)if(scopeKey(value.ref.scope)===key){this.forget(id);for(const lease of this.leases.values())lease.delete(id)}
    for(const key of this.transactions.keys())if(key.startsWith(scopeKey(request.scope)+"\u0000"))this.transactions.delete(key);
    for(const key of this.publications.keys())if(key.startsWith(scopeKey(request.scope)+"\u0000")){const packet=this.publications.get(key);this.publications.delete(key);if(packet&&typeof packet==="object")this.account(packet,-1)}
    return{retained:0};
   }
   default:return fail("Unknown source runtime request");
  }
 }
}
let service:SourceRuntimeOwner|undefined;
/** iOS validation-entry can re-export this directly; the registry is the same
 * real worker instance used by every resolve/save call, never a Web-side map. */
export function sourceRuntime(raw:string):string{service??=new SourceRuntimeOwner();return JSON.stringify(service.execute(JSON.parse(raw) as SourceRuntimeRequest));}

/** Only a backend adapter may expose this in its private validation VM. Public
 * sourceRuntime requests have no saved/validated flag that bypasses validation. */
export function registerActualSavedSnapshot(raw:string):string{
 service??=new SourceRuntimeOwner();
 return JSON.stringify(service.registerActualSavedSnapshot(JSON.parse(raw)));
}
