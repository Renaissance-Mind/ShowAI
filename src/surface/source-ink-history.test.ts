import {expect,it} from "vitest";
import {Worker} from "node:worker_threads";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {build} from "esbuild";
import {SourceRuntimeOwner,cloneSourceValue,type SourceSnapshotDelta,type SourceSnapshotRef,type SourceInkHistoryResult,type SourceRuntimeResponse,type SourceRuntimeRequest} from "./source-runtime";
import {OwnedSourceSession,sourceSnapshotFor,type SourceRuntimeTransport} from "./source-client";
import {appendNewPortableInk} from "./portable-ink-append.mjs";
import {createResource} from "./containers.mjs";
import {blankDocument} from "../core/catalog";
import type {ShowDocument} from "../types";
import type {JSONContent} from "@tiptap/core";

function fixture(maximumPinned=256){
 const owner=new SourceRuntimeOwner({maximumPinned,maximumUnleased:0}),document=createResource(blankDocument(),"board") as ShowDocument;
 const scope={homeId:"actual-ink-home",projectId:"actual-project",pageId:document.id};
 const seed=(body:ShowDocument,leaseId:string)=>(owner.execute({kind:"seed",scope,document:body,leaseId}) as SourceSnapshotDelta).next;
 const base=seed(document,"base"),boardId=document.content.attrs!.id as string;
 return{owner,document,scope,seed,base,boardId};
}
const resolveBody=(owner:SourceRuntimeOwner,ref:SourceSnapshotRef)=>(owner.execute({kind:"resolve",ref}) as {document:ShowDocument}).document;
const frame={x:3,y:4,width:800,height:30};
function stroke(id="stroke-a",count=257):JSONContent{return{type:"drawing",attrs:{id,tool:"pen",color:"#111111",strokeWidth:2,extent:[800,30],points:[{x:0,y:10},{x:257,y:10}],ink:{format:"showai-ink-v2",geometryVersion:1,brushVersion:1,brush:"pen",strokeCount:1,width:2,opacity:0.5,extent:[800,30],transform:[1,0,0,1,0,0],outlineTolerance:0.0025,segments:Array.from({length:count},(_,i)=>({points:[[i,10],[i+1,10]],radius:[1,1]}))}}}}
function inkSource(f:ReturnType<typeof fixture>,id="stroke-a",count=257){return f.seed(appendNewPortableInk(f.document,f.boardId,stroke(id,count),frame),`source-${id}`)}
function append(f:ReturnType<typeof fixture>,source:SourceSnapshotRef,entries:SourceSnapshotRef[],leaseId="ink-output"){
 return f.owner.execute({kind:"historyAppendInk",source,boardId:f.boardId,strokeId:"stroke-a",entries,leaseId}) as SourceInkHistoryResult;
}
it("projects actual sealed ink as draft refs without cloning or repeating its large body on the history wire",()=>{
 const f=fixture(),source=inkSource(f,"stroke-a",20001),other=f.seed({...f.document,title:"Later edit",futureRoot:{all:["é","é"]}} as ShowDocument,"later");
 const result=append(f,source,[f.base,other,f.base]),actualSource=resolveBody(f.owner,source),a=resolveBody(f.owner,result.entries[0].next),b=resolveBody(f.owner,result.entries[1].next);
 expect(result.entries).toHaveLength(3);expect(result.entries[0].next).toEqual(result.entries[2].next);
 expect(result.entries.every(entry=>!entry.unchanged&&entry.next.kind==="draft")).toBe(true);
 expect(a.content.content![0]).toBe(actualSource.content.content![0]);expect(b.content.content![0]).toBe(a.content.content![0]);
 expect(a.layout!["stroke-a"]).toBe(actualSource.layout!["stroke-a"]);expect(b.title).toBe("Later edit");expect((b as any).futureRoot).toEqual({all:["é","é"]});
 expect(JSON.stringify(result).length).toBeLessThan(5000);expect(JSON.stringify(result)).not.toContain("segments");
 f.owner.execute({kind:"release",leaseId:"source-stroke-a"});f.owner.execute({kind:"release",leaseId:"base"});f.owner.execute({kind:"release",leaseId:"later"});
 expect(resolveBody(f.owner,source)).toBe(actualSource);expect(resolveBody(f.owner,result.entries[0].base).id).toBe(f.document.id);
 f.owner.execute({kind:"release",leaseId:"ink-output"});expect(()=>resolveBody(f.owner,result.entries[0].next)).toThrow(/expired/);
});
it("preserves a later existing stroke's style and pose instead of overwriting them with its earlier source",()=>{
 const f=fixture(),source=inkSource(f),body=cloneSourceValue(resolveBody(f.owner,source));body.content.content![0].attrs!.color="#f00";body.layout!["stroke-a"]={...frame,x:90};
 const later=f.seed(body,"later"),result=append(f,source,[later]);expect(result.entries[0]).toEqual({base:later,next:later,unchanged:true});
 expect(resolveBody(f.owner,result.entries[0].next).content.content![0].attrs!.color).toBe("#f00");
});
it("does not resurrect a deleted board and validates source even for empty or unchanged history",()=>{
 const f=fixture(),source=inkSource(f),page=cloneSourceValue(f.document);page.content.attrs!.id="replacement-board";
 const deleted=f.seed(page,"deleted"),result=append(f,source,[deleted]);expect(result.entries[0]).toEqual({base:deleted,next:deleted,unchanged:true});
 expect(()=>append(f,f.base,[])).toThrow();expect(()=>append(f,f.base,[source])).toThrow();
});
it("rejects actual cross-owner, epoch, proof, scope and expired refs before replacing an output lease",()=>{
 const f=fixture(),source=inkSource(f),valid=append(f,source,[f.base]);
 const foreign=new SourceRuntimeOwner(),foreignRef=(foreign.execute({kind:"seed",scope:f.scope,document:f.document}) as SourceSnapshotDelta).next;
 const changes=[foreignRef,{...f.base,epoch:"old"},{...f.base,kind:"normalized" as const},{...f.base,scope:{...f.scope,homeId:"another-home"}},{...f.base,snapshotId:"expired"}];
 for(const bad of changes)expect(()=>append(f,source,[bad])).toThrow();
 expect(resolveBody(f.owner,valid.entries[0].next).content.content![0].attrs!.id).toBe("stroke-a");
 const other=(f.owner.execute({kind:"seed",scope:{...f.scope,projectId:"other-project"},document:f.document,leaseId:"foreign-scope"}) as SourceSnapshotDelta).next;
 expect(()=>append(f,source,[other])).toThrow(/crosses/);
});
it("rejects the full projected pin budget atomically while preserving every prior input and output",()=>{
 const f=fixture(4),source=inkSource(f),first=append(f,source,[f.base]),later=f.seed({...f.document,title:"newer"},"later");
 expect(()=>append(f,source,[later],"ink-output")).toThrow(/retention/);
 expect(resolveBody(f.owner,first.entries[0].next).content.content).toHaveLength(1);expect(resolveBody(f.owner,later).title).toBe("newer");
 f.owner.execute({kind:"release",leaseId:"ink-output"});expect(()=>resolveBody(f.owner,first.entries[0].next)).toThrow(/expired/);
 const retry=append(f,source,[later]);expect(resolveBody(f.owner,retry.entries[0].next).title).toBe("newer");
});

function clientFixture(){
 const f=fixture(),requests:SourceRuntimeRequest[]=[],transport:SourceRuntimeTransport={sourceClientId:crypto.randomUUID(),scope:async()=>f.scope,request:async request=>{requests.push(request);return f.owner.execute(request)}};
 const session=new OwnedSourceSession(f.scope.projectId,f.document.id,transport);
 return{...f,session,requests,transport};
}
it("binds only actual projected history bodies, keeps current editing immediate, and pins published results before release",async()=>{
 const f=clientFixture(),initial=f.session.replace(f.document);await f.session.barrier();
 const source=f.session.captureExternal(appendNewPortableInk(initial,f.boardId,stroke(),frame),"sealed-a"),semantic=f.session.snapshot(initial);
 await f.session.retain(semantic,"actual-before-a");
 const latest=f.session.replace({...initial,title:"B typed while A builds",futureB:{keep:1}} as ShowDocument);await f.session.barrier();
 const result=await f.session.appendInkHistory(source,f.boardId,"stroke-a",[semantic,latest],"after-a");
 expect(f.session.document).toBe(latest);expect(result.documents[1].title).toBe(latest.title);expect((result.documents[1] as any).futureB).toEqual({keep:1});
 for(const document of result.documents){const ref=await f.session.reference(document);expect(ref.kind).toBe("draft");expect(resolveBody(f.owner,ref)).toEqual(document);expect((await sourceSnapshotFor(document))!.ref).toEqual(ref)}
 const published=f.session.replace(result.documents[1]);await result.release();await result.release();await f.session.barrier();
 expect(f.session.document).toBe(published);expect(resolveBody(f.owner,await f.session.reference(published)).content.content![0].attrs!.id).toBe("stroke-a");
 expect(f.requests.filter(request=>request.kind==="historyAppendInk")).toHaveLength(1);await f.session.dispose();
});
it("rejects unowned UI body copies rather than implicitly registering them as source or history",async()=>{
 const f=clientFixture(),initial=f.session.replace(f.document);await f.session.barrier();
 await expect(f.session.appendInkHistory({...initial},f.boardId,"stroke-a",[],"forged")).rejects.toThrow(/captureExternal/);
 const source=f.session.captureExternal(appendNewPortableInk(initial,f.boardId,stroke(),frame),"sealed-a");
 await expect(f.session.appendInkHistory(source,f.boardId,"stroke-a",[{...initial}],"forged")).rejects.toThrow(/captureExternal/);
 expect(f.requests.some(request=>request.kind==="historyAppendInk")).toBe(false);await f.session.dispose();
});
it("rejects changed actual response ordering before issuing any UI body proof and releases its output lease",async()=>{
 const f=fixture(),requests:SourceRuntimeRequest[]=[];
 const transport:SourceRuntimeTransport={scope:async()=>f.scope,request:async request=>{
  requests.push(request);const response=f.owner.execute(request);
  if(request.kind!=="historyAppendInk")return response;
  const actual=response as SourceInkHistoryResult;
  // Fault injection changes a real owner's reply, never fabricates the owner
  // or substitutes the actual graph registration under test.
  return{...actual,entries:[...actual.entries].reverse()};
 }};
 const session=new OwnedSourceSession(f.scope.projectId,f.document.id,transport),initial=session.replace(f.document);await session.barrier();
 await session.retain(initial,"actual-before-a");
 const latest=session.replace({...initial,title:"different baseline"}),source=session.captureExternal(appendNewPortableInk(initial,f.boardId,stroke(),frame),"sealed-a");await session.barrier();
 await expect(session.appendInkHistory(source,f.boardId,"stroke-a",[initial,latest],"reordered")).rejects.toThrow(/ordered baselines/);
 const request=requests.find(request=>request.kind==="historyAppendInk")! as Extract<SourceRuntimeRequest,{kind:"historyAppendInk"}>;
 expect(requests.some(value=>value.kind==="release"&&value.leaseId===request.leaseId)).toBe(true);expect(session.document).toBe(latest);await session.dispose();
});
it("performs ref-only ink history through a real independent Node worker and resolves complete unchanged bodies",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"showai-ink-history-"));let worker:Worker|undefined;
 try{
  const entry=join(directory,"owner.cjs");await build({entryPoints:[resolve("src/core/source-runtime-node-worker.ts")],outfile:entry,bundle:true,platform:"node",format:"cjs",logLevel:"silent"});worker=new Worker(entry);let sequence=0;
  const transport:SourceRuntimeTransport={scope:async(projectId,pageId)=>({homeId:directory,projectId,pageId}),request:request=>new Promise<SourceRuntimeResponse>((done,reject)=>{
   const id=String(++sequence),receive=(message:{id:string;ok:boolean;data:SourceRuntimeResponse;error:{message:string;code:string}})=>{if(message.id!==id)return;worker!.off("message",receive);if(message.ok)done(message.data);else reject(Object.assign(new Error(message.error.message),message.error))};
   worker!.on("message",receive);worker!.postMessage({id,request});
  }),close:async()=>{await worker!.terminate()}};
  const f=fixture(),session=new OwnedSourceSession("real-worker-project",f.document.id,transport),initial=session.replace(f.document);await session.barrier();
  const source=session.captureExternal(appendNewPortableInk(initial,f.boardId,stroke(),frame),"sealed-a"),latest=session.replace({...initial,title:"Widget B"});await session.barrier();
  const result=await session.appendInkHistory(source,f.boardId,"stroke-a",[initial,latest],"after-a");
  for(const document of result.documents){const actual=await transport.request({kind:"resolve",ref:await session.reference(document)}) as {document:ShowDocument};expect(actual.document).toEqual(document)}
  const normalized=await session.normalize(result.documents[1]);expect(normalized.next.kind).toBe("normalized");expect(session.document).toBe(latest);
  await result.release();await session.dispose();
 }finally{await worker?.terminate();await rm(directory,{recursive:true,force:true})}
});
