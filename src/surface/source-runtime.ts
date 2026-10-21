import type {ShowDocument} from "../types";
import {assertContent,CapacityError} from "../portable/capacity.mjs";
import {reconcileSurface,artifactVersion} from "./document.mjs";
import {parseArtifact,parseArtifactConsumingDocument,isDocumentTimestamp} from "../portable/validation.mjs";
import {mergePageContent,canCommitPageMerge,type PageMergeConflict} from "../core/page-merge-model";
import {inkWireResolutionCandidates} from "./ink-wire.mjs";
import {nativeContentHistoryStages,type NativeContentHistoryAction} from "./native-content-history";
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
  history?:{sourceOnly:SourceSnapshotDelta;stages:{groupId:string;delta:SourceSnapshotDelta}[]};
}
interface Lease {leaseId?:string}
export type SourceRuntimeRequest =
 | ({kind:"seed";scope:SourceScope;document:ShowDocument;proof?:"draft"|"normalized"}&Lease)
 | ({kind:"draft";base:SourceSnapshotRef;edits:NativeSourceEdit[];transactionId:string}&Lease)
 | ({kind:"normalize";ref:SourceSnapshotRef}&Lease)
 | ({kind:"publication";current:SourceSnapshotRef;publicationId:string;packet:{document:ShowDocument;baseDocument:ShowDocument;pageId?:string;[key:string]:unknown}}&Lease)
 | ({kind:"merge";base:SourceSnapshotRef;current:SourceSnapshotRef;incoming:SourceSnapshotRef;mode?:"history"}&Lease)
 | ({kind:"history";base:SourceSnapshotRef;current:SourceSnapshotRef;entries:SourceSnapshotRef[]}&Lease)
 | {kind:"delta";base:SourceSnapshotRef;next:SourceSnapshotRef}
 | {kind:"resolve";ref:SourceSnapshotRef}
 | {kind:"serialize";ref:SourceSnapshotRef}
 | {kind:"retain";leaseId:string;refs:SourceSnapshotRef[]}
 | {kind:"release";leaseId:string}
 | {kind:"dispose";scope:SourceScope};
export interface SourceHistoryResult {rebasedHistory:{delta:SourceSnapshotDelta;unchanged:boolean}[]}
export type SourceRuntimeResponse=SourceHistoryResult|SourceSnapshotDelta|{ref:SourceSnapshotRef;document:ShowDocument}|{ref:SourceSnapshotRef;json:string}|{retained:number};
export type SourceRuntimeObserver=(stage:string,durationMilliseconds:number)=>void;
function measured<T>(observer:SourceRuntimeObserver|undefined,stage:string,operation:()=>T):T{
 if(!observer)return operation();
 const now=()=>globalThis.performance?.now?.()??Date.now(),started=now();
 try{return operation()}finally{observer(stage,now()-started)}
}
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
 if(typeof value==="number"&&!Number.isFinite(value))throw new TypeError("Invalid native source delta: non-JSON value");
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
const equalOwned=(one:unknown,two:unknown):boolean=>{
 if(one===two&&(isOwnedSource(one)||one===null||typeof one!=="object"))return true;
 if(!one||!two||typeof one!=="object"||typeof two!=="object"||Array.isArray(one)!==Array.isArray(two))return false;
 if(Array.isArray(one)&&Array.isArray(two))return one.length===two.length&&one.every((value,index)=>equalOwned(value,two[index]));
 const keys=Object.keys(one);return keys.length===Object.keys(two).length&&keys.every(key=>Object.hasOwn(two,key)&&equalOwned((one as Record<string,unknown>)[key],(two as Record<string,unknown>)[key]));
};
/** Unlike generic mutable-source diff, both inputs are actual owned snapshots.
 * Identity shortcuts are restricted to this module's recursively frozen data. */
export function diffOwnedSource(before:unknown,next:unknown):NativeSourceEdit[]{
 if(!isOwnedSource(before)||!isOwnedSource(next))throw new SourceRuntimeError("SOURCE_NOT_OWNED","Draft diff requires actual immutable owned graphs");
 const edits:NativeSourceEdit[]=[];
 const visit=(one:unknown,two:unknown,path:(string|number)[])=>{
  if(one===two&&(isOwnedSource(one)||one===null||typeof one!=="object"))return;
  if(!one||!two||typeof one!=="object"||typeof two!=="object"||Array.isArray(one)!==Array.isArray(two)){
   if(one!==two)edits.push({op:"set",path,value:cloneSourceValue(two)});return;
  }
  if(Array.isArray(one)&&Array.isArray(two)){
   if(one.length!==two.length){let prefix=0,suffix=0,limit=Math.min(one.length,two.length);
    while(prefix<limit&&equalOwned(one[prefix],two[prefix]))prefix++;
    while(suffix<limit-prefix&&equalOwned(one.at(-1-suffix),two.at(-1-suffix)))suffix++;
    if(suffix){edits.push({op:"splice",path,index:prefix,deleteCount:one.length-prefix-suffix,items:cloneSourceValue(two.slice(prefix,two.length-suffix))});return}
   }
   for(let index=0;index<two.length;index++)if(index<one.length)visit(one[index],two[index],[...path,index]);else edits.push({op:"set",path:[...path,index],value:cloneSourceValue(two[index])});
   if(two.length<one.length)edits.push({op:"resize",path,length:two.length});return;
  }
  const a=one as Record<string,unknown>,b=two as Record<string,unknown>;
  for(const key of Object.keys(a).sort())if(!Object.hasOwn(b,key))edits.push({op:"remove",path:[...path,key]});
  for(const key of Object.keys(b).sort())if(Object.hasOwn(a,key))visit(a[key],b[key],[...path,key]);else edits.push({op:"set",path:[...path,key],value:cloneSourceValue(b[key])});
 };visit(before,next,[]);return edits;
}
/** The owner stores the actual validated canonical result, including known
 * defaults. The validator preserves legal unknown root/comment fields; a proof
 * must describe exactly the document returned by ordinary artifact parsing. */
export function normalizeSourceDocument(document:ShowDocument):ShowDocument{
 const normalized=reconcileSurface(document);
 return parseArtifact({format:"showai",version:artifactVersion(normalized),document:normalized}).document;
}
function normalizeParsedSourceDocument(document:ShowDocument):ShowDocument{
 // Retain the original result root for history's pre-normalization semantics;
 // reconcile's no-clone route owns its maps and copies changed model nodes.
 const normalized=reconcileSurface({...document},{clone:false});
 return parseArtifactConsumingDocument({format:"showai",version:artifactVersion(normalized),document:normalized}).document;
}
interface Snapshot {ref:SourceSnapshotRef;document:ShowDocument;candidates:SourceSnapshotDelta["inkCandidates"];conflicts:PageMergeConflict[]}
/** Same synchronous service runs in Native JSC, a browser worker or Node.
 * No transport/client is allowed to construct a registered reference itself. */
export class SourceRuntimeOwner {
 readonly ownerId:string;readonly epoch:string;
 private nextId=0;
 private snapshots=new Map<string,Snapshot>();
 private validatedBodies=new WeakSet<ShowDocument>();
 private leases=new Map<string,Set<string>>();
 private transactions=new Map<string,{base:SourceSnapshotRef;edits:NativeSourceEdit[];next:SourceSnapshotRef;leaseId?:string}>();
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
 private prune(protectedIds:ReadonlySet<string>=new Set()){
  const pinned=new Set([...this.leases.values()].flatMap(set=>[...set])),perScope=new Map<string,number>();
  for(const id of pinned){const entry=this.snapshots.get(id);if(entry){const key=scopeKey(entry.ref.scope);perScope.set(key,(perScope.get(key)??0)+1)}}
  if([...perScope.values()].some(count=>count>this.limits.pinned))fail("Live page source retention exceeds its explicit per-scope budget");
  const unleased=[...this.snapshots.keys()].filter(id=>!pinned.has(id)&&!protectedIds.has(id));
  let remaining=unleased.length;
  for(const id of unleased){if(remaining<=this.limits.unleased&&this.residentBytes<=this.limits.bytes)break;this.forget(id);remaining--}
  // Explicit pins always win over cache pressure. Callers can persist/retire an
  // inactive scope; no author/history state is silently evicted to hit bytes.
  for(const [key,transaction]of this.transactions){
   if(this.transactions.size<=512&&this.residentBytes<=this.limits.bytes)break;
   // An unanswered exact draft keeps its original transaction under its live
   // response lease. Completed replay cache cannot silently consume unlimited
   // point payload memory outside the same source residency budget.
   if(transaction.leaseId&&this.leases.has(transaction.leaseId))continue;
   this.transactions.delete(key);this.account(transaction.edits,-1);
  }
  while(this.publications.size>8){const key=this.publications.keys().next().value!,value=this.publications.get(key);this.publications.delete(key);if(value&&typeof value==="object")this.account(value,-1)}
 }
 private retain(leaseId:string,refs:SourceSnapshotRef[]){
  if(!leaseId)fail("Source lease requires an identity");
  const ids=new Set(refs.map(ref=>this.get(ref).ref.snapshotId)),previous=this.leases.get(leaseId);
  this.leases.set(leaseId,ids);
  try{this.prune()}catch(error){if(previous)this.leases.set(leaseId,previous);else this.leases.delete(leaseId);throw error}
  return {retained:ids.size};
 }
 private register(targetScope:SourceScope,document:ShowDocument,kind:SourceSnapshotRef["kind"],base:Snapshot|null,leaseId?:string,conflicts:PageMergeConflict[]=[],preparedEdits?:NativeSourceEdit[],observer?:SourceRuntimeObserver):SourceSnapshotDelta{
  scope(targetScope);if(document.id!==targetScope.pageId)fail("Source body belongs to another page");
  const shared=measured(observer,"register.share",()=>base&&!preparedEdits?shareNativeSource(base.document,document):document);
  const body=measured(observer,"register.freeze",()=>freezeOwnedSource(shared));
  if(kind==="normalized")this.validatedBodies.add(body);
  else if(!this.validatedBodies.has(body)&&base&&preparedEdits&&this.validatedBodies.has(base.document)&&preparedEdits.every(edit=>edit.op==="set"&&edit.path.length===1&&edit.path[0]==="updatedAt")&&isDocumentTimestamp(body.updatedAt)){
   // Exact COW edits preserve all other validated JSON and model fields. The
   // timestamp's official rule plus a complete capacity check cover the only
   // changed field, including unusually large valid timestamp strings.
   try{assertContent(body);this.validatedBodies.add(body)}
   catch(error){
    // Model-invalid JSON is still a recoverable draft. A capacity failure only
    // declines this optional proof; the real save barrier remains authoritative.
    if(!(error instanceof CapacityError))throw error;
   }
  }
  const ref=freezeOwnedSource({format:"showai-source-snapshot-v1" as const,ownerId:this.ownerId,epoch:this.epoch,snapshotId:`snapshot-${++this.nextId}`,scope:{...targetScope},kind});
  const candidates=measured(observer,"register.candidates",()=>kind==="normalized"?inkWireResolutionCandidates(body):[]);
  this.snapshots.set(ref.snapshotId,{ref,document:body,candidates,conflicts});measured(observer,"register.account",()=>this.account(body,1));
  try{measured(observer,"register.retain",()=>{if(leaseId)this.retain(leaseId,[ref]);else this.prune(new Set([ref.snapshotId]));});}
  catch(error){this.forget(ref.snapshotId);throw error}
  const edits=base?measured(observer,"register.diff",()=>preparedEdits??diffOwnedSource(base.document,body)):undefined;
  return {format:"showai-owned-source-v1",base:base?.ref??null,next:ref,...(base?{edits:edits!}:{full:body}),conflicts,inkCandidates:candidates};
 }
 private rememberPublication(current:Snapshot,publicationId:string,packet:{document:ShowDocument;baseDocument:ShowDocument;pageId?:string;[key:string]:unknown},parsedPacket?:()=>typeof packet){
  if(!publicationId||packet.document?.id!==current.ref.scope.pageId||packet.baseDocument?.id!==current.ref.scope.pageId||packet.pageId&&packet.pageId!==current.ref.scope.pageId)fail("Native publication has no matching actual source scope");
  const key=scopeKey(current.ref.scope)+"\u0000"+publicationId,known=this.publications.get(key);
  if(known&&diffNativeSource(known,packet).length)fail("Native publication identity names a different complete packet");
  if(!known){const previous=[...this.publications.values()].at(-1),copy=parsedPacket?parsedPacket():cloneSourceValue(packet),value=freezeOwnedSource(previous?shareNativeSource(previous,copy):copy);this.publications.set(key,value);this.account(value,1)}
 }
 private finishPublication(current:Snapshot,publicationId:string,packet:{document:ShowDocument;baseDocument:ShowDocument;[key:string]:unknown},merged:{document:ShowDocument;conflicts:PageMergeConflict[]},leaseId?:string,observer?:SourceRuntimeObserver,parsedDocument?:()=>ShowDocument):SourceSnapshotDelta{
  if(!canCommitPageMerge(merged))throw new SourceRuntimeError("SOURCE_MERGE_CONFLICT","Native publication requires explicit conflict resolution");
  const actions=packet.nativeContentActions as NativeContentHistoryAction[]|undefined;
  if(actions?.length&&!leaseId)fail("Native history publication requires an explicit response lease");
  const normalized=measured(observer,"normalize",()=>parsedDocument?normalizeParsedSourceDocument(parsedDocument()):normalizeSourceDocument(merged.document));
  const result=this.register(current.ref.scope,normalized,"normalized",current,leaseId,merged.conflicts,undefined,observer);
  measured(observer,"history",()=>{if(actions?.length){
   const plan=nativeContentHistoryStages(current.document,packet.baseDocument,packet.document,actions,{baseline:packet.baseDocument,current:current.document,incoming:packet.document,result:merged});
   const refs=[result.next];
   const sourceOnly=this.register(current.ref.scope,plan.sourceOnly,"draft",current,undefined);
   refs.push(sourceOnly.next);this.retain(leaseId!,refs);
   let previous=this.get(sourceOnly.next);const stages:{groupId:string;delta:SourceSnapshotDelta}[]=[];
   for(const stage of plan.stages){const next=this.register(current.ref.scope,stage.document,"draft",previous,undefined);refs.push(next.next);this.retain(leaseId!,refs);stages.push({groupId:stage.groupId,delta:next});previous=this.get(next.next)}
   // The caller retains returned history refs before releasing this explicit
   // response lease. No intermediate history document is normalized on UI.
   this.retain(leaseId!,refs);
   result.history={sourceOnly,stages};
  }});
  return{...result,publicationId,nativeBodyUnchanged:measured(observer,"bodyCompare",()=>nativeDocumentBodiesEqual(packet.document,this.get(result.next).document))};
 }
 /** Only an actual backend author/adoption+merge route can call this adapter.
  * A public request never accepts a client-asserted merged result. */
 registerActualMergedPublication(request:{current:SourceSnapshotRef;publicationId:string;packet:{document:ShowDocument;baseDocument:ShowDocument;[key:string]:unknown};result:{document:ShowDocument;conflicts:PageMergeConflict[]};leaseId?:string},observer?:SourceRuntimeObserver):SourceSnapshotDelta{
  const current=this.get(request.current);measured(observer,"rememberPublication",()=>this.rememberPublication(current,request.publicationId,request.packet));
  return this.finishPublication(current,request.publicationId,request.packet,request.result,request.leaseId,observer);
 }
 /** The only consuming entry creates its own independent object graph here.
  * General object callers cannot opt out of defensive capture or validation. */
 registerActualMergedJSON(raw:string,observer?:SourceRuntimeObserver):SourceSnapshotDelta{
  const request=measured(observer,"parse",()=>JSON.parse(raw)) as Parameters<SourceRuntimeOwner["registerActualMergedPublication"]>[0];
  const current=this.get(request.current);
  measured(observer,"rememberPublication",()=>this.rememberPublication(current,request.publicationId,request.packet,()=>request.packet));
  return this.finishPublication(current,request.publicationId,request.packet,request.result,request.leaseId,observer,()=>request.result.document);
 }
 /** Trusted adapter only: a ref or kind flag alone never proves a different
  * Swift/JSON body. The exact comparator includes every root field, timestamp,
  * sample, tombstone and retained variant. No JSON serialization is involved. */
 normalizedDocumentMatching(request:{ref:SourceSnapshotRef;document:ShowDocument}):ShowDocument|null{
  const current=this.get(request.ref);
  return this.validatedBodies.has(current.document)&&!diffNativeSource(current.document,request.document).length?current.document:null;
 }
 /** Actual host projections (undo/resolution) still undergo full canonical
  * normalization here. This adapter is not public client dispatch and does not
  * borrow saved/publication proofs for a different source body. */
 normalizeActualProjection(request:{base:SourceSnapshotRef;document:ShowDocument;leaseId?:string}):SourceSnapshotDelta{
  const base=this.get(request.base);
  return this.register(base.ref.scope,normalizeSourceDocument(cloneSourceValue(request.document)),"normalized",base,request.leaseId);
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
    const edits=freezeOwnedSource(cloneSourceValue(request.edits)),target=applyNativeSourceDelta(base.document,edits),result=this.register(base.ref.scope,target,"draft",base,request.leaseId,[],edits);
    if(request.leaseId)this.retain(request.leaseId,[base.ref,result.next]);
    this.transactions.set(key,{base:base.ref,edits,next:result.next,leaseId:request.leaseId});this.account(edits,1);this.prune(new Set([result.next.snapshotId]));return result;
   }
   case "normalize":{
    const current=this.get(request.ref);
    if(current.ref.kind==="normalized"){
     if(request.leaseId)this.retain(request.leaseId,[current.ref]);
     return{format:"showai-owned-source-v1",base:current.ref,next:current.ref,edits:[],conflicts:current.conflicts,inkCandidates:current.candidates};
    }
    return this.register(current.ref.scope,normalizeSourceDocument(current.document),"normalized",current,request.leaseId);
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
    this.rememberPublication(current,request.publicationId,packet);
    const merged=nativeDocumentBodiesEqual(packet.baseDocument,current.document)?{document:packet.document,conflicts:[]}:mergePageContent(packet.baseDocument,current.document,packet.document);
    return this.finishPublication(current,request.publicationId,packet,merged,request.leaseId);
   }
   case "history":{
    const base=this.get(request.base),current=this.get(request.current),entries=request.entries.map(ref=>this.get(ref));
    if(!request.leaseId)fail("History projection requires an explicit output lease");
    if([current,...entries].some(entry=>scopeKey(entry.ref.scope)!==scopeKey(base.ref.scope)))fail("Source history crosses its actual home/project/page");
    const refs:SourceSnapshotRef[]=[],history:SourceHistoryResult["rebasedHistory"]=[];
    for(const entry of entries){
     const merged=mergePageContent(base.document,current.document,entry.document,"history");
     const projected=this.register(base.ref.scope,merged.document,"draft",entry,undefined,merged.conflicts);
     refs.push(projected.next);this.retain(request.leaseId!,refs);
     history.push({delta:projected,unchanged:nativeDocumentBodiesEqual(this.get(projected.next).document,current.document)});
    }
    return{rebasedHistory:history};
   }
   case "delta":{
    const base=this.get(request.base),next=this.get(request.next);
    if(scopeKey(base.ref.scope)!==scopeKey(next.ref.scope))fail("Source delta crosses its actual home/project/page");
    return{format:"showai-owned-source-v1",base:base.ref,next:next.ref,edits:diffOwnedSource(base.document,next.document),conflicts:next.conflicts,inkCandidates:next.candidates};
   }
   case "resolve":{const value=this.get(request.ref);return{ref:value.ref,document:value.document};}
   case "serialize":{const value=this.get(request.ref);return{ref:value.ref,json:JSON.stringify(value.document)};}
   case "retain":return this.retain(request.leaseId,request.refs);
   case "release":this.leases.delete(request.leaseId);this.prune();return{retained:0};
   case "dispose":{
    const key=scopeKey(scope(request.scope));for(const [id,value]of this.snapshots)if(scopeKey(value.ref.scope)===key){this.forget(id);for(const [leaseId,lease]of this.leases){lease.delete(id);if(!lease.size)this.leases.delete(leaseId)}}
    for(const key of this.transactions.keys())if(key.startsWith(scopeKey(request.scope)+"\u0000")){const value=this.transactions.get(key)!;this.transactions.delete(key);this.account(value.edits,-1);}
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

export function registerActualMergedPublication(raw:string,observer?:SourceRuntimeObserver):string{
 service??=new SourceRuntimeOwner();
 return JSON.stringify(service.registerActualMergedJSON(raw,observer));
}

export function normalizeActualProjection(raw:string):string{
 service??=new SourceRuntimeOwner();
 return JSON.stringify(service.normalizeActualProjection(JSON.parse(raw)));
}

/** Private validation-entry adapter; deliberately absent from execute(). */
export function normalizedSourceDocumentMatching(request:{ref:SourceSnapshotRef;document:ShowDocument}):ShowDocument|null{
 service??=new SourceRuntimeOwner();return service.normalizedDocumentMatching(request);
}
