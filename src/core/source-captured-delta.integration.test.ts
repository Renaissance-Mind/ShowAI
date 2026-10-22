import {expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileStore} from "./store";
import {appendNewPortableInk} from "../surface/portable-ink-append.mjs";
import {longCubicInputFixture} from "../surface/cubic-ink-chunks.fixture.mjs";
import {SourceRuntimeOwner,type SourceSnapshotDelta} from "../surface/source-runtime";
it("keeps actual FileStore v2 source/capture and concurrent root metadata through JSON saved ACK and cold reopen",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"showai-captured-source-"));
 try{
  const store=new FileStore(join(directory,"library")),project=await store.createProject({name:"Captured source"}),page=await store.createPage(project.id,{kind:"board"}),boardId=page.document.content.attrs!.id as string,ink=longCubicInputFixture(321);
  const input=appendNewPortableInk(page.document,boardId,{type:"drawing",attrs:{id:"actual-cubic",tool:"pen",color:"#111111",strokeWidth:4,extent:ink.extent,points:[{x:0,y:100},{x:640,y:100}],ink}},{x:4,y:5,width:650,height:160});
  (input as any).futureRoot={"é":"NFC","é":"NFD"};
  const first=await store.savePage(project.id,page.document.id,input,page.hash,page.revision),owner=new SourceRuntimeOwner(),scope={homeId:store.root,projectId:project.id,pageId:page.document.id};
  const seed=owner.execute({kind:"seed",scope,document:first.document,proof:"normalized",leaseId:"seed"}) as SourceSnapshotDelta;
  const before=(owner.execute({kind:"resolve",ref:seed.next}) as any).document;
  const next=structuredClone(first.document);next.title="Actually committed foreign title";next.content.content![0].attrs!.color="#ff0000";
  const saved=await store.savePage(project.id,page.document.id,next,first.hash,first.revision),ack=owner.registerActualSavedJSON(JSON.stringify({scope,base:seed.next,document:saved.document,leaseId:"ack"}),seed.next);
  const actual=(owner.execute({kind:"resolve",ref:ack.next}) as any).document,reopened=await new FileStore(store.root).readPage(project.id,page.document.id);
  expect(actual).toEqual(reopened.document);expect(actual.content.content[0].attrs.ink.capture.raw).toBe(before.content.content[0].attrs.ink.capture.raw);
  expect(actual.content.content[0].attrs.color).toBe("#ff0000");expect(actual.title).toBe(next.title);expect(actual.futureRoot).toEqual((input as any).futureRoot);
  await expect(store.savePage(project.id,page.document.id,input,first.hash,first.revision)).rejects.toMatchObject({code:"CONFLICT"});
  expect((await new FileStore(store.root).readPage(project.id,page.document.id)).document).toEqual(actual);
 }finally{await rm(directory,{recursive:true,force:true})}
});
