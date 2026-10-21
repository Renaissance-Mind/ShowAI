import {expect,it} from 'vitest';
import {performance} from 'node:perf_hooks';
import {blankDocument} from '../core/catalog';
import {normalizeDocument} from '../core/diff';
import {createResource} from './containers.mjs';
import {addNode} from './editing';
import {createPortableInk} from './portable-ink.mjs';
import {InkOperationReplica,canonicalInkJSON,createInkOperation,validateInkCheckpoint,type InkOperationChange} from './ink-operations.mjs';
import {inkCheckpointFromDocument,inkWireDocumentFromCheckpoint,inkWireDeltaFromReplica,stampInkDocument,validateInkWireState,type InkWireState} from './ink-wire.mjs';
import type {ShowDocument} from '../types';
const frame={x:10,y:20,width:40,height:30};
const node=(id:string,n=2)=>({type:'drawing',attrs:{id,tool:'pen',color:'#111111',strokeWidth:2,extent:[40,30],points:[{x:0,y:0},{x:1,y:1}],ink:createPortableInk(Array.from({length:n},(_,i)=>({x:i%40,y:i%30,pressure:.5})),2,[40,30])}});
function source(){let doc=createResource(blankDocument(),'board') as ShowDocument;doc=addNode(doc,node('old'),frame,doc.content.attrs!.id) as ShowDocument;doc=addNode(doc,node('other'),{...frame,x:100},doc.content.attrs!.id) as ShowDocument;return stampInkDocument(doc,undefined,{actor:'seed',sequence:1});}
function begin(){const document=source(),boardId=document.content.attrs!.id as string;return{document,boardId,replica:new InkOperationReplica({checkpoint:inkCheckpointFromDocument(document,boardId)})};}
function append(replica:InkOperationReplica,actor:string,changes:InkOperationChange[],parents=replica.materialize([]).frontier){const sequence=replica.actorSequence(actor)+1;if(sequence>1&&!parents.includes(`${actor}:${sequence-1}`))parents.push(`${actor}:${sequence-1}`);const operation=createInkOperation({pageId:replica.materialize([]).pageId,boardId:replica.materialize([]).boardId,actor,sequence,parents,changes});replica.append([operation]);return operation;}
function find(document:ShowDocument,id:string){const walk=(n:ShowDocument['content']):ShowDocument['content']|undefined=>n.attrs?.id===id?n:n.content?.map(walk).find(Boolean);return walk(document.content);}
function parity(document:ShowDocument,boardId:string,replica:InkOperationReplica,ids:string[],placements?:Parameters<typeof inkWireDeltaFromReplica>[2]){
 const checkpoint=replica.checkpoint(),full=inkWireDocumentFromCheckpoint(document,boardId,checkpoint),delta=inkWireDeltaFromReplica(replica,ids,placements),state=find(full,boardId)!.attrs!.inkState as InkWireState;
 validateInkWireState(delta.state);normalizeDocument(full);
 expect(delta.state.clock).toEqual(state.clock);expect(delta.state.level).toBe(state.level);
 expect(Object.keys(delta.state.strokes).sort()).toEqual([...new Set(ids)].sort());
 for(const id of ids)expect(delta.state.strokes[id]).toEqual(state.strokes[id]);
 for(const name of ['contexts','levels','digests','eventDigests'] as const)for(const [dot,value]of Object.entries(delta.state[name]??{}))expect(state[name]?.[dot]).toEqual(value);
 for(const current of delta.visible){expect(current.node).toEqual(find(full,current.id));expect(current.layout).toEqual(full.layout![current.id]);expect(current.born).toEqual(state.strokes[current.id].born);}
 for(const id of delta.deleted)expect(find(full,id)).toBeUndefined();
 return{delta,full};
}
it('projects only touched exact editable source, fragments and late force corrections',()=>{
 const {document,boardId,replica}=begin();
 append(replica,'ipad',[{kind:'edit',strokeId:'old',patch:{ink:createPortableInk([{x:1,y:2,pressure:.9},{x:30,y:4,pressure:.7}],2,[40,30]),inkFragments:[createPortableInk([{x:4,y:4},{x:5,y:6}],2,[40,30])]}}]);
 const {delta}=parity(document,boardId,replica,['old','old']);
 expect(delta.ids).toEqual(['old']);expect(delta.visible[0].node.attrs!.inkFragments).toHaveLength(1);expect(delta.state.strokes.other).toBeUndefined();
});
it('preserves foreign same-field heads, precise variants and concurrent delete/edit conflicts',()=>{
 const {document,boardId,replica}=begin();
 append(replica,'ipad',[{kind:'edit',strokeId:'old',patch:{color:'#ff0000'}}],['seed:1']);
 append(replica,'web',[{kind:'edit',strokeId:'old',patch:{color:'#0000ff'}}],['seed:1']);
 let result=parity(document,boardId,replica,['old']);expect(result.delta.state.strokes.old.variants!.color).toBeDefined();
 append(replica,'eraser',[{kind:'delete',strokeId:'old'}],['seed:1']);
 result=parity(document,boardId,replica,['old']);expect(result.delta.visible).toEqual([]);expect(result.delta.deleted).toEqual(['old']);expect(result.delta.conflicts.some(c=>c.field==='delete/color')).toBe(true);
});
it('compacts a delete, restores the original source, and retains global metadata after sparse imports',()=>{
 const {document,boardId,replica}=begin();append(replica,'ipad',[{kind:'delete',strokeId:'old'}]);
 const deleted=parity(document,boardId,replica,['old']);expect(Object.keys(deleted.delta.state.strokes.old.fields)).toEqual(['alive']);
 append(replica,'ipad',[{kind:'restore',strokeId:'old'}]);parity(document,boardId,replica,['old']);
 const peer=new InkOperationReplica({checkpoint:inkCheckpointFromDocument(document,boardId)});append(peer,'remote',[{kind:'edit',strokeId:'other',patch:{strokeWidth:9}}]);
 const prepared=replica.prepareImport(peer.checkpoint());replica.commit(prepared.token);
 const delta=parity(document,boardId,replica,['old']).delta;
 expect(delta.state.clock.remote).toBe(1);expect(Object.keys(delta.state.contexts)).not.toContain('remote:1');
 expect(inkWireDeltaFromReplica(replica,[]).state).toMatchObject({clock:delta.state.clock,level:delta.state.level,strokes:{},contexts:{}});
});
it('retains original group, generic anchors and birth ordering for delayed placements',()=>{
 const {document,boardId,replica}=begin();
 const group={type:'region',attrs:{id:'group',title:'Group'},content:[{type:'paragraph',attrs:{id:'before'},content:[{type:'text',text:'before'}]},{type:'paragraph',attrs:{id:'after'},content:[{type:'text',text:'after'}]}]};
 document.content.content!.push(group);document.layout!.group={...frame,width:300,height:200};
 const placement={parentId:'group',after:'before',before:'after'};
 append(replica,'late',[{kind:'create',strokeId:'late',node:node('late'),layout:frame,placement}],['seed:1']);
 append(replica,'newer',[{kind:'create',strokeId:'newer',node:node('newer'),layout:frame,placement}]);
 const delta=parity(document,boardId,replica,['newer','late']).delta;
 expect(delta.visible.map(s=>s.id)).toEqual(['late','newer']);expect(delta.visible[0].placement).toEqual(placement);
 expect(replica.projectionIndex().filter(s=>['late','newer'].includes(s.id))).toEqual(delta.visible.map(({id,born,placement})=>({id,born,placement})));
});
it('requires actual canonical placement for old raw creates and exposes malformed/missing context',()=>{
 const {document,boardId,replica}=begin();append(replica,'oldClient',[{kind:'create',strokeId:'legacy',node:node('legacy'),layout:frame}]);
 expect(()=>inkWireDeltaFromReplica(replica,['legacy'])).toThrow('missing canonical placement');
 const placement={parentId:boardId,after:null,before:null};parity(document,boardId,replica,['legacy'],{placements:{legacy:placement}});
 expect(()=>inkWireDeltaFromReplica(replica,['unavailable'])).toThrow('unavailable');
 expect(()=>inkWireDeltaFromReplica(replica,['legacy'],{placements:{legacy:{parentId:'',after:null,before:null}}})).toThrow('placement');
 validateInkCheckpoint(replica.sparseCheckpoint(['old']).checkpoint);
});
it('sparse metadata remains detached from the retained replica and tracks aborted imports correctly',()=>{
 const {replica}=begin(),first=replica.sparseCheckpoint(['old']);
 first.checkpoint.strokes[0].registers.color[0].value='#ff0000';first.clock.seed=900;
 expect(replica.materialize(['old']).strokes[0].node.attrs!.color).toBe('#111111');expect(replica.actorSequence('seed')).toBe(1);
 const peer=new InkOperationReplica({checkpoint:replica.checkpoint()});append(peer,'web',[{kind:'edit',strokeId:'other',patch:{color:'#ff0000'}}]);
 const token=replica.prepareImport(peer.checkpoint());replica.abort(token.token);
 expect(replica.sparseCheckpoint([]).level).toBe(1);expect(replica.sparseCheckpoint([]).clock.web).toBeUndefined();
});
it('keeps delta bytes and measured append+projection work independent of unrelated dense samples',()=>{
 const times:number[]=[],sizes:number[]=[],knownCounts:number[]=[];
 for(const count of [16,256]){
  const replica=new InkOperationReplica({pageId:'scale-page',boardId:'scale-board'}),dense=node('template',2000);
  for(let i=0;i<count;i++){
   const id=`dense-${i}`,current={...dense,attrs:{...dense.attrs,id}};
   append(replica,'seed',[{kind:'create',strokeId:id,node:current,layout:frame,placement:{parentId:'scale-board',after:null,before:null}}]);
  }
  const latency:number[]=[];
  for(let i=0;i<12;i++){
   const id=`small-${i}`,start=performance.now();append(replica,'live',[{kind:'create',strokeId:id,node:node(id),layout:frame,placement:{parentId:'scale-board',after:null,before:null}}]);
   const delta=inkWireDeltaFromReplica(replica,[id]);latency.push(performance.now()-start);
   if(i===11){sizes.push(canonicalInkJSON(delta).length);knownCounts.push(Object.keys(replica.sparseCheckpoint([id]).checkpoint.known).length);}
  }
  latency.sort((a,b)=>a-b);times.push(latency[Math.floor(latency.length*.9)]);
 }
 expect(Math.abs(sizes[1]-sizes[0])).toBeLessThan(80);expect(knownCounts).toEqual([1,1]);
 // Actual CPU measurements, with headroom for shared CI hosts. A regression
 // walking half a million unrelated samples exceeds this incremental budget.
 expect(times[1]).toBeLessThan(Math.max(25,times[0]*5));
 console.info('sparse ink projection scaling',JSON.stringify({unrelatedStrokeCounts:[16,256],samplesPerStroke:2000,p90Milliseconds:times,deltaBytes:sizes,requiredDescriptors:knownCounts}));
},30000);

it('replaces approximate imported levels with actual descriptor levels without a stale global maximum',()=>{
 const {document,boardId,replica}=begin();append(replica,'web',[{kind:'edit',strokeId:'other',patch:{color:'#ff0000'}}]);
 const actual=replica.checkpoint(),approximate=structuredClone(actual);
 approximate.known['web:1']={...approximate.known['web:1'],anchor:true,hash:null,level:99};
 const retained=new InkOperationReplica({checkpoint:approximate});expect(retained.sparseCheckpoint([]).level).toBe(99);
 const prepared=retained.prepareImport(actual);retained.commit(prepared.token);
 expect(retained.sparseCheckpoint([]).level).toBe(2);parity(document,boardId,retained,['old']);
});
