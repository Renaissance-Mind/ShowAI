import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {artifactVersion} from "../surface/document.mjs";
import {createResource} from "../surface/containers.mjs";
import {appendNewPortableInk} from "../surface/portable-ink-append.mjs";
import {longCubicInputFixture} from "../surface/cubic-ink-chunks.fixture.mjs";
import {captureOwnedJSON,freezeOwnedJSON,parseOwnedJSON} from "./owned-json.mjs";
import {parseArtifact,parseArtifactConsumingForSourceSnapshot} from "./validation.mjs";
import type {ShowDocument} from "../types";
function fixture(){
 let document=createResource(blankDocument(),"board") as ShowDocument;
 document.createdAt="2026-10-21T00:00:00.000Z";document.updatedAt="2026-10-22T00:00:00.000Z";
 const ink=longCubicInputFixture(321),boardId=document.content.attrs!.id as string;
 document=appendNewPortableInk(document,boardId,{type:"drawing",attrs:{id:"actual-cubic",tool:"pen",color:"#111111",strokeWidth:4,extent:ink.extent,points:[{x:0,y:100},{x:640,y:100}],ink}},{x:4,y:5,width:650,height:160});
 return captureOwnedJSON(document);
}
const artifact=(document:ShowDocument)=>({format:"showai",version:artifactVersion(document),document});
const consume=(document:ShowDocument)=>parseArtifactConsumingForSourceSnapshot(artifact(document)).document;
it("revalidates changed and unknown fields around actual previously checked captured geometry",()=>{
 const source=fixture(),first=consume(source);
 expect(first).toEqual(parseArtifact(artifact(source)).document);
 const next=captureOwnedJSON({...source,title:"second",futureRoot:{"é":1,"é":2,comments:["中文"]}});
 expect(next.content).toBe(source.content);expect(consume(next)).toEqual(parseArtifact(artifact(next)).document);
 for(const key of ["__proto__","constructor","prototype"]){
  const future=Object.create(null);Object.defineProperty(future,key,{value:1,enumerable:true});
  const invalid=captureOwnedJSON({...next,future});
  expect(()=>consume(invalid)).toThrow(/reserved key/);
 }
 const invalid=structuredClone(source);(invalid.content.content![0].attrs!.ink as any).segments[0].radius[0]=-1;
 expect(()=>consume(captureOwnedJSON(invalid))).toThrow();
 expect(()=>consume(captureOwnedJSON({...next,updatedAt:"invalid"}))).toThrow(/ISO date/);
});
it("checks actual containing depth when previously valid immutable subtrees move",()=>{
 const source=fixture();
 let branch:unknown={value:"leaf"};for(let n=0;n<35;n++)branch={child:branch};
 const shallow=captureOwnedJSON({...source,future:branch});consume(shallow);
 let moved:unknown=shallow.future;for(let n=0;n<15;n++)moved={child:moved};
 const tooDeep=captureOwnedJSON({...source,future:moved});
 expect(()=>consume(tooDeep)).toThrow(/nested too deeply/);
 expect(()=>parseArtifact(artifact(tooDeep))).toThrow(/nested too deeply/);
 consume(shallow);
});
it("never grants JSON authority to shallow freezes, failed checks or mutable aliases",()=>{
 const source=fixture();consume(source);
 const external=structuredClone(source) as ShowDocument&{future?:unknown};external.future={ok:1};consume(external);
 Object.defineProperty(external.future,"constructor",{value:2,enumerable:true});
 expect(()=>consume(external)).toThrow(/reserved key/);
 const shallow=Object.freeze({...source,future:{ok:1}});consume(shallow);
 Object.defineProperty(shallow.future,"prototype",{value:2,enumerable:true});
 expect(()=>consume(shallow)).toThrow(/reserved key/);
 const frozen=freezeOwnedJSON({...source,future:JSON.parse('{"__proto__":1}')});
 expect(()=>consume(frozen)).toThrow(/reserved key/);
 const failed=parseOwnedJSON(JSON.stringify({...source,future:{constructor:1}})) as ShowDocument;
 expect(()=>consume(failed)).toThrow(/reserved key/);expect(()=>consume(failed)).toThrow(/reserved key/);
});
