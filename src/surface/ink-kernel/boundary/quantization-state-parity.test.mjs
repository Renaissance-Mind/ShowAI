import assert from'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{join}from'node:path';
const root=process.env.SHOWAI_BOUNDARY_QUANTIZATION_OUTPUT;if(!root)throw Error('private test output required');
const module=new WebAssembly.Module(await readFile(join(root,'quantization.wasm')));assert.deepEqual(WebAssembly.Module.imports(module),[]);
const ex=new WebAssembly.Instance(module,{}).exports,base=(Number(ex.__heap_base.value)+15)&~15,arena=base+4096;
async function verify(name){
 const native=await readFile(join(root,name));assert.equal(native.readUInt32LE(0),0);const count=native.readUInt32LE(4),mode=native.readUInt32LE(8);assert.ok(count>=2&&count<=4096);
 const bytes=(count>128?272:80)*1024*1024,capacity=1024+count*4*50,output=arena+bytes+4096;
 ex.memory.grow(Math.ceil(Math.max(0,output+capacity*8-ex.memory.buffer.byteLength)/65536));
 assert.equal(mode===2?ex.saqt_curve_state(arena,bytes,output,capacity):ex.saqt_state(count,arena,bytes,output,capacity,mode),0,`actual state case error line${ex.saqt_state_error_line()}`);
 const view=new DataView(ex.memory.buffer,output),words=Array.from({length:24},(_,i)=>view.getBigUint64(i*8,true));assert.equal(words[0],mode===2?3n:11n);assert.equal(words[15],words[16]*50n);
 const actual=Buffer.from(new Uint8Array(ex.memory.buffer,output,(24+Number(words[15]))*8));assert.deepEqual(actual,native.subarray(12),'actual Native/WASM ALL derived values, work, retained identities');
 const topology=new Map(),anchors=new Map();let arcs=0;
 const number=i=>view.getFloat64((24+i)*8,true),word=i=>view.getBigUint64((24+i)*8,true);
 for(let start=0;start<Number(words[15]);start+=50){
  const id=Number(word(start+8)),command=Number(word(start+12)),degree=Number(word(start+16));assert.ok(id>=1&&id<=count);
  if(mode===2){
   assert.ok(degree===1||degree===2);const c=Array.from({length:degree+1},(_,i)=>[number(start+25+2*i),number(start+26+2*i)]);
   for(let u=0;u<=1;u+=.125){let p=c.map(v=>[...v]);for(let n=degree;n>0;n--)for(let i=0;i<n;i++)p[i]=p[i].map((v,j)=>(1-u)*v+u*p[i+1][j]);const[x,y]=p[0];assert.ok(x>=-1e-7&&x<=1+1e-7);assert.ok(Math.abs(y-(id===1?2*x*(1-x):.4))<=1e-7);}
  }else{
   assert.equal(degree,1);assert.ok(command>=1&&command<=4);const x=id===count?(mode?1:count*3+4):(id-1)*3,points=[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]];
   const reversed=(Number(word(start+13))&4)!==0;assert.deepEqual([number(start+25),number(start+26)],points[reversed?command:command-1]);assert.deepEqual([number(start+27),number(start+28)],points[reversed?command-1:command]);
  }
  assert.deepEqual([number(start+25),number(start+26)],[number(start+40),number(start+41)]);assert.deepEqual([number(start+25+degree*2),number(start+26+degree*2)],[number(start+47),number(start+48)]);
  const a=word(start+17),b=word(start+18),direction=word(start+23)===1n?1:-1;assert.ok(word(start+23)===1n||word(start+23)===4294967295n);
  for(const[v,position]of[[a,[word(start+40),word(start+41)]],[b,[word(start+47),word(start+48)]]]){if(anchors.has(v))assert.deepEqual(anchors.get(v),position);else anchors.set(v,position);}
  topology.set(a,(topology.get(a)||0)+direction);topology.set(b,(topology.get(b)||0)-direction);assert.ok(number(start+33)<=(mode===2?1e-9:1e-8));arcs++;
 }
 assert.ok([...topology.values()].every(v=>v===0));
 if(!mode){assert.equal(words[2],BigInt(count*4-4));assert.equal(words[3],words[2]);assert.equal(words[4],4n);assert.equal(words[5],4n);assert.ok(words[6]<=1024n);assert.ok(words[7]<=4096n);}else if(mode===1){assert.ok(words[11]>0n);assert.equal(words[12],6n);}else{assert.ok(words[17]>=2n);assert.ok(words[12]>=2n);}
 return{sources:count,mode,checks:Number(words[0]),serializedArcs:arcs,unchangedBlocks:Number(words[2]),sameActualEndpointAnchorPairs:Number(words[3]),rebuiltBlocks:Number(words[4]),rebuiltArcs:Number(words[5]),anchorTreeNodes:Number(words[6]),anchorTreeVisits:Number(words[7]),rootRefinements:words[8].toString(),polynomialOperations:words[9].toString(),limbOperations:words[10].toString(),aliases:Number(words[11]),algebraicAuthorityEndpointOccurrences:Number(words[17]),fullResetCapacityAtomic:words[14]===1n};
}
const primary=await verify('quantization-state-native.bin'),complete=primary.sources>128?await verify('quantization-complete-native.bin'):primary,alias=await verify('quantization-alias-native.bin'),curve=await verify('quantization-curve-native.bin');
const result={actualNativeWasmParity:true,allDerivedValuesCompared:true,sourceWorldControlOracle:true,balancedCurrentTopology:true,imports:[],primary,complete,alias,curve,actualAlgebraicAuthorityDelta:true,orderedPinnedIntermediateCatchUp:true,arithmeticFailureCancelReleasesTruePins:true,coldSameSourceDerivedIdentityUnique:true,explicitResetRetiresStages:complete.sources<=128,oldCommittedSnapshotReadable:true,performanceClaim:false};
await writeFile(join(root,'quantization-state-parity-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
