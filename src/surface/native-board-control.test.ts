import {expect,it} from "vitest";
import {captureNativeBoardControl,serializeNativeBoardControl,type NativeBoardControl} from "./native-board-control";
const pen:NativeBoardControl={tool:"pen",color:"#252629",fillColor:"none",width:2.5,pressure:true,ruler:false};
it("captures immutable full controls once for both intent and frame",()=>{
 const input={...pen},first=captureNativeBoardControl(undefined,input);input.width=24;
 expect(first.control.width).toBe(2.5);expect(Object.isFrozen(first)).toBe(true);expect(Object.isFrozen(first.control)).toBe(true);
 expect(captureNativeBoardControl(first,{...pen})).toBe(first);
 const marker=captureNativeBoardControl(first,{...pen,tool:"highlighter",width:16,color:"#facc15"});
 expect(marker.revision).toBe(2);expect(marker.control).toEqual({...pen,tool:"highlighter",width:16,color:"#facc15"});
 expect(captureNativeBoardControl(marker,{...marker.control,ruler:true}).revision).toBe(3);
});
it("rejects malformed closed input and exhausted revisions without changing the accepted snapshot",()=>{
 const first=captureNativeBoardControl(undefined,pen);
 for(const patch of [{tool:"unknown"},{width:NaN},{width:41},{pressure:"true"},{ruler:0},{color:""},{extra:true}])expect(()=>serializeNativeBoardControl({...pen,...patch} as NativeBoardControl)).toThrow();
 expect(()=>captureNativeBoardControl({...first,revision:Number.MAX_SAFE_INTEGER},{...pen,width:3})).toThrow(/exhausted/);
 expect(first.control).toEqual(pen);
});
