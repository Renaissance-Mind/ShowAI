import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { coverageKernelProvenance, coverageKernelWasmBase64 } from '../coverage-kernel-wasm.mjs';
import { createHash } from 'node:crypto';

const directory=dirname(fileURLToPath(import.meta.url)),source=resolve(directory,'..');
test('actual 826-command pressure tail has a local RAY casting proof under the unchanged envelope',()=>{
 const fixture=JSON.parse(readFileSync(join(directory,'raw-ray-local-origin.fixture.json'),'utf8'));
 assert.equal(fixture.commands.length,826);
 const commands=Buffer.alloc(4+fixture.commands.length*56);commands.writeUInt32LE(fixture.commands.length);
 fixture.commands.forEach((command,index)=>{
  const at=4+index*56;commands.writeUInt32LE(['M','L','Q','C','Z'].indexOf(command[0]),at);
  command.slice(1).forEach((number,i)=>commands.writeDoubleLE(number,at+8+i*8));
 });
 assert.equal(createHash('sha256').update(commands).digest('hex'),'c18a713a6b3dc46469c73d46cdbc884a3a3d5d29a379ac921508464438da9a2d');
 for(const[name,sha]of Object.entries(coverageKernelProvenance.sourceHashes))assert.equal(createHash('sha256').update(readFileSync(join(source,name))).digest('hex'),sha);
 const temporary=mkdtempSync(join(tmpdir(),'showai-ray-origin-'));
 try {
  const input=join(temporary,'actual.commands'),output=join(temporary,'native.bin'),binary=join(temporary,'native');writeFileSync(input,commands);
  execFileSync(process.env.SHOWAI_INK_CLANG||'clang++',['-std=c++17','-O2','-ffp-contract=off','-fno-fast-math',join(directory,'raw-ray-local-origin-contract.cpp'),join(source,'coverage-kernel.cpp'),join(source,'analytic-path.cpp'),'-o',binary]);
  execFileSync(binary,[input,output]);const native=readFileSync(output);
  assert.equal(native.readUInt32LE(),0,'real Native source must not be rejected as error_budget');assert.equal(native.readUInt32LE(4),0);
  const module=new WebAssembly.Module(Buffer.from(coverageKernelWasmBase64,'base64'));assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const api=new WebAssembly.Instance(module,{}).exports,align=(n,a)=>(n+a-1)&~(a-1);
  const size=api.sa_coverage_state_bytes(),state=align(Number(api.__heap_base.value),16),arena=align(state+size+4096,16),limits=arena+8388608,at=limits+4096,receipt=align(at+commands.length+64,8),summary=align(receipt+32,8),vertices=summary+160,draws=vertices+1000000;
  api.memory.grow(Math.ceil(Math.max(0,draws+1000000-api.memory.buffer.byteLength)/65536));
  const bytes=new Uint8Array(api.memory.buffer),view=new DataView(api.memory.buffer);
  view.setBigUint64(limits,5000000n,true);view.setBigUint64(limits+8,100000000n,true);view.setUint32(limits+16,4194304,true);view.setUint32(limits+20,4194304,true);
  [256,256,.02].forEach((v,i)=>view.setFloat64(limits+24+i*8,v,true));[100000,100000,1000000,333333,16,0].forEach((v,i)=>view.setUint32(limits+48+i*4,v,true));
  assert.equal(api.sa_coverage_initialize(state,size,1,arena,8388608,limits),0);bytes.set(commands.subarray(4),at);
  assert.equal(api.sa_coverage_prepare(state,at,826,81n,receipt),0,'same original commands must pass actual WASM');assert.equal(api.sa_coverage_summary(state,receipt,summary),0);
  const vertexCount=view.getUint32(summary+24,true),drawCount=view.getUint32(summary+28,true);assert.equal(vertexCount,drawCount*3);
  assert.ok(vertexCount*32<=1000000&&drawCount*40<=1000000);
  assert.equal(api.sa_coverage_copy_vertices(state,receipt,vertices,vertexCount),0);assert.equal(api.sa_coverage_copy_draws(state,receipt,draws,drawCount),0);
  view.setBigUint64(summary,0n,true);
  const actual=Buffer.concat([Buffer.alloc(8),bytes.slice(summary,summary+160),bytes.slice(vertices,vertices+vertexCount*32),bytes.slice(draws,draws+drawCount*40)]);
  assert.deepEqual(actual,native,'all vertices, Float64 draw origins and certificate bytes match Native');
  const certificate=summary+88,forward=view.getFloat64(certificate,true),error=view.getFloat64(certificate+24,true)+view.getFloat64(certificate+32,true);
  assert.equal(forward,256);assert.equal(view.getFloat64(certificate+16,true),.02);assert.ok(forward*error<=.02);
  let localRay=0;
  for(let i=0;i<drawCount;i++){const p=draws+i*40;if(view.getUint32(p+24,true)!==751||view.getUint32(p+28,true)!==0)continue;
   const origin=view.getFloat64(p,true);if(origin===3036.8626496265006||origin===3403.181863072864){localRay++;assert.ok(view.getFloat64(p+32,true)<=.02);}
  }
  assert.equal(localRay,4,'actual source interval shares its binary64 local fan anchors');
  assert.equal(api.sa_coverage_destroy(state),0);
 } finally {rmSync(temporary,{recursive:true,force:true});}
});
