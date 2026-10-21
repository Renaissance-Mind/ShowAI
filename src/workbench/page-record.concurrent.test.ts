import {expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {startBrowserServer} from "../browser/server";
import type {LoadedPage} from "../studio/page-session";

it("reads one complete page snapshot while current-only saves replace its revision",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"showai-page-record-concurrent-"));
 let server:Awaited<ReturnType<typeof startBrowserServer>>|undefined;
 try{
  server=await startBrowserServer({home:join(directory,"home"),webRoot:resolve("dist-runtime/web"),cliEntry:resolve("dist-runtime/scripts/cli.mjs"),settingsPath:join(directory,"profile/settings.json")});
  const html=await(await fetch(server.url)).text(),token=JSON.parse(html.match(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/)![1]).token;
  const invoke=async<T>(action:string,args:Record<string,unknown>={}):Promise<T>=>{
   const response=await fetch(server!.url+"api/invoke",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({action,args})}),result=await response.json();
   if(!result.ok)throw Object.assign(new Error(`${action}: ${result.error.message}`),result.error);return result.data;
  };
  const project=await invoke<{id:string}>("projects:create",{name:"Concurrent page snapshot"});
  let record=await invoke<LoadedPage>("pages:create",{projectId:project.id,title:"Version 0",kind:"board"});const pageId=record.document.id;
  let writing=true;
  const writer=(async()=>{try{for(let index=1;index<=24;index++)record=await invoke<LoadedPage>("pages:save",{projectId:project.id,pageId,document:{...record.document,title:`Version ${index}`},baseHash:record.hash,baseRevision:record.revision});}finally{writing=false}})();
  const reader=async()=>{let count=0;while(writing||count<32){const current=await invoke<LoadedPage>("pages:get",{projectId:project.id,pageId});expect(current.document.title).toMatch(/^Version \d+$/);expect(typeof current.revision).toBe("string");expect(current.incomingCrossDevice).toBe(false);count++;}};
  const results=await Promise.allSettled([writer,reader(),reader()]);for(const result of results)if(result.status==="rejected")throw result.reason;
  expect((await invoke<LoadedPage>("pages:get",{projectId:project.id,pageId})).document.title).toBe("Version 24");
 }finally{await server?.close();await rm(directory,{recursive:true,force:true})}
},60000);
