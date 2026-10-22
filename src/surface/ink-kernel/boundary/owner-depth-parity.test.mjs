import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.env.SHOWAI_BOUNDARY_TEST_OUTPUT;if(!root)throw Error('private test directory required');
const module=new WebAssembly.Module(await readFile(process.env.SHOWAI_BOUNDARY_WASM_FILE??join(root,'boundary-public.wasm')));assert.deepEqual(WebAssembly.Module.imports(module),[]);
const pieces=[];
for(const count of [49,65,129]){
 const ex=new WebAssembly.Instance(module,{}).exports;const base=(Number(ex.__heap_base.value)+15)&~15;
 const state=base,budget=base+4096,paths=base+4224,sources=base+8192,commands=base+24576,a=base+75000,next=a+32,empty=a+64,sentinel=a+96,report=a+128,area=a+256,box=a+288,mutation=a+336,edges=a+512,arena=base+131072;
 while(ex.memory.buffer.byteLength<arena+8*1024*1024)ex.memory.grow(64);
 const bytes=new Uint8Array(ex.memory.buffer),u=new Uint32Array(ex.memory.buffer),dv=new DataView(ex.memory.buffer);const clear=(p,n)=>bytes.fill(0,p,p+n);
 u.set([800,32,1000,2048,2048,4,160,160,64,16384],budget/4);dv.setBigUint64(budget+40,5000000n,true);dv.setBigUint64(budget+48,1000000000n,true);u.set([4*1024*1024,4*1024*1024],budget/4+14);
 assert.equal(ex.sa_boundary_initialize(state,ex.sa_boundary_state_bytes(),98,arena,8*1024*1024,budget),0);
 const rectangle=(start,x0,y0,x1,y1,reverse)=>{const points=reverse?[[x0,y0],[x0,y1],[x1,y1],[x1,y0]]:[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];for(let i=0;i<5;i++){const p=start+i*56;clear(p,56);u[p/4]=i===0?0:i===4?4:1;if(i<4){dv.setFloat64(p+8,points[i][0],true);dv.setFloat64(p+16,points[i][1],true);}}};
 for(let p=0;p<count;p++){u[paths/4+p*4]=p%2;u[paths/4+p*4+1]=p?1:0;const s=sources+p*80;u[s/4]=p+1;u[s/4+4]=p;u[s/4+5]=p*5;u[s/4+6]=5;dv.setFloat64(s+32,1,true);dv.setFloat64(s+56,1,true);rectangle(commands+p*280,0,0,4,4,p%2);}
 rectangle(commands+(count-1)*280,1,1,3,3,false);assert.equal(ex.sa_boundary_prepare(state,0,paths,count,sources,count,commands,count*5,a),0);
 new Float64Array(ex.memory.buffer,box,4).set([0,0,4,4]);const check=(lease,expected)=>{assert.equal(ex.sa_boundary_measure_coverage(state,lease,box,1,area,1),0);assert.deepEqual([...new Float64Array(ex.memory.buffer,area,2)],[expected,expected]);};check(a,0.25);
 assert.equal(ex.sa_boundary_snapshot(state,a,report),0);const before=bytes.slice(report,report+104);assert.equal(u[report/4+2],4);
 bytes.copyWithin(mutation+16,sources+(count-1)*80,sources+count*80);u[mutation/4+4+5]=0;rectangle(commands,2,1,3,3,false);assert.equal(ex.sa_boundary_update(state,a,mutation,1,commands,5,next),0);check(next,0.125);check(a,0.25);assert.equal(ex.sa_boundary_snapshot(state,next,report),0);const after=bytes.slice(report,report+104);
 clear(mutation,96);u[mutation/4]=1;u[mutation/4+4]=count;assert.equal(ex.sa_boundary_update(state,next,mutation,1,0,0,empty),0);check(empty,0);bytes.fill(0x5a,sentinel,sentinel+24);assert.equal(ex.sa_boundary_prepare(state,empty,paths,161,sources,count,commands,count*5,sentinel),1);assert.ok([...bytes.slice(sentinel,sentinel+24)].every(v=>v===0x5a));check(a,0.25);
 assert.equal(ex.sa_boundary_copy_edges(state,a,0,4,edges,4),0);const prefix=Buffer.alloc(4);prefix.writeUInt32LE(count);pieces.push(prefix,before,after,bytes.slice(edges,edges+4*160));
 assert.equal(ex.sa_boundary_release(state,a),0);assert.equal(ex.sa_boundary_release(state,next),0);assert.equal(ex.sa_boundary_release(state,empty),0);assert.equal(ex.sa_boundary_destroy(state),0);
}
const native=join(root,'owner-depth-native.bin');execFileSync(join(root,'owner-depth-contract'),[native],{stdio:'inherit'});assert.deepEqual(Buffer.concat(pieces),await readFile(native));const summary={actualNativeAndWasm:true,logicalPaths:[49,65,129],deepestClipApplied:true,oldLeaseUnchanged:true,removedClipMeansEmpty:true,wholeBudgetFailureAtomic:true,outputAndWorkAndPeakByteParity:true,imports:[]};await writeFile(join(root,'owner-depth-results.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
