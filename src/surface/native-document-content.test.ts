import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {nativeDocumentContentKey,nativeDocumentBodiesEqual,mergeNativeDocumentReceipt,mergeNativeProjectionReceipt} from "./native-document-content";

it("timestamps and JSON object key order do not create another native editor mutation",()=>{
  const base=createResource(blankDocument(),"board"),next={...structuredClone(base),updatedAt:"2026-10-21T08:40:00Z"};
  next.content={...next.content,attrs:Object.fromEntries(Object.entries(next.content.attrs??{}).reverse())};
  expect(nativeDocumentContentKey(next)).toBe(nativeDocumentContentKey(base));
});
it("editable metadata, comments and causal heads remain real source mutations",()=>{
  const base=blankDocument(),key=nativeDocumentContentKey(base);
  expect(nativeDocumentContentKey({...base,title:"Remote title"})).not.toBe(key);
  expect(nativeDocumentContentKey({...base,comments:[{id:"comment",text:"remote",createdAt:base.createdAt,resolved:false}]})).not.toBe(key);
  const next=structuredClone(base);next.content.attrs={...next.content.attrs,inkState:{format:"showai-ink-state-v1",clock:{writer:1}}};
  expect(nativeDocumentContentKey(next)).not.toBe(key);
});

import {addNode,editNode} from "./editing";
import {createPortableInk} from "./portable-ink.mjs";
import {stampInkDocument,inkWireConflicts} from "./ink-wire.mjs";
import {mergePageContent,canCommitPageMerge} from "../core/page-merge-model";
import {findSurfaceNode} from "./document.mjs";
import type {ShowDocument} from "../types";
function source(){
 let page=createResource(blankDocument(),"board") as ShowDocument;
 page=addNode(page,{type:"drawing",attrs:{id:"stroke",tool:"pen",color:"#111111",strokeWidth:2,extent:[100,60],points:[{x:0,y:0},{x:80,y:40}],ink:createPortableInk([{x:0,y:0,pressure:.5},{x:80,y:40,pressure:.8}],2,[100,60])}},
  {x:0,y:0,width:100,height:60},page.content.attrs!.id) as ShowDocument;
 page=addNode(page,{type:"drawing",attrs:{id:"shape",tool:"rectangle",color:"#111111",strokeWidth:2,label:"Original",extent:[100,60],points:[{x:0,y:0},{x:100,y:60}]}},
  {x:200,y:0,width:100,height:60},page.content.attrs!.id) as ShowDocument;
 return stampInkDocument(page,undefined,{actor:"seed",sequence:1});
}
const node=(page:ShowDocument,id="stroke")=>findSurfaceNode(page,id)!.node;
function edit(base:ShowDocument,actor:string,change:(page:ShowDocument)=>void){const page=structuredClone(base);change(page);return stampInkDocument(page,base,{actor,sequence:1})}
it("accepts an actual native late-force receipt directly only against the complete issued body",()=>{
 const base=source(),current=structuredClone(base);current.updatedAt="2026-10-21T12:00:00Z";
 current.content.attrs=Object.fromEntries(Object.entries(current.content.attrs!).reverse());
 const incoming=edit(base,"pencil",page=>{node(page).attrs!.ink.samples[0][8]=.7;node(page).attrs!.ink.samples[0][3]=3});
 const result=mergeNativeDocumentReceipt(base,current,incoming);
 expect(result.document).toBe(incoming);expect(result.conflicts).toEqual([]);
 expect(node(result.document).attrs!.ink.samples[0][3]).toBe(3);expect(nativeDocumentBodiesEqual(base,current)).toBe(true);
});
it("compares actual mutable fields on every call and ignores only root updatedAt",()=>{
 const base=source(),current=structuredClone(base);expect(nativeDocumentBodiesEqual(base,current)).toBe(true);
 const edits=[(p:ShowDocument)=>{p.title="Changed"},(p:ShowDocument)=>{p.createdAt="2026-01-01T00:00:00Z"},(p:ShowDocument)=>{p.content.attrs!.updatedAt="Nested content mutation"},(p:ShowDocument)=>{p.layout!.stroke.x=91},(p:ShowDocument)=>{node(p).attrs!.ink.samples[0][0]=4},(p:ShowDocument)=>{p.content.content!.reverse()},(p:ShowDocument)=>{p.comments=[{id:"comment",text:"Remote",createdAt:base.createdAt,resolved:false}]}];
 for(const change of edits){const value=structuredClone(base);change(value);expect(nativeDocumentBodiesEqual(base,value)).toBe(false)}
 node(current).attrs!.color="#ff0000";expect(nativeDocumentBodiesEqual(base,current)).toBe(false);
});
it("preserves real foreign color variants while merging a late native width correction",()=>{
 const base=source(),a=edit(base,"left",page=>{node(page).attrs!.color="#ff0000"}),b=edit(base,"right",page=>{node(page).attrs!.color="#0000ff"});
 const current=mergePageContent(base,a,b).document,incoming=edit(base,"native",page=>{node(page).attrs!.strokeWidth=9});
 const result=mergeNativeDocumentReceipt(base,current,incoming);
 expect(result).toEqual(mergePageContent(base,current,incoming));expect(result.document).not.toBe(incoming);
 expect(node(result.document).attrs!.strokeWidth).toBe(9);expect(inkWireConflicts(result.document).some(conflict=>conflict.field==="color"&&conflict.retained)).toBe(true);
});
it("clock/head/tombstone differences always retain actual causal merging",()=>{
 const base=source(),incoming=edit(base,"native",page=>{node(page).attrs!.strokeWidth=8});
 const clock=structuredClone(base);clock.content.attrs!.inkState.clock.observed=1;
 expect(nativeDocumentBodiesEqual(base,clock)).toBe(false);expect(mergeNativeDocumentReceipt(base,clock,incoming)).toEqual(mergePageContent(base,clock,incoming));
 const sameValueOwner=edit(base,"foreign",page=>{node(page).attrs!.color="#ff0000"}),unresolved=mergePageContent(base,sameValueOwner,incoming).document;
 expect(nativeDocumentBodiesEqual(base,unresolved)).toBe(false);
 const removed=edit(base,"eraser",page=>{page.content.content=page.content.content!.filter(item=>item.attrs!.id!=="stroke");delete page.layout!.stroke});
 const deleted=mergeNativeDocumentReceipt(base,removed,incoming);expect(deleted).toEqual(mergePageContent(base,removed,incoming));expect(node(deleted.document,"shape")).toBeDefined();
});
it("does not silently replace a simultaneous generic same-field edit",()=>{
 const base=source(),current=editNode(base,"shape",value=>{value.attrs!.label="Editor label"}) as ShowDocument,incoming=editNode(base,"shape",value=>{value.attrs!.label="Native label"}) as ShowDocument;
 const result=mergeNativeDocumentReceipt(base,current,incoming);
 expect(result).toEqual(mergePageContent(base,current,incoming));expect(canCommitPageMerge(result)).toBe(false);expect(result.conflicts.length).toBeGreaterThan(0);
});
it("rejects an unrelated Page even when a caller supplies otherwise matching content",()=>{
 const base=source();expect(()=>mergeNativeDocumentReceipt(base,base,{...base,id:"other-page"})).toThrow("baseline");
});

import {beforeAll,afterAll} from "vitest";
import {Worker} from "node:worker_threads";
import {build} from "esbuild";
import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
let worker:Worker,workerRoot:string,requestID=0;
const pending=new Map<number,{resolve:(value:ReturnType<typeof mergePageContent>)=>void;reject:(error:Error)=>void}>();
beforeAll(async()=>{
 const parent=process.env.SHOWAI_TEST_HOME??tmpdir();await mkdir(parent,{recursive:true});workerRoot=await mkdtemp(join(parent,"native-receipt-merge-"));
 const entry=join(workerRoot,"entry.ts"),output=join(workerRoot,"worker.cjs");
 await writeFile(entry,`import {parentPort} from 'node:worker_threads';import {mergePageContent} from ${JSON.stringify(join(process.cwd(),"src/core/page-merge-model.ts"))};
parentPort.on('message',({id,baseline,current,incoming})=>{try{parentPort.postMessage({id,result:mergePageContent(baseline,current,incoming)})}catch(error){parentPort.postMessage({id,error:String(error)})}});`);
 await build({entryPoints:[entry],outfile:output,bundle:true,platform:"node",format:"cjs",nodePaths:[join(process.cwd(),"node_modules")],logLevel:"silent"});
 worker=new Worker(output);worker.on("message",message=>{const request=pending.get(message.id);if(!request)return;pending.delete(message.id);if(message.error)request.reject(new Error(message.error));else request.resolve(message.result)});
 worker.on("error",error=>{for(const request of pending.values())request.reject(error instanceof Error?error:new Error(String(error)));pending.clear()});
},30000);
afterAll(async()=>{if(worker)await worker.terminate();if(workerRoot)await rm(workerRoot,{recursive:true,force:true})});
function backgroundMerge(baseline:ShowDocument,current:ShowDocument,incoming:ShowDocument){
 return new Promise<ReturnType<typeof mergePageContent>>((resolve,reject)=>{const id=++requestID;pending.set(id,{resolve,reject});worker.postMessage({id,baseline,current,incoming})});
}
it("retries a real background merge against edits arriving during its await",async()=>{
 const baseline=source(),incoming=edit(baseline,"native",page=>{node(page).attrs!.strokeWidth=9});let current=edit(baseline,"foreign",page=>{node(page).attrs!.color="#ff0000"}),calls=0;
 const accepted=await mergeNativeProjectionReceipt(baseline,incoming,()=>current,async(next,snapshot)=>{
  const result=await backgroundMerge(baseline,snapshot,next);
  if(++calls===1)current=editNode(current,"shape",value=>{value.attrs!.label="Arrived during worker"}) as ShowDocument;
  return result;
 });
 expect(calls).toBe(2);expect(accepted!.current).toBe(current);expect(node(accepted!.result.document,"shape").attrs!.label).toBe("Arrived during worker");expect(node(accepted!.result.document).attrs).toMatchObject({color:"#ff0000",strokeWidth:9});
});
it("also detects a mutation of the same object while the actual worker is running",async()=>{
 const baseline=source(),incoming=edit(baseline,"native",page=>{node(page).attrs!.strokeWidth=9}),current=edit(baseline,"foreign",page=>{node(page).attrs!.color="#ff0000"});let calls=0;
 const accepted=await mergeNativeProjectionReceipt(baseline,incoming,()=>current,async(next,snapshot)=>{
  const result=await backgroundMerge(baseline,snapshot,next);if(++calls===1)node(current,"shape").attrs!.label="In-place foreign mutation";return result;
 });
 expect(calls).toBe(2);expect(node(accepted!.result.document,"shape").attrs!.label).toBe("In-place foreign mutation");
});
it("does not publish a worker result after changing Page or becoming read-only",async()=>{
 const baseline=source(),incoming=edit(baseline,"native",page=>{node(page).attrs!.strokeWidth=9});
 for(const mode of ["page","readOnly"]){let current=edit(baseline,"foreign",page=>{node(page).attrs!.color="#ff0000"}),active=true;
  const accepted=await mergeNativeProjectionReceipt(baseline,incoming,()=>current,async(next,snapshot)=>{const result=await backgroundMerge(baseline,snapshot,next);if(mode==="page")current={...current,id:"another-page"};else active=false;return result},()=>active);
  expect(accepted).toBeNull();
 }
});

it("copies actual transient author metadata onto the captured worker body without changing canonical source",async()=>{
 const baseline=source(),incoming=edit(baseline,"native",page=>{node(page).attrs!.strokeWidth=9}),current=edit(baseline,"foreign",page=>{node(page).attrs!.color="#ff0000"});
 const authors=new WeakMap<ShowDocument,{intentId:string}>(),author={intentId:"actual-ui-intent"};authors.set(current,author);
 const accepted=await mergeNativeProjectionReceipt(baseline,incoming,()=>current,async(next,snapshot)=>{
  expect(authors.get(snapshot)).toBe(author);return await backgroundMerge(baseline,snapshot,next);
 },()=>true,(observed,snapshot)=>{const metadata=authors.get(observed);if(metadata)authors.set(snapshot,metadata)});
 expect(accepted!.basis).not.toBe(current);expect(nativeDocumentBodiesEqual(accepted!.basis,current)).toBe(true);expect(node(accepted!.result.document).attrs!.strokeWidth).toBe(9);
});
