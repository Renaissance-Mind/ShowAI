import {expect,it} from "vitest";
import {applyNativeSourceDelta,diffNativeSource,shareNativeSource,type NativeSourceEdit} from "./native-source-delta.mjs";
import {createResource} from "./containers.mjs";
import {blankDocument} from "../core/catalog";
import {addNode} from "./editing";
import {createPortableInk} from "./portable-ink.mjs";
import {stampInkDocument,inkWireConflicts,inkCheckpointFromDocument,inkWireDocumentFromCheckpoint} from "./ink-wire.mjs";
import {InkOperationReplica,createInkOperation} from "./ink-operations.mjs";
import {mergePageContent} from "../core/page-merge-model";
import {findSurfaceNode,isReconciledSurface,reconcileSurface} from "./document.mjs";
import {mergeNativeDocumentReceipt,nativeDocumentBodiesEqual} from "./native-document-content";
import type {ShowDocument} from "../types";
function freeze<T>(value:T):T{
 if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value)}return value;
}
function source(){
 let page=createResource(blankDocument(),"board") as ShowDocument;
 page=addNode(page,{type:"drawing",attrs:{id:"stroke",tool:"pen",color:"#111111",strokeWidth:2,extent:[100,60],points:[{x:0,y:0},{x:80,y:40}],ink:createPortableInk([{x:0,y:0,pressure:.5},{x:80,y:40,pressure:.8}],2,[100,60])}},
  {x:0,y:0,width:100,height:60},page.content.attrs!.id) as ShowDocument;
 page=addNode(page,{type:"drawing",attrs:{id:"shape",tool:"rectangle",color:"#111111",strokeWidth:2,label:"A",extent:[100,60],points:[{x:0,y:0},{x:100,y:60}]}},
  {x:200,y:0,width:100,height:60},page.content.attrs!.id) as ShowDocument;
 return stampInkDocument(page,undefined,{actor:"seed",sequence:1});
}
const node=(page:ShowDocument,id="stroke")=>findSurfaceNode(page,id)!.node;
function edit(base:ShowDocument,actor:string,change:(page:ShowDocument)=>void){const next=structuredClone(base);change(next);return stampInkDocument(next,base,{actor,sequence:1})}
it("round-trips complete existing packets including unknown data and actual causal conflicts",()=>{
 const base=source(),a=edit(base,"left",p=>{node(p).attrs!.color="#ff0000"}),b=edit(base,"right",p=>{node(p).attrs!.color="#0000ff"});
 const merged=mergePageContent(base,a,b).document;
 const packet={document:base,baseDocument:structuredClone(base),operationIds:["writer:1"],adoptActions:[{boardId:base.content.attrs!.id,intentId:"actual-intent",operationIds:["writer:1"]}],unknown:{data:[null,{literal:"保留"}],missing:null}};
 const next={...structuredClone(packet),document:merged,operationIds:["writer:1","writer:2"]};
 (next.document as any).futureField={nested:[{unknown:true}]};(next.document.layout!.shape as any).extension={future:91};
 const original=structuredClone(packet);freeze(packet);
 const edits=diffNativeSource(packet,next),result=applyNativeSourceDelta(packet,edits);
 expect(result).toEqual(next);expect(packet).toEqual(original);
 expect(result.baseDocument).toBe(packet.baseDocument);expect(inkWireConflicts(result.document)).toEqual(inkWireConflicts(merged));
 expect(inkWireConflicts(result.document).some(c=>c.retained&&c.field==="color")).toBe(true);
});
it("preserves delete/tombstone, late-force metadata and grouped operation identities across N then N+1",()=>{
 const base=source(),corrected=edit(base,"pencil",p=>{node(p).attrs!.ink.samples[0][8]=.9});
 const deleted=edit(corrected,"eraser",p=>{p.content.content=p.content.content!.filter(n=>n.attrs?.id!=="stroke");delete p.layout!.stroke});
 const first={document:base,baseDocument:base,correctionActions:[] as unknown[]};
 const second={document:corrected,baseDocument:base,correctionActions:[{boardId:base.content.attrs!.id,strokeId:"stroke",operationIds:["pencil:1"]}]};
 const third={document:deleted,baseDocument:corrected,correctionActions:[],groups:[{boardId:"one",operationIds:["actor:1"]},{boardId:"two",operationIds:["actor:1"]}]};
 const n=applyNativeSourceDelta(freeze(structuredClone(first)),diffNativeSource(first,second));
 const n1=applyNativeSourceDelta(freeze(n),diffNativeSource(second,third));
 expect(n).toEqual(second);expect(n1).toEqual(third);expect(n.document).toEqual(corrected);
 expect(node(n1.document,"shape")).toBeDefined();expect(n1.document.content.attrs!.inkState.strokes.stroke).toBeDefined();
});
it("supports exact ordered arrays, absent versus null and safe literal Unicode/prototype keys",()=>{
 const base=JSON.parse('{"object":{"0":"string key","__proto__":{"x":1},"constructor":null,"é":"old"},"array":[1,{"keep":true},3],"absent":null}');
 const next=JSON.parse('{"object":{"0":"changed","__proto__":{"x":2},"constructor":{"value":4},"é":"new"},"array":[{"keep":true},1],"added":null}');
 const result=applyNativeSourceDelta(freeze(base),diffNativeSource(base,next));
 expect(result).toEqual(next);expect(Object.hasOwn(result.object,"__proto__")).toBe(true);
 expect(Object.getPrototypeOf(result.object)).toBe(Object.prototype);expect(({} as any).x).toBeUndefined();
 expect(Object.hasOwn(result.object,"é")).toBe(false);expect(Object.hasOwn(result.object,"é")).toBe(true);
});
it("clones inserted values so later caller edits cannot mutate a transport snapshot",()=>{
 const payload={nested:[{value:1}]},edits:NativeSourceEdit[]=[{op:"set",path:["added"],value:payload}],base={keep:{value:2}};
 const result=applyNativeSourceDelta(base,edits) as any;payload.nested[0].value=9;
 expect(result.added.nested[0].value).toBe(1);expect(result.keep).toBe(base.keep);
});
it("rejects invalid later edits atomically without modifying the base or edit payload",()=>{
 const invalid:NativeSourceEdit[]=[
  {op:"set",path:["list",4],value:1},{op:"set",path:["list","0"],value:1},{op:"set",path:["object",0],value:1},
  {op:"remove",path:["list",0]},{op:"remove",path:[]},{op:"remove",path:["missing"]},
  {op:"set",path:["missing","child"],value:1},{op:"resize",path:["list"],length:4},
  {op:"resize",path:["object"],length:0},{op:"resize",path:["list"],length:-1},
  {op:"set",path:["invalid"],value:undefined},{op:"set",path:["invalid"],value:NaN},
  {op:"set",path:["invalid"],value:new Date()},
 ];
 const base=freeze({list:[1,2],object:{"0":true},keep:{field:1}}),original=structuredClone(base);
 for(const edit of invalid){expect(()=>applyNativeSourceDelta(base,[{op:"set",path:["keep","field"],value:9},edit])).toThrow(/Invalid native source delta/);expect(base).toEqual(original)}
 expect(applyNativeSourceDelta(base,[{op:"set",path:["list",2],value:3},{op:"resize",path:["list"],length:1}])).toEqual({...original,list:[1]});
});
it("root replacement remains isolated and all repeated edits copy only the same changed ancestor",()=>{
 const base={unchanged:{value:1},changed:{x:1,y:2}},edits:NativeSourceEdit[]=[{op:"set",path:["changed","x"],value:3},{op:"set",path:["changed","y"],value:4}];
 const result=applyNativeSourceDelta(freeze(base),edits);expect(result).toEqual({unchanged:{value:1},changed:{x:3,y:4}});expect(result.unchanged).toBe(base.unchanged);
 const next={replacement:[1,2]};const replaced=applyNativeSourceDelta(base,[{op:"set",path:[],value:next}]) as any;
 next.replacement.push(3);expect(replaced).toEqual({replacement:[1,2]});
});
it("retains old UI references only after complete semantic normalization",()=>{
 const old=reconcileSurface(source()),input=structuredClone(old);node(input).attrs!.color="#ff0000";
 (input.layout as any).dangling={x:9,y:9,width:1};input.surfaceViews![input.content.attrs!.id].readingOrder.push("missing");
 const normalized=reconcileSurface(input),shared=reconcileSurface(input,{shareWith:old});
 expect(shared).toEqual(normalized);expect(isReconciledSurface(shared)).toBe(true);
 expect(node(shared,"shape")).toBe(node(old,"shape"));expect(shared.layout!.shape).toBe(old.layout!.shape);
 expect(node(shared)).not.toBe(node(input));expect(node(shared)).not.toBe(node(old));
 expect(shared.layout).not.toHaveProperty("dangling");expect(input.layout).toHaveProperty("dangling");
 expect(()=>reconcileSurface(input,{clone:false,shareWith:old})).toThrow(/independent normalization clone/);
});
it("never aliases private Native transport nodes into mutable UI, including unknown nested fields",()=>{
 const old=reconcileSurface(source()),privatePacket=freeze({document:edit(old,"native",p=>{node(p).attrs!.color="#ff0000"}),baseDocument:structuredClone(old)});
 const publicSource=structuredClone(privatePacket.document),ui=reconcileSurface(publicSource,{shareWith:old});
 node(ui).attrs!.color="#00ff00";node(ui).attrs!.ink.samples[0][0]=77;
 expect(node(privatePacket.document).attrs!.color).toBe("#ff0000");expect(node(privatePacket.document).attrs!.ink.samples[0][0]).not.toBe(77);
 expect(node(privatePacket.baseDocument).attrs!.color).toBe("#111111");
});
it("keeps writer baseline independent from transport baseline and leaves merged M out of transport N",()=>{
 const writer=source(),transport=structuredClone(writer);node(transport,"shape").attrs!.label="B";
 const incoming=edit(writer,"native",p=>{node(p).attrs!.strokeWidth=9});
 const oldP={document:transport,baseDocument:writer},newP={document:incoming,baseDocument:writer};
 const privateN=freeze(applyNativeSourceDelta(freeze(oldP),diffNativeSource(oldP,newP)));
 const result=mergeNativeDocumentReceipt(privateN.baseDocument,structuredClone(transport),structuredClone(privateN.document));
 expect(node(result.document,"shape").attrs!.label).toBe("B");expect(node(result.document).attrs!.strokeWidth).toBe(9);
 expect(node(privateN.document,"shape").attrs!.label).toBe("A");expect(nativeDocumentBodiesEqual(result.document,privateN.document)).toBe(false);
 const next=edit(incoming,"pencil",p=>{node(p).attrs!.ink.samples[0][8]=.7});
 expect(applyNativeSourceDelta(privateN,diffNativeSource(newP,{document:next,baseDocument:incoming}))).toEqual({document:next,baseDocument:incoming});
});
it("structural sharing detects key absence, array order and exact metadata differences without identity assumptions",()=>{
 const previous={nodes:[{id:"a",value:1},{id:"b",value:2}],unknown:{present:undefined},meta:{heads:["a:1"]}},next=structuredClone(previous);
 expect(shareNativeSource(previous,next)).toBe(previous);
 next.nodes.reverse();next.meta.heads.push("b:1");delete (next.unknown as any).present;
 const shared=shareNativeSource(previous,next);expect(shared).toEqual(next);expect(shared).not.toBe(previous);expect(Object.hasOwn(shared.unknown,"present")).toBe(false);
 expect(shared.nodes.map(n=>n.id)).toEqual(["b","a"]);expect(shared.meta.heads).toEqual(["a:1","b:1"]);
});
it("retains every root-only source change while sharing equal normalized drawing/layout branches",()=>{
 const old=reconcileSurface(source());
 const changes=[{title:"Remote title"},{createdAt:"2026-01-01T00:00:00Z"},{comments:[{id:"remote",text:"Keep this",createdAt:old.createdAt,resolved:false}]},{futureRoot:{keep:[1,null,"value"]}}];
 for(const change of changes){
  const incoming={...structuredClone(old),...change},next=reconcileSurface(incoming,{shareWith:old});
  expect(next).toEqual(reconcileSurface(incoming));expect(next).not.toBe(old);
  expect(next.content).toBe(old.content);expect(next.layout).toBe(old.layout);expect(next.surfaceViews).toBe(old.surfaceViews);
  expect(nativeDocumentBodiesEqual(next,old)).toBe(false);
 }
});
it("encodes only changed values regardless of unrelated editable sample count",()=>{
 const packet=(count:number)=>{
  const page=source();node(page).attrs!.ink=createPortableInk(Array.from({length:count},(_,i)=>({x:i/10,y:(i%71)/10,pressure:.5})),2,[1000,1000]);
  return {document:page,baseDocument:structuredClone(page),operationIds:["writer:1"]};
 };
 const sizes=[512,8192].map(count=>{
  const baseline=packet(count),next=structuredClone(baseline);node(next.document,"shape").attrs!.label="New label";
  const edits=diffNativeSource(freeze(baseline),next),result=applyNativeSourceDelta(baseline,edits);
  expect(result).toEqual(next);expect(node(result.document)).toBe(node(baseline.document));
  expect(result.baseDocument).toBe(baseline.baseDocument);return JSON.stringify(edits).length;
 });
 expect(sizes[0]).toBe(sizes[1]);expect(sizes[0]).toBeLessThan(200);
});
it("encodes exact middle array insertion/deletion with one splice while retaining append/tail edits",()=>{
 const a={id:"a",unknown:{keep:true}},b={id:"b",unknown:{keep:null}},c={id:"c",unknown:{keep:"é"}};
 for(const [before,next,expected] of [
  [[a,b,c],[a,c],{op:"splice",path:["nodes"],index:1,deleteCount:1,items:[]}],
  [[a,c],[a,b,c],{op:"splice",path:["nodes"],index:1,deleteCount:0,items:[b]}],
  [[a,b,c],[b,c],{op:"splice",path:["nodes"],index:0,deleteCount:1,items:[]}],
 ] as [unknown[],unknown[],NativeSourceEdit][]){
  const baseline=freeze({nodes:before}),target={nodes:next};expect(diffNativeSource(baseline,target)).toEqual([expected]);
  expect(applyNativeSourceDelta(baseline,[expected])).toEqual(target);
 }
 expect(applyNativeSourceDelta([1,2,3],[{op:"splice",path:[],index:1,deleteCount:1,items:[4,5]}])).toEqual([1,4,5,3]);
 expect(diffNativeSource([a,b],[a,b,c])).toEqual([{op:"set",path:[2],value:c}]);
 expect(diffNativeSource([a,b,c],[a,b])).toEqual([{op:"resize",path:[],length:2}]);
});
it("splice validates dense ranges atomically and isolates large inserted JSON without argument spreading",()=>{
 const original=freeze({items:[{id:"a"},{id:"b"}],keep:{value:1}}),badItems=Array(2);badItems[1]="hole";
 const invalid=[{index:-1,deleteCount:0,items:[]},{index:3,deleteCount:0,items:[]},{index:1.5,deleteCount:0,items:[]},
  {index:1,deleteCount:2,items:[]},{index:1,deleteCount:-1,items:[]},{index:1,deleteCount:.5,items:[]},
  {index:1,deleteCount:0,items:null},{index:1,deleteCount:0,items:[],unexpected:true},{index:1,deleteCount:0,items:badItems},{index:1,deleteCount:0,items:[undefined]}];
 for(const fields of invalid){
  const edit={op:"splice",path:["items"],...fields} as NativeSourceEdit;
  expect(()=>applyNativeSourceDelta(original,[{op:"set",path:["keep","value"],value:9},edit])).toThrow(/Invalid native source delta/);
  expect(original.keep.value).toBe(1);expect(original.items).toEqual([{id:"a"},{id:"b"}]);
 }
 expect(()=>applyNativeSourceDelta(original,[{op:"splice",path:["keep"],index:0,deleteCount:0,items:[]}])).toThrow(/existing array/);
 const items=Array.from({length:200000},(_,index)=>index),result=applyNativeSourceDelta(original,[{op:"splice",path:["items"],index:1,deleteCount:0,items}]) as any;
 items[0]=-1;expect(result.items).toHaveLength(200002);expect(result.items[1]).toBe(0);expect(result.items.at(-1)).toEqual({id:"b"});expect(result.keep).toBe(original.keep);
 const inserted={nested:["é","é"]},small=applyNativeSourceDelta(original,[{op:"splice",path:["items"],index:1,deleteCount:1,items:[inserted]}]) as any;
 inserted.nested[0]="mutated";expect(small.items[1].nested).toEqual(["é","é"]);
});
it("splice handles literal Unicode and prototype object keys without changing prototypes",()=>{
 const before=JSON.parse('{"__proto__":{"é":[1,2,3],"é":[4,5]}}'),next=JSON.parse('{"__proto__":{"é":[1,3],"é":[4,5]}}');
 const edits=diffNativeSource(before,next);expect(edits).toEqual([{op:"splice",path:["__proto__","é"],index:1,deleteCount:1,items:[]}]);
 const result=applyNativeSourceDelta(freeze(before),edits);expect(result).toEqual(next);expect(Object.getPrototypeOf(result)).toBe(Object.prototype);expect(({} as any).é).toBeUndefined();
});
it("retains unique old UI node references after deletion/reordering, never ID-only equality",()=>{
 const previous=[{attrs:{id:"a"},unknown:{keep:1}},{attrs:{id:"b"},unknown:{keep:2}},{attrs:{id:"c"},unknown:{keep:3}}];
 const moved=shareNativeSource(previous,structuredClone([previous[2],previous[0],previous[1]]));
 expect(moved).not.toBe(previous);expect(moved.map(node=>node.attrs.id)).toEqual(["c","a","b"]);
 expect(moved[0]).toBe(previous[2]);expect(moved[1]).toBe(previous[0]);expect(moved[2]).toBe(previous[1]);
 const deleted=shareNativeSource(previous,structuredClone([previous[1],previous[2]]));expect(deleted[0]).toBe(previous[1]);expect(deleted[1]).toBe(previous[2]);
 const changed=structuredClone([previous[1],previous[2]]);changed[0].unknown.keep=99;
 const next=shareNativeSource(previous,changed);expect(next[0]).not.toBe(previous[1]);expect(next[0].unknown.keep).toBe(99);expect(next[1]).toBe(previous[2]);
 const ids=[{id:"first",causal:{heads:["a:1"]}},{id:"last",causal:{heads:["b:1"]}}],future=structuredClone([ids[1]]);future[0].causal.heads.push("foreign:1");
 expect(shareNativeSource(ids,future)[0]).not.toBe(ids[1]);
});
it("uses index fallback for duplicate/missing identities and never searches another parent array",()=>{
 const old=[{id:"a",value:1},{id:"b",value:2},{id:"c",value:3}],duplicate=structuredClone([{id:"b",value:2},{id:"b",value:2}]);
 const next=shareNativeSource(old,duplicate);expect(next[0]).not.toBe(old[1]);expect(next[1]).toBe(old[1]);expect(next[0]).not.toBe(next[1]);
 const duplicateOld=[{id:"b",value:2},{id:"b",value:2}],unique=shareNativeSource(duplicateOld,structuredClone([{id:"b",value:2}]));expect(unique[0]).toBe(duplicateOld[0]);
 const noID=[{value:1},{value:2}],moved=shareNativeSource(noID,structuredClone([noID[1]]));expect(moved[0]).not.toBe(noID[1]);
 const parents={one:[old[0]],two:[] as typeof old},target={one:[],two:structuredClone([old[0]])};
 expect(shareNativeSource(parents,target).two[0]).not.toBe(old[0]);
});

it("does not let a new unique ID borrow mutable data from a surviving old node",()=>{
 const previous=[{id:"a",data:{value:1}},{id:"b",data:{value:2}}],normalized=structuredClone([{id:"c",data:{value:1}},previous[0]]);
 const next=shareNativeSource(previous,normalized);expect(next[0]).toBe(normalized[0]);expect(next[1]).toBe(previous[0]);
 expect(next[0].data).not.toBe(next[1].data);next[0].data.value=99;expect(next[1].data.value).toBe(1);
 const composed=[{id:"é",data:{value:1}}],decomposed=structuredClone([{id:"é",data:{value:1}}]);
 expect(shareNativeSource(composed,decomposed)[0]).toBe(decomposed[0]);
});

it("replays actual first/middle/last causal deletes compactly while preserving surviving UI ink identities",()=>{
 const initial=source();let draft=structuredClone(initial);
 for(let index=1;index<=6;index++)draft=addNode(draft,{type:"drawing",attrs:{...structuredClone(node(initial).attrs),id:`stroke-${index}`,ink:createPortableInk([{x:index,y:index,pressure:.5},{x:70+index,y:30+index,pressure:.8}],2,[100,60])}},
  {x:index*100,y:0,width:100,height:60},draft.content.attrs!.id) as ShowDocument;
 const baseline=stampInkDocument(draft,initial,{actor:"actual-setup",sequence:1}),boardId=baseline.content.attrs!.id as string;
 const checkpoint=inkCheckpointFromDocument(baseline,boardId),before=JSON.parse(JSON.stringify({document:baseline,baseDocument:baseline})),oldUI=reconcileSurface(before.document);
 for(const id of ["stroke","stroke-3","stroke-6"]){
  const replica=new InkOperationReplica({checkpoint}),operation=createInkOperation({actor:"actual-eraser",sequence:1,pageId:baseline.id,boardId,parents:[...replica.frontier],changes:[{kind:"delete",strokeId:id}]});
  replica.append([operation]);
  const after=JSON.parse(JSON.stringify({document:inkWireDocumentFromCheckpoint(baseline,boardId,replica.checkpoint()),baseDocument:baseline}));
  const edits=diffNativeSource(freeze(before),after);expect(applyNativeSourceDelta(before,edits)).toEqual(after);expect(JSON.stringify(edits).length).toBeLessThan(6000);
  const ui=reconcileSurface(after.document,{shareWith:oldUI});expect(findSurfaceNode(ui,id)).toBeUndefined();
  for(const remaining of ["stroke",...Array.from({length:6},(_,index)=>`stroke-${index+1}`)].filter(value=>value!==id))
    expect(findSurfaceNode(ui,remaining)!.node).toBe(findSurfaceNode(oldUI,remaining)!.node);
 }
});
