import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.env.SHOWAI_BOUNDARY_TEST_OUTPUT;if(!root)throw Error('private test output directory required');
const module=new WebAssembly.Module(await readFile(join(root,'boundary-test.wasm')));assert.deepEqual(WebAssembly.Module.imports(module),[]);const{exports:ex}=new WebAssembly.Instance(module,{});
const base=(Number(ex.__heap_base.value)+15)&~15,state=base,source=base+8192,path=base+8304,commands=base+8416,budget=base+9008,a=base+9104,b=base+9120,reportA=base+9200,reportB=base+9328,oldEdges=base+9472,nextEdges=base+10112,required=base+10752,parameter=base+10800,failedLease=base+15000,arena=base+65536,arenaBytes=2*1024*1024;
while(ex.memory.buffer.byteLength<arena+arenaBytes)ex.memory.grow(64);const u=new Uint32Array(ex.memory.buffer),dv=new DataView(ex.memory.buffer);const size=ex.sa_boundary_state_bytes();u.fill(0,state/4,(state+size)/4);u.fill(0,budget/4,budget/4+16);u.set([100,4,100,100,100,3,10,8,64,16384],budget/4);dv.setBigUint64(budget+40,5000000n,true);dv.setBigUint64(budget+48,1000000000n,true);u.set([1048576,1048576],budget/4+14);
assert.equal(ex.sa_boundary_snapshot.length,3);assert.equal(ex.sa_boundary_copy_edges.length,6);assert.equal(ex.sa_boundary_release.length,2);
assert.equal(ex.sa_boundary_initialize(state,size,19,arena,arenaBytes,budget),0);u.fill(0,source/4,source/4+20);u[source/4]=1;u[source/4+6]=5;dv.setFloat64(source+32,1,true);dv.setFloat64(source+56,1,true);u.fill(0,path/4,path/4+4);
const setCommands=list=>{for(let i=0;i<list.length;i++){const p=commands+i*56;u.fill(0,p/4,p/4+14);u[p/4]=list[i][0];for(let j=1;j<list[i].length;j++)dv.setFloat64(p+8+(j-1)*8,list[i][j],true);}};
setCommands([[0,0,0],[1,1,0],[1,1,1],[1,0,1],[4]]);
assert.equal(ex.sa_boundary_prepare(state,0,path,1,source,1,commands,5,a),0);const leaseA=()=>[...u.slice(a/4,a/4+4)],leaseB=()=>[...u.slice(b/4,b/4+4)];assert.equal(ex.sa_boundary_snapshot(state,a,reportA),0);
assert.equal(ex.sa_boundary_prepare(state,a,path,1,source,1,commands,5,b),0);assert.deepEqual(leaseA(),leaseB());assert.equal(ex.sa_boundary_release(state,b),0);
dv.setFloat64(commands+56+8,2,true);dv.setFloat64(commands+112+8,2,true);assert.equal(ex.sa_boundary_prepare(state,a,path,1,source,1,commands,5,b),0);assert.equal(ex.sa_boundary_snapshot(state,b,reportB),0);assert.notDeepEqual(leaseA(),leaseB());
assert.equal(ex.sa_boundary_copy_edges(state,a,0,4,oldEdges,4),0);assert.equal(ex.sa_boundary_copy_edges(state,b,0,4,nextEdges,4),0);
// The actual clang/Wasm C ABI passes by-value aggregate arguments indirectly.
// These buffers are ordinary public SABoundaryLease values; no owner internals
// or writable arena views are used by the test.
const cert=u[(nextEdges+144)/4];assert.equal(ex.sa_boundary_copy_parameter(state,b,cert,0,0,required),0);const words=u[required/4];assert.ok(words>4);assert.equal(ex.sa_boundary_copy_parameter(state,b,cert,parameter,words,required),0);
// Same key, new bytes, late base, live old lease and failure are real owner paths.
dv.setFloat64(commands+56+8,99,true);u.set([12,34,56,78],failedLease/4);assert.equal(ex.sa_boundary_prepare(state,a,path,1,source,1,commands,5,failedLease),1);assert.deepEqual([...u.slice(failedLease/4,failedLease/4+4)],[12,34,56,78]);
setCommands([[0,0,0],[1,2,0],[1,3,1],[1,1,3],[1,-1,1],[4]]);u[source/4+6]=6;assert.equal(ex.sa_boundary_prepare(state,b,path,1,source,1,commands,6,failedLease),2);assert.deepEqual([...u.slice(failedLease/4,failedLease/4+4)],[12,34,56,78]);
const snapshot=Buffer.concat([Buffer.from(new Uint32Array([0x53414f31,160,104]).buffer),Buffer.from(ex.memory.buffer.slice(a,a+16)),Buffer.from(ex.memory.buffer.slice(b,b+16)),Buffer.from(ex.memory.buffer.slice(reportA,reportA+104)),Buffer.from(ex.memory.buffer.slice(reportB,reportB+104)),Buffer.from(ex.memory.buffer.slice(oldEdges,oldEdges+640)),Buffer.from(ex.memory.buffer.slice(nextEdges,nextEdges+640)),Buffer.from(ex.memory.buffer.slice(required,required+4)),Buffer.from(ex.memory.buffer.slice(parameter,parameter+words*4))]);
execFileSync(join(root,'owner-contract'),[join(root,'owner-native-parity.bin')],{stdio:'inherit'});assert.deepEqual(await readFile(join(root,'owner-native-parity.bin')),snapshot,'actual native/Wasm public owner outputs/certificates/work/budgets differ');
assert.equal(ex.sa_boundary_destroy(state),1);assert.equal(ex.sa_boundary_release(state,a),0);assert.equal(ex.sa_boundary_snapshot(state,a,reportA),1);assert.equal(ex.sa_boundary_release(state,b),0);assert.equal(ex.sa_boundary_destroy(state),0);assert.ok([...u.slice(state/4,(state+size)/4)].every(v=>!v));
const report={actualNativeWasmPublicOwnerParity:true,immutableSourceAndInflightLeases:true,atomicFailureAndRetry:true,originalBezierCertificates:true,imports:[]};await writeFile(join(root,'owner-parity-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
