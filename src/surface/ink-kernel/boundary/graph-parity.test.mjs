import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fixtures} from './graph-fixtures-data.mjs';
const root=process.env.SHOWAI_BOUNDARY_TEST_OUTPUT;if(!root)throw Error('private test output directory required');
const bytes=await readFile(join(root,'boundary-test.wasm')),module=new WebAssembly.Module(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);
const {exports:ex}=new WebAssembly.Instance(module,{});const base=(Number(ex.__heap_base.value)+15)&~15,arena=base+262144,arenaBytes=64*1024*1024;
while(ex.memory.buffer.byteLength<arena+arenaBytes)ex.memory.grow(64);
const ranges=base,commands=base+1024,queries=base+131072,output=base+147456,metadata=base+180224;
const binary=[];const u32=x=>{const b=Buffer.alloc(4);b.writeUInt32LE(x);binary.push(b);};const f64=x=>{const b=Buffer.alloc(8);b.writeDoubleLE(x);binary.push(b);};
const numeric=x=>{if(typeof x==='number')return x;const [a,b='1']=x.split('/');return Number(a)/Number(b);};
u32(0x53414731);u32(fixtures.length);const expected=[];let pixels=0;
for(const fixture of fixtures){
 const name=Buffer.from(fixture.name);u32(name.length);binary.push(name);u32(fixture.paths.length);
 const dv=new DataView(ex.memory.buffer),u=new Uint32Array(ex.memory.buffer);let commandIndex=0;
 for(let path=0;path<fixture.paths.length;path++){
  const list=fixture.paths[path],fill=Number(fixture.rules[path]==='evenodd');u32(fill);u32(list.length);u.set([fill,list.length],ranges/4+path*2);
  for(const cmd of list){const operation={M:0,L:1,Q:2,C:3,Z:4}[cmd[0]],offset=commands+commandIndex*56;u32(operation);dv.setUint32(offset,operation,true);dv.setUint32(offset+4,0,true);
   for(let i=0;i<6;i++){const value=i+1<cmd.length?numeric(cmd[i+1]):0;f64(value);dv.setFloat64(offset+8+i*8,value,true);}commandIndex++;
  }
 }
 u32(fixture.pixels.length);for(let i=0;i<fixture.pixels.length;i++){const p=fixture.pixels[i],q=[p.x,p.y,p.x+1,p.y+1];for(let j=0;j<4;j++){f64(q[j]);dv.setFloat64(queries+i*32+j*8,q[j],true);}f64(Number(p.area));}
 u.fill(0x5a5a5a5a,output/4,output/4+4096);u.fill(0x5a5a5a5a,metadata/4,metadata/4+8);
 const status=ex.sabt_graph(ranges,fixture.paths.length,commands,commandIndex,queries,fixture.pixels.length,arena,arenaBytes,10000000000n,output,4096,metadata),meta=[...u.slice(metadata/4,metadata/4+8)];
 assert.equal(status,0,`graph fixture ${fixture.name} status${status}`);assert.equal(meta[1],fixture.pixels.length);assert.equal(meta[2],81);
 const result=[...u.slice(output/4,output/4+meta[0])];for(let i=0;i<fixture.pixels.length;i++){
  const lo=dv.getFloat64(output+8+i*16,true),hi=dv.getFloat64(output+16+i*16,true),area=Number(fixture.pixels[i].area);
  assert.ok(lo<=area+1e-12&&hi>=area-1e-12&&hi-lo<=1e-12,`${fixture.name} pixel${i}: ${lo}..${hi} expected${area}`);pixels++;
 }
 const normalized=result.slice(2+fixture.pixels.length*4,2+fixture.pixels.length*4+81);assert.ok(normalized.every(v=>v===0||v===1));expected.push({status,meta,result});
 console.log(JSON.stringify({fixture:fixture.name,curves:result[0],edges:result[1],pixels:fixture.pixels.length,normalizedQueries:normalized.length}));
}
await writeFile(join(root,'graph-fixtures.bin'),Buffer.concat(binary));execFileSync(join(root,'graph-parity'),[join(root,'graph-fixtures.bin'),join(root,'graph-native-parity.bin')],{stdio:'inherit'});
const native=await readFile(join(root,'graph-native-parity.bin'));let offset=0;const take=()=>{const v=native.readUInt32LE(offset);offset+=4;return v;};assert.equal(take(),fixtures.length);
for(let i=0;i<fixtures.length;i++){const status=take(),meta=Array.from({length:8},take),n=take(),result=Array.from({length:n},take);assert.deepEqual({status,meta,result},expected[i],`Native/Wasm graph exact parity ${fixtures[i].name}`);}assert.equal(offset,native.length);
const report={fixtures:fixtures.length,pixels,memberships:fixtures.length*81,actualNativeWasmExactParity:true,referenceTolerance:1e-12,source:'original Bezier controls; binary64 C ABI capture',imports:[]};await writeFile(join(root,'graph-parity-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
