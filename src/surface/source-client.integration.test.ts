import {expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {Worker} from "node:worker_threads";
import {build} from "esbuild";
import {OwnedSourceSession,sourceSnapshotFor,type SourceRuntimeTransport} from "./source-client";
import {createResource} from "./containers.mjs";
import {blankDocument} from "../core/catalog";
import type {SourceRuntimeResponse,SourceSnapshotRef} from "./source-runtime";

it("retries the original exact draft after a real worker reply is lost without losing queued N+1",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"showai-source-lost-reply-"));let worker:Worker|undefined;
 try{
  const entry=join(directory,"owner.cjs");await build({entryPoints:[resolve("src/core/source-runtime-node-worker.ts")],outfile:entry,bundle:true,platform:"node",format:"cjs",logLevel:"silent"});worker=new Worker(entry);
  const drop=new Error("Actual registered worker reply was dropped"),draftIds:string[]=[];let sequence=0,dropNextDraft=true,lostRef:SourceSnapshotRef|undefined;
  const transport:SourceRuntimeTransport={sourceClientId:crypto.randomUUID(),scope:async(projectId,pageId)=>({homeId:directory,projectId,pageId}),request:request=>new Promise<SourceRuntimeResponse>((done,reject)=>{
   const id=String(++sequence);if(request.kind==="draft")draftIds.push(request.transactionId);
   const receive=(message:{id:string;ok:boolean;data:any;error:any})=>{if(message.id!==id)return;worker!.off("message",receive);
    if(message.ok&&request.kind==="draft"&&dropNextDraft){dropNextDraft=false;lostRef=message.data.next;reject(drop);return;}
    if(message.ok)done(message.data);else reject(Object.assign(new Error(message.error.message),message.error));
   };worker!.on("message",receive);worker!.postMessage({id,request});
  }),close:async()=>{await worker!.terminate()}};
  const document=createResource(blankDocument(),"board"),session=new OwnedSourceSession("actual-project",document.id,transport),initial=session.replace(document);await session.barrier();
  const n=session.replace({...initial,title:"N"}),pendingGetter=sourceSnapshotFor(n);void pendingGetter.catch(()=>{});
  const n1=session.replace({...n,title:"N+1",comments:[{id:"new",text:"Must remain",createdAt:n.createdAt,resolved:false}]});
  expect(session.document).toBe(n1);await expect(session.barrier()).rejects.toBe(drop);await expect(pendingGetter).rejects.toBe(drop);
  expect(session.document!.title).toBe("N+1");expect(draftIds).toHaveLength(1);
  await session.retryRegistration();expect(draftIds).toHaveLength(3);expect(draftIds[0]).toBe(draftIds[1]);expect(draftIds[2]).not.toBe(draftIds[0]);
  expect((await sourceSnapshotFor(n))!.ref).toEqual(lostRef);const latest=await session.reference(n1),resolved=await transport.request({kind:"resolve",ref:latest}) as {document:typeof n1};
  expect(resolved.document.title).toBe("N+1");expect(resolved.document.comments![0].text).toBe("Must remain");await session.dispose();
 }finally{await worker?.terminate();await rm(directory,{recursive:true,force:true})}
});
