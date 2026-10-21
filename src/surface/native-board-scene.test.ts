import {describe,it,expect} from "vitest";
import {nativeBoardScenePatch,resolveNativeBoardScene} from "./native-board-scene.mjs";
import {reconcileSurface} from "./document.mjs";
import {createPortableInk} from "./portable-ink.mjs";
import type {ShowDocument} from "../types";

const document=():ShowDocument=>reconcileSurface({id:"scene-page",title:"Native scene",icon:"",cover:"",parentId:null,favorite:false,archived:false,
  createdAt:"2026-10-21T00:00:00Z",updatedAt:"2026-10-21T00:00:00Z",comments:[],content:{type:"surface",attrs:{id:"scene-board",kind:"board"},content:[
  {type:"region",attrs:{id:"region"},content:[{type:"drawing",attrs:{id:"ink",tool:"pen",ink:createPortableInk([{x:0,y:0},{x:50,y:60}],3,[100,100]),extent:[100,100],color:"#000000",strokeWidth:3,points:[{x:0,y:0},{x:50,y:60}]}}]},
  {type:"surface",attrs:{id:"page",kind:"page"},content:[{type:"paragraph",content:[{type:"text",text:"A real editable Page"}]}]},
]},layout:{region:{x:0,y:0,width:200,height:200},ink:{x:10,y:20,width:100,height:100},page:{x:250,y:0,width:400,height:600}}});
describe("native Board object transport",()=>{
  it("keeps rich content and hierarchy while sending only changed object payloads",()=>{
    const first=document(), packet=nativeBoardScenePatch(first,"scene-board");
    expect(packet.nodes.map(n=>n.attrs!.id)).toEqual(["region","ink","page"]);
    expect(resolveNativeBoardScene(packet)).toEqual(first);
    const next=structuredClone(first);next.layout!.page.x=300;
    const moved=nativeBoardScenePatch(next,"scene-board",first);
    expect(moved.nodes).toEqual([]);
    expect(resolveNativeBoardScene(moved,first)).toEqual(next);
    expect(JSON.stringify(moved)).not.toContain("samples");
    const changed=structuredClone(next);changed.content.content![0].content![0].attrs!.color="#2266aa";
    const delta=nativeBoardScenePatch(changed,"scene-board",next);
    expect(delta.nodes.map(n=>n.attrs!.id)).toEqual(["ink"]);
    expect(resolveNativeBoardScene(delta,next)).toEqual(changed);
  });
  it("retains nested Page internals as one object and refuses an absent baseline",()=>{
    const initial=document(), next=structuredClone(initial);
    next.content.content![1].content![0].content![0].text="Edited on another device";
    const delta=nativeBoardScenePatch(next,"scene-board",initial);
    expect(delta.nodes.map(n=>n.attrs!.id)).toEqual(["page"]);
    expect(resolveNativeBoardScene(delta,initial)).toEqual(next);
    expect(()=>resolveNativeBoardScene(delta)).toThrow("incomplete");
    expect(initial.content.content![1].content![0].content![0].text).toBe("A real editable Page");
  });
});
