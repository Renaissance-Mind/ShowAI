import {expect,it} from 'vitest';
import {measureNativeSync} from './native-perf';
it('preserves a synchronous result and exact exception when no browser observer exists',()=>{
 const value={retained:true},failure=new Error('Actual operation failed');
 expect(measureNativeSync('diagnostic.result',()=>value)).toBe(value);
 let received:unknown;
 try{measureNativeSync('diagnostic.error',()=>{throw failure})}catch(error){received=error}
 expect(received).toBe(failure);
});
