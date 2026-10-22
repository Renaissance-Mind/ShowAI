import {expect,it} from "vitest";
import {captureOwnedJSON,capturedContentSummary,freezeOwnedJSON} from "../portable/owned-json.mjs";
import {applyCapturedSourceDelta,applyNativeSourceDelta,diffNativeSource,type NativeSourceEdit} from "./native-source-delta.mjs";

it("reuses only actually captured set/splice branches and isolates ordinary mutable edits",()=>{
 const base=captureOwnedJSON({rows:[{id:"old",raw:[[1,2,3]]}],unknown:{"é":1,"é":2}});
 const edits=captureOwnedJSON<NativeSourceEdit[]>([{op:"set",path:["new"],value:{raw:[[4,5,6]]}},{op:"splice",path:["rows"],index:0,deleteCount:0,items:[{id:"new",raw:[[7,8,9]]}]}]);
 const result=applyCapturedSourceDelta(base,edits) as any,oracle=applyNativeSourceDelta(base,edits);
 expect(result).toEqual(oracle);expect(result.unknown).toBe(base.unknown);
 expect(result.new).toBe((edits[0] as any).value);expect(result.rows[0]).toBe((edits[1] as any).items[0]);expect(result.rows[1]).toBe(base.rows[0]);
 expect(Object.isFrozen(result.rows)).toBe(true);expect(capturedContentSummary(result.new)).toBeDefined();
 const mutable={value:{rows:[[10,20]]}},regular=applyNativeSourceDelta({},[{op:"set",path:["payload"],value:mutable.value}]) as any;
 expect(regular.payload).not.toBe(mutable.value);mutable.value.rows[0][0]=99;expect(regular.payload.rows[0][0]).toBe(10);
});
it("captures getter inputs independently and caller freezing never asserts reusable branches",()=>{
 let reads=0;const outside={get data(){reads++;return {samples:[[reads]]}}};
 const edits=[{op:"set",path:["payload"],value:outside}] as NativeSourceEdit[];
 freezeOwnedJSON(outside);const captured=applyCapturedSourceDelta({},edits) as any,before=reads;
 expect(captured.payload===outside).toBe(false);expect(captured.payload.data.samples[0][0]).toBe(before);
 expect(()=>{captured.payload.data.samples[0][0]=99}).toThrow();expect(reads).toBe(before);
 expect(capturedContentSummary(outside)).toBeUndefined();
});
it("path-copies a sealed inserted root before later writes and fails atomically on a later malformed edit",()=>{
 const base=captureOwnedJSON({before:{keep:true}}),root=captureOwnedJSON({items:[{value:1}],literal:{"0":"object"}});
 const edits=captureOwnedJSON<NativeSourceEdit[]>([{op:"set",path:[],value:root},{op:"set",path:["items",0,"value"],value:2},{op:"set",path:["literal","0"],value:"updated"}]);
 const result=applyCapturedSourceDelta(base,edits) as any;
 expect(result).toEqual(applyNativeSourceDelta(base,edits));expect(result.items[0].value).toBe(2);expect(root.items[0].value).toBe(1);
 expect(()=>applyCapturedSourceDelta(base,[...edits,{op:"remove",path:["missing"]}])).toThrow();
 expect(base).toEqual({before:{keep:true}});expect(root).toEqual({items:[{value:1}],literal:{"0":"object"}});
});
it("rejects malformed arrays, inherited paths and unknown edit fields without changing captured bases",()=>{
 const base=captureOwnedJSON(JSON.parse('{"array":[1,2],"__proto__":{"safe":1},"constructor":{"value":2},"é":1}'));
 const next=JSON.parse('{"array":[0,1,2],"__proto__":{"safe":2},"constructor":{"value":3},"é":4}');
 expect(applyCapturedSourceDelta(base,diffNativeSource(base,next))).toEqual(next);
 const invalid:any[]=[{op:"set",path:["toString","bad"],value:1},{op:"splice",path:["array"],index:0,deleteCount:0,items:Array(2)},{op:"set",path:["array",3],value:0},{op:"resize",path:["array"],length:3},{op:"set",path:["x"],value:1,proof:true}];
 for(const edit of invalid)expect(()=>applyCapturedSourceDelta(base,[{op:"set",path:["é"],value:9},edit])).toThrow();
 expect(base["é"]).toBe(1);expect(base.array).toEqual([1,2]);
});
it("keeps large dense splice insertions independent without argument spreading",()=>{
 const values=Array.from({length:70000},(_,index)=>({value:index}));
 const result=applyCapturedSourceDelta({items:[-1]},[{op:"splice",path:["items"],index:0,deleteCount:0,items:values}]);
 expect(result.items).toHaveLength(70001);expect((result.items[69999] as any).value).toBe(69999);values[0].value=99;expect((result.items[0] as any).value).toBe(0);
});
it("never reads inherited edit descriptors or named array ancestors as captured authority",()=>{
 const base=captureOwnedJSON({items:[1]}),edits=captureOwnedJSON([{}]),arrayEdits=captureOwnedJSON([{op:"set",path:["items","__capturedArrayAncestor","value"],value:1}]);
 let reads=0,rejectedDescriptor=false,rejectedArray=false;
 try{
  Object.defineProperty(Object.prototype,"path",{configurable:true,get(){reads++;return[]}});
  Object.defineProperty(Object.prototype,"op",{configurable:true,get(){reads++;return"set"}});
  Object.defineProperty(Array.prototype,"__capturedArrayAncestor",{configurable:true,get(){reads++;return{value:0}}});
  try{applyCapturedSourceDelta(base,edits as NativeSourceEdit[])}catch{rejectedDescriptor=true}
  try{applyCapturedSourceDelta(base,arrayEdits as NativeSourceEdit[])}catch{rejectedArray=true}
 }finally{delete (Object.prototype as any).path;delete (Object.prototype as any).op;delete (Array.prototype as any).__capturedArrayAncestor}
 expect(rejectedDescriptor).toBe(true);expect(rejectedArray).toBe(true);expect(reads).toBe(0);expect(base.items).toEqual([1]);
});
