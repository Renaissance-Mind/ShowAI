// Measure actual file/Git operations against an isolated copy of a content revision.
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
const root = resolve(import.meta.dirname, "..");
const source = process.argv[2];
if (!source) throw new Error("Pass the absolute source content library.");
const outputRoot = join(root, "output/performance");
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, "run-"));
const home = join(output, "library");
await mkdir(home);
const run = promisify(execFile);
await run("git", [
  "clone",
  "--mirror",
  join(source, "repository.git"),
  join(home, "repository.git"),
]);
await copyFile(join(source, "library.json"), join(home, "library.json"));
const worker = join(output, "measure.mjs");
await build({
  stdin: {
    sourcefile: "performance.ts",
    resolveDir: root,
    loader: "ts",
    contents: `
import {mkdir,writeFile} from 'node:fs/promises'; import {join,dirname} from 'node:path';
import {GitLibrary} from './src/core/git-library.ts'; import {FileStore} from './src/core/store.ts';
import {listComponents,resolveDocumentComponents} from './src/core/catalog.ts'; import {LibraryIndex} from './src/core/library-index.ts';
const home=process.argv[2],out=process.argv[3],library=new GitLibrary(home);
const head=await library.head(),paths=(await library.tree(head)).map(e=>e.path).filter(p=>!/\\/pages\\/[^/]+\\/nodes\\//.test(p));
const files=await library.readFiles(paths,head);
for(const [path,bytes] of files){const target=join(library.workspace,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
const store=new FileStore(home),results={revision:head,node:process.version,operations:{}};
async function measure(name,action){const times=[];let value;for(let i=0;i<4;i++){const at=performance.now();value=await action();times.push(Math.round((performance.now()-at)*100)/100);}results.operations[name]={firstMs:times[0],repeatedMs:times.slice(1)};await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log(name,JSON.stringify(results.operations[name]));return value;}
const projects=await measure('projects:list',()=>store.listProjects());
const allPages=await Promise.all(projects.map(async p=>({project:p.id,pages:await store.listPages(p.id)})));
const largest=allPages.flatMap(p=>p.pages.map(page=>({project:p.project,page}))).sort((a,b)=>b.page.blockCount-a.page.blockCount)[0];
if(largest){results.largestPage={blocks:largest.page.blockCount};await measure('pages:list',()=>store.listPages(largest.project));const record=await measure('pages:get',()=>store.readPage(largest.project,largest.page.id));await measure('page:components',()=>resolveDocumentComponents(home,record.document,largest.project));}
await measure('components:list-all',async()=>{const shared=await listComponents(home);const local=await Promise.all(projects.map(p=>listComponents(home,p.id,{scope:'project'})));return [...shared,...local.flat()];});
await measure('search',()=>new LibraryIndex(home).search({query:'AI'}));
results.completedAt=new Date().toISOString();await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
`,
  },
  outfile: worker,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  plugins: [rawSourcePlugin],
});
const result = await run(process.execPath, [worker, home, output], {
  cwd: root,
  maxBuffer: 1024 * 1024,
});
await writeFile(join(output, "run.log"), result.stdout + result.stderr);
console.log(result.stdout);
console.log(JSON.stringify({ output }));
