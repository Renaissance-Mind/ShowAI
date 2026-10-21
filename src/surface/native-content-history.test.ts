import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {addNode,editNode} from "./editing";
import {findSurfaceNode} from "./document.mjs";
import {nativeContentHistoryStages} from "./native-content-history";
import type {ShowDocument} from "../types";

function fixture(){
  let value=createResource(blankDocument(),"board") as ShowDocument;
  for(const id of ["local","remote"])value=addNode(value,{type:"drawing",attrs:{id,tool:"rectangle",color:"#111111",strokeWidth:2,label:id,extent:[100,60],points:[{x:0,y:0},{x:100,y:60}]}},
    {x:id==="local"?0:200,y:0,width:100,height:60},value.content.attrs!.id) as ShowDocument;
  return value;
}
const label=(doc:ShowDocument,id:string)=>findSurfaceNode(doc,id)!.node.attrs!.label;
const changed=(doc:ShowDocument,id:string,text:string)=>editNode(doc,id,node=>{node.attrs!.label=text}) as ShowDocument;

it("a foreign mutation coalesced with a native edit stays in its exact undo source",()=>{
  const base=fixture(),foreign=changed(base,"remote","other device"),owned=changed(foreign,"local","my edit");
  const later=structuredClone(owned);later.layout!.remote.x=500;
  const result=nativeContentHistoryStages(base,base,later,[{groupId:"label",beforeDocument:foreign,document:owned}]);
  expect(label(result.sourceOnly,"local")).toBe("local");expect(label(result.sourceOnly,"remote")).toBe("other device");
  expect(result.sourceOnly.layout!.remote.x).toBe(500);expect(label(result.stages[0].document,"local")).toBe("my edit");
});
it("multiple actual native actions have separate rollback stages with later foreign fields preserved",()=>{
  const base=fixture(),a=changed(base,"local","first"),foreign=changed(a,"remote","foreign"),b=structuredClone(foreign);b.layout!.local.x=90;
  const last=structuredClone(b);last.layout!.remote.y=100;
  const result=nativeContentHistoryStages(base,base,last,[{groupId:"label",beforeDocument:base,document:a},{groupId:"move",beforeDocument:foreign,document:b}]);
  expect(result.stages.map(s=>s.groupId)).toEqual(["label","move"]);
  expect(label(result.sourceOnly,"local")).toBe("local");expect(result.sourceOnly.layout!.local.x).toBe(0);
  for(const stage of result.stages){expect(label(stage.before,"remote")).toBe("foreign");expect(stage.before.layout!.remote.y).toBe(100)}
  expect(label(result.stages[1].before,"local")).toBe("first");expect(result.stages[1].before.layout!.local.x).toBe(0);
});
it("later foreign replacement of the same local field survives undo",()=>{
  const base=fixture(),owned=changed(base,"local","mine"),foreign=changed(owned,"local","new remote");
  const result=nativeContentHistoryStages(base,base,foreign,[{groupId:"label",beforeDocument:base,document:owned}]);
  expect(label(result.sourceOnly,"local")).toBe("new remote");
});
it("history receipts cannot cross page identities",()=>{
  const base=fixture(),other={...base,id:"unrelated"};
  expect(()=>nativeContentHistoryStages(base,base,base,[{groupId:"label",beforeDocument:other,document:other}])).toThrow(/baseline/);
});

import {mergePageContent} from "../core/page-merge-model";
it("reuses only the exact captured triplet while preserving foreign fields through actual history rollback",()=>{
 const base=fixture(),current=changed(base,"remote","Web foreign"),owned=changed(base,"local","mine"),incoming=structuredClone(owned);incoming.layout!.remote.y=140;
 const result=mergePageContent(base,current,incoming),actions=[{groupId:"label",beforeDocument:base,document:owned}];
 const actual=nativeContentHistoryStages(current,base,incoming,actions,{baseline:base,current,incoming,result});
 expect(actual).toEqual(nativeContentHistoryStages(current,base,incoming,actions));
 expect(label(actual.sourceOnly,"local")).toBe("local");expect(label(actual.sourceOnly,"remote")).toBe("Web foreign");expect(actual.sourceOnly.layout!.remote.y).toBe(140);
 const oldCurrent=structuredClone(base),stale=mergePageContent(base,oldCurrent,incoming);
 const guarded=nativeContentHistoryStages(current,base,incoming,actions,{baseline:base,current:oldCurrent,incoming,result:stale});
 expect(label(guarded.sourceOnly,"remote")).toBe("Web foreign");
});
