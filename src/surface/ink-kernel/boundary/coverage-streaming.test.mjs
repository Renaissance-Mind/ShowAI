import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const url=process.env.SHOWAI_COVERAGE_MODULE?pathToFileURL(resolve(process.env.SHOWAI_COVERAGE_MODULE)):new URL('../coverage-kernel-wasm.mjs',import.meta.url);
const {coverageKernelWasmBase64}=await import(url.href);
const module=new WebAssembly.Module(Buffer.from(coverageKernelWasmBase64,'base64'));
assert.deepEqual(WebAssembly.Module.imports(module),[]);
const ex=new WebAssembly.Instance(module,{}).exports,align=n=>(n+65535)&~65535;
const state=align(Number(ex.__heap_base.value)),arena=align(state+ex.sa_coverage_state_bytes()),commands=arena+8388608+65536,limits=commands+1048576,receipt=limits+128,summary=receipt+32,diagnostics=summary+160;
ex.memory.grow(Math.ceil(Math.max(0,diagnostics+128-ex.memory.buffer.byteLength)/65536));
const view=new DataView(ex.memory.buffer),bytes=new Uint8Array(ex.memory.buffer);
let count=0;
function command(operation,values=[]){const at=commands+count++*56;view.setUint32(at,operation,true);values.forEach((value,i)=>view.setFloat64(at+8+i*8,value,true));}
// Genuine closed cubic geometry: its detached output fits the original budget.
// Scratch must follow bounded subpaths rather than every patch in the input.
for(let i=0;i<2000;i++){
 const x=(i%40)*6,y=Math.floor(i/40)*6,r=2,k=r*0.5522847498307936;
 command(0,[x+r,y]);command(3,[x+r,y+k,x+k,y+r,x,y+r]);
 command(3,[x-k,y+r,x-r,y+k,x-r,y]);command(3,[x-r,y-k,x-k,y-r,x,y-r]);
 command(3,[x+k,y-r,x+r,y-k,x+r,y]);command(4);
}
view.setBigUint64(limits,5000000n,true);view.setBigUint64(limits+8,100000000n,true);
view.setUint32(limits+16,4194304,true);view.setUint32(limits+20,4194304,true);
[256,256,.02].forEach((n,i)=>view.setFloat64(limits+24+i*8,n,true));
[100000,100000,1000000,333333,16,0].forEach((n,i)=>view.setUint32(limits+48+i*4,n,true));
assert.equal(ex.sa_coverage_initialize(state,ex.sa_coverage_state_bytes(),1,arena,8388608,limits),0);
assert.equal(ex.sa_coverage_prepare(state,commands,count,1n,receipt),0,'Closed geometry must fit without enlarging retained, scratch or backing budgets');
assert.equal(ex.sa_coverage_summary(state,receipt,summary),0);assert.ok(view.getUint32(summary+24,true)>10000);
assert.equal(ex.sa_coverage_diagnostics(state,diagnostics),0);
const live=Number(view.getBigUint64(diagnostics+24,true)),peak=Number(view.getBigUint64(diagnostics+32,true));
assert.ok(live<=4194304&&peak-live<=4194304);assert.equal(ex.sa_coverage_destroy(state),0);
console.log(JSON.stringify({commands:count,vertices:view.getUint32(summary+24,true),live,peak,backingBudget:8388608,retainedBudget:4194304,workspaceBudget:4194304}));
