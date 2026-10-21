import {expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {startBrowserServer} from "../browser/server";
import type {LoadedPage} from "../studio/page-session";
import InkConflictInspector,{acceptPreparedInkResolution} from "./InkConflictInspector";
import {addNode} from "./editing";
import {createPortableInk} from "./portable-ink.mjs";
import {inkWireConflicts,inkWireResolutionCandidates,stampInkDocument} from "./ink-wire.mjs";
import {mergePageContent} from "../core/page-merge-model";
import type {ShowDocument} from "../types";

it("renders ordinary inline choices then resolves through the real workbench route and CAS writer",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"showai-inline-ink-conflict-"));
 const server=await startBrowserServer({home:join(directory,"library"),webRoot:resolve("dist-runtime/web"),cliEntry:resolve("dist-runtime/scripts/cli.mjs"),settingsPath:join(directory,"profile","settings.json")});
 try{
  const html=await(await fetch(server.url)).text(),token=JSON.parse(html.match(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/)![1]).token;
  const invoke=async<T>(action:string,args:Record<string,unknown>={}):Promise<T>=>{
   const response=await fetch(server.url+"api/invoke",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({action,args})});
   const result=await response.json();if(!result.ok)throw result.error;return result.data;
  };
  const project=await invoke<{id:string}>("projects:create",{name:"Inline retained conflict"});
  const page=await invoke<LoadedPage>("pages:create",{projectId:project.id,kind:"board"});
  const content=addNode(page.document,{type:"drawing",attrs:{id:"stroke",tool:"pen",color:"#111111",strokeWidth:2,extent:[40,30],points:[{x:1,y:2},{x:20,y:12}],ink:createPortableInk([{x:1,y:2},{x:20,y:12}],2,[40,30])}},
   {x:10,y:20,width:40,height:30},page.document.content.attrs!.id);
  const base=await invoke<LoadedPage>("pages:save",{projectId:project.id,pageId:page.document.id,document:content,baseHash:page.hash,baseRevision:page.revision});
  const left=structuredClone(base.document),right=structuredClone(base.document);
  left.content.content![0].attrs!.color="#ff0000";right.content.content![0].attrs!.color="#0000ff";
  const conflict=mergePageContent(base.document,stampInkDocument(left,base.document,{actor:"left",sequence:1}),stampInkDocument(right,base.document,{actor:"right",sequence:1}));
  const current=await invoke<LoadedPage>("pages:save",{projectId:project.id,pageId:page.document.id,document:conflict.document,baseHash:base.hash,baseRevision:base.revision});
  const render=(document:ShowDocument)=>renderToStaticMarkup(createElement(InkConflictInspector,{document,projectId:project.id,getDocument:()=>document,onResolve:()=>{}}));
  const inline=render(current.document);expect(inline).toContain("surface-inspector ink-conflict-inspector");expect(inline).toContain("#ff0000");expect(inline).toContain("#0000ff");
  const group=inkWireResolutionCandidates(current.document)[0],chosen=group.candidates.find(candidate=>candidate.value==="#0000ff")!;
  const prepare=()=>invoke<{baseline:ShowDocument;document:ShowDocument}>("pages:prepareInkResolution",{projectId:project.id,pageId:page.document.id,choices:[{boardId:group.boardId,strokeId:group.strokeId,field:group.field,hash:chosen.hash}]});
  for(const change of [
   (draft:ShowDocument)=>{draft.title="New title during real preparation"},
   (draft:ShowDocument)=>{draft.comments=[{id:"during-prepare",text:"New comment",createdAt:draft.createdAt,resolved:false}]},
   (draft:ShowDocument)=>{draft.createdAt="2026-01-01T00:00:00Z"},
   (draft:ShowDocument)=>{(draft as any).futureMetadata={mustKeep:["unknown",null]}},
  ]){
   const draft=structuredClone(current.document),pending=prepare();let applied=false;
   change(draft);const edited=structuredClone(draft);
   await expect(acceptPreparedInkResolution(pending,()=>draft,()=>{applied=true},"Actual preparation became stale")).rejects.toThrow("Actual preparation became stale");
   expect(applied).toBe(false);expect(draft).toEqual(edited);
  }
  const acknowledged=structuredClone(current.document),pendingTimestamp=prepare();let accepted:ShowDocument|undefined;
  acknowledged.updatedAt="2026-10-21T20:50:00Z";
  await acceptPreparedInkResolution(pendingTimestamp,()=>acknowledged,next=>{accepted=next},"Must permit storage timestamp only");
  expect(accepted?.content.content![0].attrs!.color).toBe("#0000ff");
  let preparedDocument:ShowDocument|undefined;
  const prepared=await prepare();
  await acceptPreparedInkResolution(Promise.resolve(prepared),()=>current.document,next=>{preparedDocument=next},"Normal source must match");
  expect(preparedDocument).toBe(prepared.document);
  expect(prepared.baseline).toEqual(current.document);
  const head=prepared.document.content.attrs!.inkState.strokes.stroke.fields.color;
  expect(head).toHaveLength(1);expect(head[0][0]).toMatch(/^wire-device-/);
  const saved=await invoke<LoadedPage>("pages:save",{projectId:project.id,pageId:page.document.id,document:prepared.document,baseHash:current.hash,baseRevision:current.revision});
  expect(saved.document.content.content![0].attrs!.color).toBe("#0000ff");expect(inkWireConflicts(saved.document)).toEqual([]);expect(render(saved.document)).toBe("");
  await expect(invoke("pages:save",{projectId:project.id,pageId:page.document.id,document:prepared.document,baseHash:current.hash,baseRevision:current.revision})).rejects.toMatchObject({code:"CONFLICT"});
  const reopened=await invoke<LoadedPage>("pages:get",{projectId:project.id,pageId:page.document.id});
  expect(reopened.hash).toBe(saved.hash);expect(reopened.document.content.attrs!.inkState).toEqual(saved.document.content.attrs!.inkState);
 }finally{await server.close();await rm(directory,{recursive:true,force:true})}
});
