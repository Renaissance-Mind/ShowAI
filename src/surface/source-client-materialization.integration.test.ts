import {expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {Worker} from "node:worker_threads";
import {build} from "esbuild";
import {OwnedSourceSession,type SourceRuntimeTransport} from "./source-client";
import {createResource} from "./containers.mjs";
import {blankDocument} from "../core/catalog";
import {appendNewPortableInk} from "./portable-ink-append.mjs";
import {longCubicInputFixture} from "./cubic-ink-chunks.fixture.mjs";
import type {SourceRuntimeRequest,SourceRuntimeResponse,SourceSnapshotDelta} from "./source-runtime";
import type {ShowDocument} from "../types";

it("materializes an actual worker publication once while keeping stale, semantic-history and foreign-session boundaries",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"source-prepared-projection-"));let worker:Worker|undefined,session:OwnedSourceSession|undefined;
 try{
  const output=join(directory,"worker.cjs");await build({entryPoints:[resolve("src/core/source-runtime-node-worker.ts")],outfile:output,bundle:true,platform:"node",format:"cjs",logLevel:"silent"});worker=new Worker(output);
  let serial=0;
  const request=(request:SourceRuntimeRequest)=>new Promise<SourceRuntimeResponse>((accept,reject)=>{
   const id=String(++serial),receive=(message:{id:string;ok:boolean;data:SourceRuntimeResponse;error:{code:string;message:string}})=>{
    if(message.id!==id)return;worker!.off("message",receive);if(message.ok)accept(message.data);else reject(Object.assign(new Error(message.error.message),{code:message.error.code}));
   };worker!.on("message",receive);worker!.postMessage({id,request});
  });
  const raw=createResource(blankDocument(),"board") as ShowDocument,scope={homeId:directory,projectId:"actual-project",pageId:raw.id};
  let incoming:ShowDocument|undefined;
  const transport:SourceRuntimeTransport={sourceClientId:crypto.randomUUID(),scope:async()=>scope,request,
   publication:async args=>await request({kind:"publication",current:args.currentRef,publicationId:args.pubId,packet:{document:incoming!,baseDocument:args.authorDocument,pageId:raw.id,boardId:raw.content.attrs!.id}}) as SourceSnapshotDelta,
   close:async()=>{await worker!.terminate()}};
  session=new OwnedSourceSession(scope.projectId,raw.id,transport);const before=session.replace(raw);await session.barrier();
  const ink=longCubicInputFixture(321),boardId=before.content.attrs!.id as string;
  incoming=appendNewPortableInk(before,boardId,{type:"drawing",attrs:{id:"actual-cubic",tool:"pen",color:"#123456",strokeWidth:4,extent:ink.extent,points:[{x:0,y:100},{x:640,y:100}],ink}},{x:0,y:0,width:650,height:160});
  const prepared=await session.preparePublication({publicationScope:{projectId:scope.projectId,pageId:raw.id,boardId},pubId:"actual-one"});
  expect(session.document).toBe(before);
  const published=session.apply(prepared.sourceSnapshot)!;
  expect(published).toBe(prepared.document);
  expect(published.content.content![0].attrs!.ink.capture.raw).toBe(prepared.document.content.content![0].attrs!.ink.capture.raw);
  expect(()=>{published.content.content![0].attrs!.ink.capture.raw[0][0]=999}).toThrow();
  expect(session.apply(prepared.sourceSnapshot)).toBeNull();
  expect(()=>session!.apply({...prepared.sourceSnapshot})).toThrow(/actual owner transport/);
  await session.barrier();
  const actual=await request({kind:"resolve",ref:await session.reference(published)}) as {document:ShowDocument};expect(actual.document).toEqual(published);
  const oldTarget=prepared.document,local=session.replace({...published,title:"N+1 typed",futureRoot:{"é":1,"é":2}} as ShowDocument);
  expect(session.apply(prepared.sourceSnapshot)).toBeNull();expect(session.document).toBe(local);
  expect(session.apply(prepared.sourceSnapshot,{publish:false,baseDocument:before})).toBe(oldTarget);
  expect(session.document).toBe(local);await session.barrier();
  // One exact worker ref can back distinct semantic history roots. Its bytes
  // are not permission to reuse a projection built on another UI base object.
  const semantic=session.snapshot(before);await session.reference(semantic);
  const separate=session.apply(prepared.sourceSnapshot,{publish:false,baseDocument:semantic})!;
  expect(separate).not.toBe(oldTarget);expect(separate).toEqual(oldTarget);
  expect(session.document).toBe(local);
  const another=new OwnedSourceSession(scope.projectId,raw.id,{...transport,scope:async()=>({...scope,homeId:directory+"/another-owner"}),close:undefined});const other=another.replace(before);await another.barrier();
  expect(()=>session!.apply(prepared.sourceSnapshot,{publish:false,baseDocument:other})).toThrow(/exact registered|not owned/);
  // Same real Worker/source service, separate client ownership. Do not close
  // it through another's transport while the original session is active.
  await another.dispose();
 }finally{await session?.dispose().catch(()=>{});await worker?.terminate();await rm(directory,{recursive:true,force:true})}
});
