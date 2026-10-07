// Real Git transactions, content encoding, readers, package compilation and indexes.
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
const repository = resolve(import.meta.dirname, ".."),
  outputRoot = join(repository, "output", "storage-benchmarks");
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, "run-")),
  worker = join(output, "benchmark.mjs");
const resume = process.argv
  .find((value) => value.startsWith("--resume="))
  ?.slice(9);
const changes = Number(
  process.argv.find((value) => value.startsWith("--changes="))?.split("=")[1] ??
    10000,
);
if (!Number.isSafeInteger(changes) || changes < 1)
  throw new Error("--changes must be a positive integer");
const code = `
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {join} from 'node:path';
import {GitLibrary} from './src/core/git-library.ts';
import {FileStore} from './src/core/store.ts';
import {LibraryIndex} from './src/core/library-index.ts';
import {LibraryMaintenance} from './src/core/library-maintenance.ts';
import {saveComponent} from './src/core/catalog.ts';
import {withChangeContext} from './src/core/history-context.ts';
const output=process.argv[2],iterations=Number(process.argv[3]),results=process.argv[4]?JSON.parse(await readFile(join(process.argv[4],'results.json'),'utf8')):{startedAt:new Date().toISOString(),platform:process.platform,node:process.version,scenarios:[]};
const percentiles=(items)=>{const ordered=[...items].sort((a,b)=>a-b);return {medianMs:ordered[Math.floor(ordered.length*.5)],p95Ms:ordered[Math.floor(ordered.length*.95)],maxMs:ordered.at(-1)}};
async function run(name,steps,create,edit){
 if(results.scenarios.some(item=>item.name===name)){process.stdout.write(JSON.stringify({name,retainedCompletedScenario:true})+'\\n');return;}
 const home=join(output,name);await mkdir(home); const library=new GitLibrary(home);await library.initialize();const store=new FileStore(home),project=(await store.createProject({name})).id,maintenance=new LibraryMaintenance(home);
 let record=await create(store,project),initial=await maintenance.storage(); const latencies=[],start=performance.now();
 for(let i=0;i<steps;i++){const at=performance.now(); record=await withChangeContext({actor:{kind:'system',label:'storage-benchmark'},channel:'system',operationId:name+':'+i,message:'Benchmark edit '+i},()=>edit(store,project,record,i));latencies.push(performance.now()-at);if((i+1)%250===0){process.stdout.write(JSON.stringify({name,step:i+1,total:steps,elapsedSeconds:(performance.now()-start)/1000})+'\\n');await library.compact();}}
 const before=await maintenance.storage(),packAt=performance.now();await library.compact();const packMs=performance.now()-packAt,after=await maintenance.storage();
 const index=new LibraryIndex(home),indexAt=performance.now();await index.synchronize();const indexMs=performance.now()-indexAt;
 const readAt=performance.now();const history=await library.history({limit:1000});const historyMs=performance.now()-readAt;
 const searchAt=performance.now();await index.search({query:'benchmark',projectId:project});const searchMs=performance.now()-searchAt;
 await library.verify(); results.scenarios.push({name,iterations:steps,elapsedSeconds:(performance.now()-start)/1000,writeLatency:percentiles(latencies),initialBytes:initial.totalBytes,beforePackBytes:before.totalBytes,afterPackBytes:after.totalBytes,gitBefore:before.git,gitAfter:after.git,packMs,indexMs,historyMs,historyPageSize:history.length,searchMs,home});await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
}
await run('text-repeated',iterations,async(store,project)=>{let page=await store.createPage(project,{title:'Benchmark text'});const doc=structuredClone(page.document);doc.content.content=Array.from({length:100},(_,i)=>({type:'paragraph',attrs:{id:'paragraph-'+i},content:[{type:'text',text:'benchmark paragraph '+i+' '+('content '.repeat(40))}]}));doc.surfaceViews[doc.content.attrs.id].readingOrder=doc.content.content.map(node=>node.attrs.id);return store.savePage(project,page.document.id,doc,page.hash,page.revision)},(store,project,record,i)=>{const doc=structuredClone(record.document);doc.content.content[0].content[0].text='benchmark edit '+i;return store.savePage(project,doc.id,doc,record.hash,record.revision)});
await run('image-repeated',Math.min(iterations,1000),async(store,project)=>{let page=await store.createPage(project,{title:'Benchmark image'});const crc=(bytes)=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};const chunk=(type,data)=>{const name=Buffer.from(type),header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([header,name,data,tail]);};const width=512,height=512,raw=Buffer.alloc(height*(1+width*3));let seed=17;for(let y=0;y<height;y++)for(let x=0;x<width*3;x++){seed=(seed*1664525+1013904223)>>>0;raw[y*(1+width*3)+1+x]=seed>>>24;}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);const doc=structuredClone(page.document);doc.content.content.push({type:'image',attrs:{id:'image',src:'data:image/png;base64,'+png.toString('base64'),alt:'benchmark image'}});doc.surfaceViews[doc.content.attrs.id].readingOrder=doc.content.content.map(node=>node.attrs.id);return store.savePage(project,doc.id,doc,page.hash,page.revision)},(store,project,record,i)=>{const doc=structuredClone(record.document);doc.title='Benchmark image '+i;return store.savePage(project,doc.id,doc,record.hash,record.revision)});
await run('large-board',100,async(store,project)=>{const page=await store.createPage(project,{title:'Benchmark board',kind:'board'}),doc=structuredClone(page.document);doc.content.content=Array.from({length:2000},(_,i)=>({type:'paragraph',attrs:{id:'object-'+i},content:[{type:'text',text:'benchmark object '+i}]}));doc.layout=Object.fromEntries(doc.content.content.map((node,i)=>[node.attrs.id,{x:i%40*220,y:Math.floor(i/40)*100,width:200,height:80}]));doc.surfaceViews[doc.content.attrs.id].readingOrder=doc.content.content.map(node=>node.attrs.id);return store.savePage(project,doc.id,doc,page.hash,page.revision)},(store,project,record,i)=>{const doc=structuredClone(record.document);doc.layout['object-0'].x=i;return store.savePage(project,doc.id,doc,record.hash,record.revision)});
await run('component-source',100,async(store,project)=>({document:{id:'benchmark-component'},project}),(store,project,record,i)=>saveComponent(store.root,{manifest:{id:'benchmark-component',name:'Benchmark component',version:'1.0.'+i,description:'Measured source edits',scenarios:['benchmark'],entry:'Component.tsx',defaultData:{value:i},examples:[]},schema:{type:'object',properties:{value:{type:'number'}}},source:'export default function Widget({data}) { return <div>benchmark '+i+' {data.value}</div>; }'},project));
results.completedAt=new Date().toISOString();await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));process.stdout.write(JSON.stringify({complete:true,output,scenarios:results.scenarios.map(({name,iterations,writeLatency,afterPackBytes})=>({name,iterations,writeLatency,afterPackBytes}))})+'\\n');
`;
await build({
  stdin: {
    contents: code,
    resolveDir: repository,
    sourcefile: "benchmark.ts",
    loader: "ts",
  },
  outfile: worker,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  plugins: [rawSourcePlugin],
});
const child = spawn(
  process.execPath,
  [worker, output, String(changes), ...(resume ? [resolve(resume)] : [])],
  {
    cwd: repository,
    env: {
      ...process.env,
      SHOWAI_VIEWER: join(repository, "dist-portable", "portable.html"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
child.stdout.on("data", (data) => {
  log += data;
  process.stdout.write(data);
});
child.stderr.on("data", (data) => {
  log += data;
  process.stderr.write(data);
});
const exit = await new Promise((done, reject) => {
  child.once("error", reject);
  child.once("exit", done);
});
await writeFile(join(output, "run.log"), log);
console.log(JSON.stringify({ output, exit }));
process.exitCode = exit ?? 1;
