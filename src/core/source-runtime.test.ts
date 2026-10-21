import {expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {Worker} from "node:worker_threads";
import {build} from "esbuild";
import {FileStore} from "./store";
import {mergePageContent} from "./page-merge-model";
import {SourceRuntimeOwner,type SourceSnapshotDelta,type SourceSnapshotRef} from "../surface/source-runtime";
it("preserves unknown root/comment metadata through actual FileStore CAS, reopen, merge and saved snapshot registration",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"showai-owned-source-save-"));
 try{
  const store=new FileStore(join(directory,"library")),project=await store.createProject({name:"Owned source"}),page=await store.createPage(project.id,{kind:"board"});
  const input=structuredClone(page.document);(input as any).futureRoot={nested:["é","é",null]};input.comments=[{id:"comment",text:"Keep original",createdAt:input.createdAt,resolved:false,futureComment:{keep:true}} as any];
  const saved=await store.savePage(project.id,input.id,input,page.hash,page.revision),reopened=await new FileStore(store.root).readPage(project.id,input.id);
  expect((reopened.document as any).futureRoot).toEqual((input as any).futureRoot);expect((reopened.document.comments![0] as any).futureComment).toEqual({keep:true});
  const left=structuredClone(saved.document),right=structuredClone(saved.document);left.title="Actual local title";(right as any).futureRemote={keep:"remote"};
  const merged=mergePageContent(saved.document,left,right);expect(merged.conflicts).toEqual([]);expect((merged.document as any).futureRoot).toEqual((input as any).futureRoot);expect((merged.document as any).futureRemote).toEqual({keep:"remote"});
  const committed=await store.savePage(project.id,input.id,merged.document,saved.hash,saved.revision),owner=new SourceRuntimeOwner();
  const seed=owner.execute({kind:"seed",scope:{homeId:store.root,projectId:project.id,pageId:input.id},document:saved.document,proof:"normalized",leaseId:"view"}) as SourceSnapshotDelta;
  const ack=owner.registerActualSavedSnapshot({scope:seed.next.scope,document:committed.document,base:seed.next,leaseId:"saved"});
  const resolved=owner.execute({kind:"resolve",ref:ack.next}) as {document:typeof input};expect(resolved.document).toEqual(committed.document);
  expect(resolved.document).not.toBe(committed.document);
 }finally{await rm(directory,{recursive:true,force:true})}
});
it("runs the actual source owner in a real Node worker with independently cloned messages",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"showai-source-worker-"));let worker:Worker|undefined;
 try{
  const entry=join(directory,"source-worker.cjs");await build({entryPoints:[resolve("src/core/source-runtime-node-worker.ts")],outfile:entry,bundle:true,platform:"node",format:"cjs",logLevel:"silent"});
  worker=new Worker(entry);let next=0;
  const request=(value:unknown)=>new Promise<any>((resolve,reject)=>{
   const id=String(++next),receive=(message:any)=>{if(message.id!==id)return;worker!.off("message",receive);if(message.ok)resolve(message.data);else reject(Object.assign(new Error(message.error.message),message.error))};
   worker!.on("message",receive);worker!.once("error",reject);worker!.postMessage({id,request:value});
  });
  const {blankDocument}=await import("./catalog"),{createResource}=await import("../surface/containers.mjs");
  const document=createResource(blankDocument(),"board"),scope={homeId:"node-worker-home",projectId:"node-worker-project",pageId:document.id};
  const seeded=await request({kind:"seed",scope,document,proof:"normalized",leaseId:"current"});
  const snapshot=await request({kind:"resolve",ref:seeded.next});snapshot.document.title="outside mutation";
  const again=await request({kind:"resolve",ref:seeded.next});expect(again.document.title).toBe(document.title);
  const draft=await request({kind:"draft",base:seeded.next,transactionId:"actual-worker-command",edits:[{op:"set",path:["title"],value:"Typed immediately"}],leaseId:"pending"});
  expect((await request({kind:"resolve",ref:draft.next})).document.title).toBe("Typed immediately");
  const fake:SourceSnapshotRef={...draft.next,scope:{...scope,projectId:"different"}};await expect(request({kind:"resolve",ref:fake})).rejects.toThrow(/scope/);
 }finally{await worker?.terminate();await rm(directory,{recursive:true,force:true})}
});
