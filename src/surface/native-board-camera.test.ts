import {expect,it} from "vitest";
import {initialNativeCameraState,captureNativeCameraIntent,observeNativeCameraAuthority} from "./native-board-camera";
it("freezes the camera and observed native base at the viewport event, without rebasing later",()=>{
 const camera={x:10,y:20,scale:1},first=captureNativeCameraIntent(initialNativeCameraState(),camera);
 camera.x=90;expect(first.intent?.camera.x).toBe(10);expect(Object.isFrozen(first.intent?.camera)).toBe(true);
 const seeded=observeNativeCameraAuthority(first,{scope:"native-a",nativeRevision:0,webRevision:0});
 expect(seeded.intent).toBe(first.intent);expect(seeded.intent?.scope).toBeNull();
 const moved=observeNativeCameraAuthority(seeded,{scope:"native-a",nativeRevision:1,webRevision:0});expect(moved.intent).toBeUndefined();
 const next=captureNativeCameraIntent(moved,camera);expect(next.intent).toMatchObject({scope:"native-a",baseNativeRevision:1,revision:2});
});
it("keeps a newer unacknowledged web command while acknowledging its predecessor",()=>{
 const one=captureNativeCameraIntent(initialNativeCameraState(),{x:0,y:0,scale:1});
 const two=captureNativeCameraIntent(one,{x:1,y:2,scale:2});
 const ack=observeNativeCameraAuthority(two,{scope:"native-a",nativeRevision:0,webRevision:1});
 expect(ack.intent).toBe(two.intent);expect(ack.intent?.baseNativeRevision).toBe(0);
 const done=observeNativeCameraAuthority(ack,{scope:"native-a",nativeRevision:0,webRevision:2});expect(done.intent).toBeUndefined();
 expect(observeNativeCameraAuthority(done,{scope:"native-a",nativeRevision:0,webRevision:1})).toBe(done);
});
it("drops another activation's pending camera and rejects invalid revisions",()=>{
 const native=observeNativeCameraAuthority(initialNativeCameraState(),{scope:"native-a",nativeRevision:3,webRevision:1});
 const pending=captureNativeCameraIntent(native,{x:1,y:2,scale:1});
 const replaced=observeNativeCameraAuthority(pending,{scope:"native-b",nativeRevision:0,webRevision:0});expect(replaced.intent).toBeUndefined();
 expect(replaced.nextIntentRevision).toBe(0);
 expect(()=>captureNativeCameraIntent(native,{x:NaN,y:0,scale:1})).toThrow();
 expect(()=>observeNativeCameraAuthority(native,{scope:"native-a",nativeRevision:.5,webRevision:0})).toThrow();
});
