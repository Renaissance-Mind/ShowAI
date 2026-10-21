import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InkOperationJournal} from './ink-operation-journal';
import {bootstrapInkOperation,createInkOperation,InkOperationReplica,type InkOperation,type InkUndoRecord} from '../surface/ink-operations.mjs';
import {createPortableInk} from '../surface/portable-ink.mjs';
const scope={pageId:'page',boardId:'board'};
const frame={x:0,y:0,width:50,height:30};
const node={type:'drawing',attrs:{id:'stroke',tool:'pen',color:'#111111',strokeWidth:2,extent:[50,30],ink:createPortableInk([{x:1,y:2},{x:30,y:4}],2,[50,30])}};
const roots:string[]=[],journals:InkOperationJournal[]=[];
afterEach(async()=>{for(const j of journals.splice(0))j.close();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function open(){const root=await mkdtemp(join(process.env.SHOWAI_TEST_HOME??tmpdir(),'ink-group-'));roots.push(root);const j=await InkOperationJournal.open(root);journals.push(j);return j;}
function source(j:InkOperationJournal,operation:InkOperation){return{operation,undo:j.undoRecord(scope,operation.id)! as InkUndoRecord};}
function replica(j:InkOperationJournal){const state=j.read(scope);const r=new InkOperationReplica({...scope,...(state.checkpoint?{checkpoint:state.checkpoint}:{})});r.append(state.operations);return r;}
function seed(j:InkOperationJournal){j.append([bootstrapInkOperation({...scope,actor:'seed',nodes:[node],layout:{stroke:frame}})!]);}
function edit(j:InkOperationJournal,patch:Record<string,unknown>){return j.appendLocal({...scope,parents:replica(j).materialize().frontier,changes:[{kind:'edit',strokeId:'stroke',patch}]});}
function compensate(j:InkOperationJournal,sources:ReturnType<typeof source>[]){
 const fork=replica(j),plan=fork.compensationGroupPlan(sources),operations:InkOperation[]=[];
 for(const changes of plan.phases){if(!changes.length)continue;const sequence=fork.actorSequence(j.actor)+1,parents=fork.materialize().frontier;
 if(sequence>1&&!parents.includes(`${j.actor}:${sequence-1}`))parents.push(`${j.actor}:${sequence-1}`);
 const op=createInkOperation({...scope,actor:j.actor,sequence,parents,changes});fork.append([op]);operations.push(op);}
 j.append(operations);return{plan,operations,operation:operations[0]??null};
}
it('rolls a chained width action back once and redoes it while retaining foreign color',async()=>{
 const j=await open();seed(j);const a=edit(j,{strokeWidth:10}),b=edit(j,{strokeWidth:11});
 j.append([createInkOperation({...scope,actor:'remote',sequence:1,parents:[b.id],changes:[{kind:'edit',strokeId:'stroke',patch:{color:'#ff0000'}}]})]);
 expect(replica(j).compensationGroupPlan([source(j,b),source(j,a)]).changes).toEqual([{kind:'edit',strokeId:'stroke',patch:{strokeWidth:2}}]);
 const inverse=compensate(j,[source(j,a),source(j,b)]);expect(inverse.plan.changes).toEqual([{kind:'edit',strokeId:'stroke',patch:{strokeWidth:2}}]);
 expect(j.read(scope).materialization!.strokes[0].node.attrs).toMatchObject({strokeWidth:2,color:'#ff0000'});
 const redo=compensate(j,[source(j,inverse.operation!)]);expect(redo.plan.changes).toEqual([{kind:'edit',strokeId:'stroke',patch:{strokeWidth:11}}]);
 expect(j.read(scope).materialization!.strokes[0].node.attrs).toMatchObject({strokeWidth:11,color:'#ff0000'});
});
it('stops at a foreign same-value owner instead of undoing past it',async()=>{
 const j=await open();seed(j);const a=edit(j,{strokeWidth:10});
 const remote=createInkOperation({...scope,actor:'remote',sequence:1,parents:[a.id],changes:[{kind:'edit',strokeId:'stroke',patch:{strokeWidth:10}}]});j.append([remote]);
 const b=edit(j,{strokeWidth:11});const result=compensate(j,[source(j,a),source(j,b)]);
 expect(result.plan.changes).toEqual([{kind:'edit',strokeId:'stroke',patch:{strokeWidth:10}}]);
});
it('deletes one created logical stroke after late corrections and restores its corrected source on redo',async()=>{
 const j=await open();const a=j.appendLocal({...scope,parents:replica(j).materialize().frontier,changes:[{kind:'create',strokeId:'stroke',node,layout:frame}]});
 const b=edit(j,{strokeWidth:12});const undo=compensate(j,[source(j,a),source(j,b)]);
 expect(undo.plan.changes).toEqual([{kind:'delete',strokeId:'stroke'}]);expect(j.read(scope).materialization!.strokes[0].deleted).toBe(true);
 const redo=compensate(j,[source(j,undo.operation!)]);expect(redo.plan.changes).toEqual([{kind:'restore',strokeId:'stroke'}]);
 expect(j.read(scope).materialization!.strokes[0].node.attrs!.strokeWidth).toBe(12);
});
it('does not delete a group-created stroke that now has a foreign edit',async()=>{
 const j=await open();const a=j.appendLocal({...scope,parents:replica(j).materialize().frontier,changes:[{kind:'create',strokeId:'stroke',node,layout:frame}]});const b=edit(j,{strokeWidth:12});
 j.append([createInkOperation({...scope,actor:'remote',sequence:1,parents:[b.id],changes:[{kind:'edit',strokeId:'stroke',patch:{color:'#ff0000'}}]})]);
 const plan=replica(j).compensationGroupPlan([source(j,a),source(j,b)]);expect(plan.changes).toEqual([]);expect(plan.skipped).toContainEqual({strokeId:'stroke',field:'create',reason:'foreign-or-conflicting-current-head'});
});
it('keeps conflicting current and prior heads instead of guessing a value',async()=>{
 const j=await open();seed(j);const a=edit(j,{strokeWidth:10});
 j.append([createInkOperation({...scope,actor:'remote',sequence:1,parents:['seed:1'],changes:[{kind:'edit',strokeId:'stroke',patch:{strokeWidth:7}}]})]);
 expect(replica(j).compensationGroupPlan([source(j,a)]).changes).toEqual([]);
 const b=edit(j,{strokeWidth:11});const plan=replica(j).compensationGroupPlan([source(j,a),source(j,b)]);
 expect(plan.changes).toEqual([]);expect(plan.skipped).toContainEqual({strokeId:'stroke',field:'strokeWidth',reason:'conflicting-prior-heads'});
});
it('accepts legacy single-operation undo records but conservatively skips legacy chains',async()=>{
 const j=await open();seed(j);const a=edit(j,{strokeWidth:10});const legacy={operation:a,undo:{changes:source(j,a).undo.changes}};
 expect(replica(j).compensationGroupPlan([legacy]).changes).toEqual([{kind:'edit',strokeId:'stroke',patch:{strokeWidth:2}}]);
 const b=edit(j,{strokeWidth:11});const plan=replica(j).compensationGroupPlan([legacy,{operation:b,undo:{changes:source(j,b).undo.changes}}]);
 expect(plan.changes).toEqual([]);expect(plan.skipped[0].reason).toBe('prior-heads-unavailable');
});
it('rejects source scope/hash and prior-head corruption from real durable history',async()=>{
 const j=await open();seed(j);const a=edit(j,{strokeWidth:10}),b=edit(j,{strokeWidth:11}),r=replica(j);
 const corrupted=structuredClone(source(j,b));corrupted.undo.beforeHeads!.stroke.strokeWidth[0].valueHash='bad';
 expect(()=>r.compensationGroupPlan([source(j,a),corrupted])).toThrow('prior-head value hash');
 expect(()=>r.compensationGroupPlan([{...source(j,a),operation:{...a,boardId:'other'}}])).toThrow('source identity');
 const changed=structuredClone(source(j,a));changed.operation.changes=[{kind:'edit',strokeId:'stroke',patch:{strokeWidth:30}}];
 expect(()=>r.compensationGroupPlan([changed])).toThrow('source identity');
});

it('atomically plans liveness and source restoration in two real events and redoes both',async()=>{
 const j=await open();seed(j);const a=edit(j,{strokeWidth:10});
 const b=j.appendLocal({...scope,parents:[a.id],changes:[{kind:'delete',strokeId:'stroke'}]});
 const plan=replica(j).compensationGroupPlan([source(j,a),source(j,b)]);
 expect(plan.phases).toEqual([[{kind:'restore',strokeId:'stroke'}],[{kind:'edit',strokeId:'stroke',patch:{strokeWidth:2}}]]);
 const fork=replica(j),batch:InkOperation[]=[];
 for(const changes of plan.phases){const sequence=fork.actorSequence(j.actor)+1,parents=fork.materialize().frontier;
  if(sequence>1&&!parents.includes(`${j.actor}:${sequence-1}`))parents.push(`${j.actor}:${sequence-1}`);
  const op=createInkOperation({...scope,actor:j.actor,sequence,parents,changes});fork.append([op]);batch.push(op);}
 j.append(batch);expect(j.read(scope).materialization!.strokes[0]).toMatchObject({deleted:false,node:{attrs:{strokeWidth:2}}});
 const redo=compensate(j,batch.map(op=>source(j,op)));
 expect(redo.plan.phases).toEqual([[{kind:'delete',strokeId:'stroke'}],[{kind:'edit',strokeId:'stroke',patch:{strokeWidth:10}}]]);
 expect(j.read(scope).materialization!.strokes[0]).toMatchObject({deleted:true,node:{attrs:{strokeWidth:10}}});
});

import {appendNativeInkHistoryGroups,nativeInkHistoryGroups,unregisteredNativeInkHistoryAction,type NativeInkHistoryAction} from '../surface/native-ink-history';
it('keeps both durable actions undoable when the save echo already contains the second source body',async()=>{
 const j=await open();
 const create=(id:string)=>j.appendLocal({...scope,parents:replica(j).materialize().frontier,changes:[{kind:'create',strokeId:id,node:{...node,attrs:{...node.attrs,id}},layout:frame}]});
 const first=create('first'),second=create('second');
 // Both source values have already reached UI before the second actual action
 // receipt. History ownership comes from actual scoped IDs, never JSON deltas.
 const arrivedSource=j.read(scope).materialization!,registered:NativeInkHistoryAction[]=[];
 expect(arrivedSource.strokes.filter(s=>!s.deleted).map(s=>s.id)).toEqual(['first','second']);
 for(const operation of [first,second]){
  const action=unregisteredNativeInkHistoryAction(appendNativeInkHistoryGroups({},[{boardId:scope.boardId,operationIds:[operation.id]}]),registered)!;
  expect(action).toBeDefined();registered.push(action);
 }
 expect(unregisteredNativeInkHistoryAction(registered[1],registered)).toBeUndefined();
 expect(nativeInkHistoryGroups(registered[0])[0].operationIds).toEqual([first.id]);
 expect(nativeInkHistoryGroups(registered[1])[0].operationIds).toEqual([second.id]);
 const undoSecond=compensate(j,[source(j,second)]);
 expect(j.read(scope).materialization!.strokes.filter(s=>!s.deleted).map(s=>s.id)).toEqual(['first']);
 const undoFirst=compensate(j,[source(j,first)]);
 expect(j.read(scope).materialization!.strokes.filter(s=>!s.deleted)).toEqual([]);
 compensate(j,[source(j,undoFirst.operation!)]);compensate(j,[source(j,undoSecond.operation!)]);
 expect(j.read(scope).materialization!.strokes.filter(s=>!s.deleted).map(s=>s.id)).toEqual(['first','second']);
});
