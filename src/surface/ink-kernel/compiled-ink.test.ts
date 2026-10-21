import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { CompiledInkKernel, inkKernelProvenance } from './compiled-ink.mjs';
import { createPortableInk, portableInkGeometry, portableInkBounds, portableInkSamples, portableInkHit, validatePortableInk } from './reference-ink-v1.mjs';

const brushes: Record<string, number> = { pen: 0, marker: 1, pencil: 2, monoline: 3 };
const commands: Record<string, number> = { M: 0, L: 1, Q: 2, C: 3, Z: 4 };
const kernel = new CompiledInkKernel();
let temporary: string, executable: string;
beforeAll(() => {
  temporary = mkdtempSync(join(tmpdir(), 'showai-native-ink-'));
  executable = join(temporary, 'parity');
  execFileSync(process.env.SHOWAI_INK_NATIVE_CLANG || 'clang++', ['-std=c++17', '-O2', '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', 'src/surface/ink-kernel/showai_ink.cpp', 'src/surface/ink-kernel/native-parity.cpp', '-o', executable]);
});
afterAll(() => { rmSync(temporary, { recursive: true, force: true }); });
const close = (actual: number, expected: number, tolerance = 1e-9) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)));
function native(ink: any, width: number, pressure: boolean, queries: {x: number; y: number}[], segments: number[][] = []) {
  const mask = ink.mask ?? [], bytes = Buffer.alloc(24 + 64 + ink.samples.length * 72 + mask.length * 56 + queries.length * 16 + segments.length * 40);
  const head = [ink.samples.length, brushes[ink.brush], pressure ? 1 : 0, ink.mask === undefined ? 0xffffffff : mask.length, queries.length, segments.length];
  head.forEach((value, i) => bytes.writeUInt32LE(value, i * 4));
  let offset = 24;
  const double = (value: number) => { bytes.writeDoubleLE(value, offset); offset += 8; };
  [ink.width, width, ...ink.transform].forEach(double);
  ink.samples.flat().forEach(double);
  for (const command of mask) { bytes.writeUInt32LE(commands[command[0]], offset); offset += 8; [...command.slice(1), ...Array(7 - command.length).fill(0)].forEach(double); }
  queries.forEach(point => { double(point.x); double(point.y); }); segments.flat().forEach(double);
  const out = execFileSync(executable, [], { input: bytes, maxBuffer: 128 * 1024 * 1024 });
  expect(out.readUInt32LE(0)).toBe(0);
  const counts = Array.from({ length: 5 }, (_, i) => out.readUInt32LE(4 + i * 4)); offset = 24;
  const values = (count: number, kind: 'double' | 'float' | 'uint' = 'double') => Array.from({ length: count }, () => { const value = kind === 'double' ? out.readDoubleLE(offset) : kind === 'float' ? out.readFloatLE(offset) : out.readUInt32LE(offset); offset += kind === 'double' ? 8 : 4; return value; });
  const bounds = values(4), samples = values(ink.samples.length * 9), points = values(counts[0] * 2), contours = values(counts[1] * 2, 'uint'), vertices = values(counts[2] * 2, 'float'), maskPoints = values(counts[3] * 2), maskContours = values(counts[4] * 2, 'uint');
  const hits = queries.map(() => { const inside = out.readUInt32LE(offset) !== 0, distance = out.readDoubleLE(offset + 8); offset += 16; return { inside, distance }; });
  const segmentHits = values(segments.length, 'uint').map(Boolean);
  expect(offset).toBe(out.byteLength);
  return { bounds, samples, points, contours, vertices, maskPoints, maskContours, hits, segmentHits };
}
const fixtures = () => {
  const result: any[] = [];
  for (const brush of Object.keys(brushes) as ("pen"|"marker"|"pencil"|"monoline")[]) for (const pressure of [false, true]) {
    const ink = createPortableInk([{x: 2, y: 9, pressure: 0.1}, {x: 30, y: 42, pressure: 0.7}, {x: 30, y: 42, pressure: 0.3}, {x: 66, y: -10, pressure: 1}], 7, [120, 120], brush, pressure);
    ink.samples.forEach((sample: number[], i: number) => { sample[3] = i === 1 ? 0 : 2 + i * 2; sample[4] = i === 1 ? 0 : 0.5 + i; sample[7] = -1.7 + i * 0.61; });
    ink.transform = [1.2, -0.3, 0.4, 0.8, -19, 23];
    result.push({ ink, pressure, width: 11.5 });
  }
  return result;
};
describe('compiled shared ink v1', () => {
  it('keeps validation usable in JavaScriptCore without WebAssembly or base64 globals',()=>{
    const bundle=buildSync({entryPoints:['src/surface/portable-ink.mjs'],bundle:true,write:false,format:'iife',globalName:'InkValidation'}).outputFiles[0].text;
    const context:{WebAssembly:undefined;atob:undefined;InkValidation?:any}={WebAssembly:undefined,atob:undefined};
    runInNewContext(bundle,context);
    const ink=createPortableInk([{x:0,y:0},{x:20,y:20}],3,[30,30]);
    expect(context.InkValidation.validatePortableInk(ink)).toBe(ink);
  });
  it('pins the generated Wasm to the authoritative C++ source', async () => {
    const { createHash } = await import('node:crypto');
    for (const [name, hash] of Object.entries(inkKernelProvenance.sourceHashes)) expect(createHash('sha256').update(readFileSync(resolve('src/surface/ink-kernel', name))).digest('hex')).toBe(hash);
  });
  it('matches existing JavaScript geometry, sample resolution, bounds and point hits on native and Wasm', () => {
    for (const { ink, width, pressure } of fixtures()) {
      validatePortableInk(ink);
      const old = portableInkGeometry(ink, width, pressure), prepared = kernel.prepare(ink, width, pressure), geometry = kernel.geometry(ink, width, pressure);
      const queries = Array.from({ length: 80 }, (_, i) => ({ x: (i * 17) % 110 - 30, y: (i * 23) % 110 - 20 }));
      const result = native(ink, width, pressure, queries);
      expect(prepared.contours.length / 2).toBe(old.polygons.length);
      expect(geometry.path).toBe(old.path);
      old.polygons.flat().forEach((point: any, i: number) => { close(prepared.points[i * 2], point.x); close(prepared.points[i * 2 + 1], point.y); close(result.points[i * 2], point.x); close(result.points[i * 2 + 1], point.y); });
      portableInkSamples(ink, width, pressure).flat().forEach((value: number, i: number) => { close(result.samples[i], value); close(kernel.resolveSamples(ink, width, pressure).flat()[i], value); });
      const bounds = portableInkBounds(ink, width, pressure);
      Object.values(bounds).forEach((value, i) => { close(Object.values(prepared.bounds)[i] as number, value as number); close(result.bounds[i], value as number); });
      expect(Array.from(prepared.contours)).toEqual(result.contours);
      prepared.vertices.forEach((value: number, i: number) => close(result.vertices[i], value, 1e-6));
      queries.forEach((point, i) => { const oldHit = portableInkHit(ink, point, width, pressure), hit = kernel.hit(prepared, point); expect(hit.inside).toBe(oldHit.inside); expect(result.hits[i].inside).toBe(oldHit.inside); close(hit.distance, oldHit.distance); close(result.hits[i].distance, oldHit.distance); });
    }
  });
  it('keeps cubic masks, nonzero holes and native mask contours consistent', () => {
    const ink = createPortableInk([{x: 10, y: 50}, {x: 90, y: 50}], 20, [100,100]);
    ink.mask = [['M',0,0],['L',100,0],['Q',120,50,100,100],['C',70,110,30,110,0,100],['Z'],['M',40,30],['L',40,70],['L',60,70],['L',60,30],['Z']];
    const prepared = kernel.prepare(ink), queries = [{x: 20, y: 50},{x: 50,y:50},{x:80,y:50},{x:150,y:50}];
    const result = native(ink, 20, true, queries, [[-10,50,110,50,0],[45,50,55,50,1],[20,0,20,100,1]]);
    expect(Array.from(prepared.mask!.points)).toEqual(result.maskPoints);
    expect(Array.from(prepared.mask!.contours)).toEqual(result.maskContours);
    queries.forEach((point, i) => { const expected=portableInkHit(ink,point), hit=kernel.hit(prepared,point); expect(hit.inside).toBe(expected.inside); expect(result.hits[i].inside).toBe(expected.inside); expect(hit.distance).toBe(expected.distance); });
    expect(result.segmentHits).toEqual([true,false,true]);
    expect(kernel.segmentHit(prepared,{x:-10,y:50},{x:110,y:50},0)).toBe(true);
    expect(kernel.segmentHit(prepared,{x:45,y:50},{x:55,y:50},1)).toBe(false);
  });
  it('incremental chunks concatenate to exactly the same retained geometry', () => {
    const ink = fixtures()[0].ink, all = kernel.prepare(ink);
    const points: number[] = [], vertices: number[] = [], contours: number[] = [];
    for (let i=0;i<ink.samples.length;i++) {
      const chunk=kernel.prepare(ink,ink.width,true,i,1), offset=points.length/2;
      points.push(...chunk.points);vertices.push(...chunk.vertices);
      chunk.contours.forEach((value:number,index:number)=>contours.push(index%2===0?value+offset:value));
    }
    expect(points).toEqual(Array.from(all.points));expect(vertices).toEqual(Array.from(all.vertices));expect(contours).toEqual(Array.from(all.contours));
  });
  it('is bitwise reproducible between native C++ and Wasm for dense rotated pressure input',()=>{
    const ink=createPortableInk(Array.from({length:384},(_,i)=>({x:Math.sin(i*0.23)*800,y:Math.cos(i*0.17)*600,pressure:(i%31)/30})),9,[2000,2000],'pencil');
    ink.samples.forEach((sample:number[],i:number)=>{sample[3]=(i%17)*0.31;sample[4]=(i%13)*0.17;sample[7]=-100+(i*1.713)%200;});
    ink.transform=[0.1234,-0.7654,0.8765,1.2345,-149.75,232.625];
    const prepared=kernel.prepare(ink,17.25,true),result=native(ink,17.25,true,[]);
    expect(Array.from(prepared.points)).toEqual(result.points);
    expect(Array.from(prepared.vertices)).toEqual(result.vertices);
    expect(Object.values(prepared.bounds)).toEqual(result.bounds);
  });
  it('returns explicit capacity errors without partial writes and rejects malformed samples', () => {
    const ink=fixtures()[0].ink;
    expect(()=>kernel.prepare({...ink,samples:[]})).toThrow();
    expect(()=>kernel.prepare({...ink,samples:[[NaN,0,0,1,1,1,1,0,0]]})).toThrow();
    expect(()=>kernel.prepare({...ink,mask:[['C',1,2]]})).toThrow();
    kernel.reset(); const samples=kernel.samples(ink.samples),style=kernel.style(ink,ink.width,true),output=kernel.allocate(16),bounds=kernel.allocate(32);
    new Float64Array(kernel.api.memory.buffer,output,2).set([123,456]);
    expect(kernel.api.sa_ink_build(samples,ink.samples.length,0,ink.samples.length,style,output,1,0,0,0,0,bounds)).toBe(2);
    expect(Array.from(new Float64Array(kernel.api.memory.buffer,output,2))).toEqual([123,456]);
  });
  it('distinguishes no mask from an explicitly empty mask',()=>{
    const ink=createPortableInk([{x:0,y:0},{x:100,y:0}],10,[100,10]);
    expect(kernel.hit(kernel.prepare(ink),{x:50,y:0}).inside).toBe(true);
    ink.mask=[];const prepared=kernel.prepare(ink);
    expect(kernel.hit(prepared,{x:50,y:0})).toEqual({inside:false,distance:Infinity,solid:true});
    expect(kernel.segmentHit(prepared,{x:50,y:-20},{x:50,y:20},20)).toBe(false);
  });
});
