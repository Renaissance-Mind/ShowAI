import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalInkJSON,inkOperationDigest,installInkDigestProvider,InkOperationReplica,createInkOperation} from './ink-operations.mjs';
import {createPortableInk} from './portable-ink.mjs';
import {blankDocument} from '../core/catalog';
import {createResource} from './containers.mjs';
import {addNode} from './editing';
import {canCommitPageMerge,mergePageContent} from '../core/page-merge-model';
import {inkCheckpointFromDocument,inkWireDeltaFromReplica,inkWireDocumentFromCheckpoint,stampInkDocument} from './ink-wire.mjs';
import type {ShowDocument} from '../types';
const sha=(source:string)=>createHash('sha256').update(source,'utf8').digest('hex');
afterEach(()=>installInkDigestProvider(null));
const values:unknown[]=['','abc','\0','中文🤔','é','e\u0301','\ud800','\udc00','x\ud800y\udc00z','\ud800\ud800','\udc00\udc00','a'.repeat(55),'a'.repeat(56),'a'.repeat(63),'a'.repeat(64),'a'.repeat(65),'🤔'.repeat(16),'🤔'.repeat(16)+'x',0,-0,1e-8,1e21,{z:'é',a:[-0,1e-8,1e21,'\ud800','\0',Number.MIN_VALUE,Number.MAX_VALUE]}];
it.each(['portable','platform'] as const)('matches actual SHA256 UTF8 bytes and canonical numbers through %s',mode=>{
 if(mode==='platform')installInkDigestProvider(sha);
 for(const value of values){const source=typeof value==='string'?value:canonicalInkJSON(value);expect(inkOperationDigest(value)).toBe(sha(source));}
 expect(inkOperationDigest('é')).not.toBe(inkOperationDigest('e\u0301'));
 expect(inkOperationDigest('\ud800')).toBe(inkOperationDigest('\ufffd'));
 expect(()=>inkOperationDigest({invalid:NaN})).toThrow('finite JSON');
});
it('performs startup validation before replacing an installed provider',()=>{
 const seen:string[]=[];installInkDigestProvider(source=>{seen.push(source);return sha(source)});
 for(const source of ['','abc','\0','中文🤔','\ud800','\udc00','é','e\u0301','a'.repeat(63),'a'.repeat(64),'a'.repeat(65)])expect(seen).toContain(source);
 expect(()=>installInkDigestProvider(()=> '0'.repeat(64))).toThrow('known-vector');
 const count=seen.length;expect(inkOperationDigest('still-active')).toBe(sha('still-active'));expect(seen.length).toBe(count+1);
 installInkDigestProvider(null);inkOperationDigest('portable-active');expect(seen.length).toBe(count+1);
});
it('rejects normalization, invalid digests and asynchronous providers explicitly',()=>{
 expect(()=>installInkDigestProvider(source=>sha(source.normalize('NFC')))).toThrow('known-vector');
 expect(()=>installInkDigestProvider(source=>sha(source).toUpperCase())).toThrow('64 lowercase');
 expect(()=>installInkDigestProvider((()=>Promise.resolve('digest')) as unknown as (source:string)=>string)).toThrow('synchronously');
 expect(()=>installInkDigestProvider(undefined as unknown as null)).toThrow('function or null');
});
it('exposes installation and later execution errors without a hidden fallback',()=>{
 const failure=new Error('Provider rejected the requested operation');
 expect(()=>installInkDigestProvider(()=>{throw failure})).toThrow(failure);
 let behavior='valid';installInkDigestProvider(source=>{if(behavior==='throw')throw failure;if(behavior==='invalid')return '';return sha(source)});
 behavior='throw';expect(()=>inkOperationDigest({canonical:'source'})).toThrow(failure);
 behavior='invalid';expect(()=>inkOperationDigest('source')).toThrow('64 lowercase');
});
it('keeps actual wire merges, compact variants, replay and sparse projections byte-identical',()=>{
 let fixture=createResource(blankDocument(),'board') as ShowDocument;
 const owner=fixture.content.attrs!.id as string,node={type:'drawing',attrs:{id:'stroke',tool:'pen',color:'#111111',strokeWidth:2,extent:[40,30],points:[{x:0,y:0},{x:10,y:10}],ink:createPortableInk([{x:0,y:0},{x:10,y:10}],2,[40,30])}};
 fixture=addNode(fixture,node,{x:0,y:0,width:40,height:30},owner) as ShowDocument;
 function pipeline(){
  let base=structuredClone(fixture);const boardId=base.content.attrs!.id as string;
  base=stampInkDocument(base,undefined,{actor:'seed',sequence:1});
  const left=structuredClone(base),right=structuredClone(base);left.content.content![0].attrs!.color='#ff0000';right.content.content![0].attrs!.color='#0000ff';
  const a=stampInkDocument(left,base,{actor:'ipad',sequence:1}),b=stampInkDocument(right,base,{actor:'web',sequence:1});
  const merged=mergePageContent(base,a,b);expect(canCommitPageMerge(merged),JSON.stringify(merged.conflicts)).toBe(true);
  const replica=new InkOperationReplica({checkpoint:inkCheckpointFromDocument(merged.document,boardId)});
  const operation=createInkOperation({pageId:base.id,boardId,actor:'device',sequence:1,parents:replica.materialize([]).frontier,changes:[{kind:'edit',strokeId:'stroke',patch:{strokeWidth:9}}]});
  const prepared=replica.append([operation]),checkpoint=replica.checkpoint(),projected=inkWireDocumentFromCheckpoint(merged.document,boardId,checkpoint),delta=inkWireDeltaFromReplica(replica,['stroke']);
  return canonicalInkJSON({base,a,b,merged,operation,prepared,checkpoint,projected,delta});
 }
 const pure=pipeline();installInkDigestProvider(sha);expect(pipeline()).toBe(pure);
});
