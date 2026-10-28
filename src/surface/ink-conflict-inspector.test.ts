import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import InkConflictInspector from './InkConflictInspector';
import {createResource} from './containers.mjs';
import {blankDocument} from '../core/catalog';
import {addNode} from './editing';
import {createPortableInk} from './portable-ink.mjs';
import {canonicalInkJSON,installInkDigestProvider,InkOperationReplica,createInkOperation} from './ink-operations.mjs';
import {inkWireConflicts,inkWireResolutionCandidates,stampInkDocument,inkCheckpointFromDocument,inkWireDocumentFromCheckpoint} from './ink-wire.mjs';
import {mergePageContent} from '../core/page-merge-model';
import type {ShowDocument} from '../types';
function source(){let document=createResource(blankDocument(),'board') as ShowDocument;document=addNode(document,{type:'drawing',attrs:{id:'stroke',tool:'pen',color:'#111111',strokeWidth:2,extent:[100,60],points:[{x:0,y:0},{x:80,y:40}],ink:createPortableInk(Array.from({length:2000},(_,i)=>({x:i%100,y:i%60,pressure:.5})),2,[100,60])}},
 {x:0,y:0,width:100,height:60},document.content.attrs!.id) as ShowDocument;return stampInkDocument(document,undefined,{actor:'seed',sequence:1});}
const ink=(document:ShowDocument)=>document.content.content![0].attrs!.ink;
// Validation verifies every stored placement variant, a small ordering anchor
// rather than geometry or DOM, so only the other hashed sources are counted.
const placementVariant=(source:string)=>/^\{"after":(?:null|"[^"]*"),"before":(?:null|"[^"]*"),"parentId":"[^"]*"\}$/.test(source);
function counted(){const inputs:string[]=[];installInkDigestProvider(source=>{if(!placementVariant(source))inputs.push(source);return createHash('sha256').update(source,'utf8').digest('hex')});inputs.length=0;return inputs;}
afterEach(()=>installInkDigestProvider(null));
it('does not hash uncontested canonical geometry for an empty conflict inspector',()=>{
 const document=source(),inputs=counted();expect(inkWireConflicts(document)).toEqual([]);expect(inkWireResolutionCandidates(document)).toEqual([]);expect(inputs).toEqual([]);
});
it('same-value concurrent heads are not competing values and need no geometry rehash',()=>{
 const document=source(),boardId=document.content.attrs!.id as string,replica=new InkOperationReplica({checkpoint:inkCheckpointFromDocument(document,boardId)});
 for(const actor of ['first','second'])replica.append([createInkOperation({actor,sequence:1,pageId:document.id,boardId,parents:['seed:1'],changes:[{kind:'edit',strokeId:'stroke',patch:{color:'#111111'}}]})]);
 const projected=inkWireDocumentFromCheckpoint(document,boardId,replica.checkpoint()),inputs=counted();
 expect(projected.content.attrs!.inkState.strokes.stroke.fields.color).toHaveLength(2);expect(inkWireConflicts(projected)).toEqual([]);expect(inputs).toEqual([]);
});
it('real color conflicts still verify retained source and expose every actual candidate',()=>{
 const base=source(),left=structuredClone(base),right=structuredClone(base);left.content.content![0].attrs!.color='#ff0000';right.content.content![0].attrs!.color='#0000ff';
 const document=mergePageContent(base,stampInkDocument(left,base,{actor:'left',sequence:1}),stampInkDocument(right,base,{actor:'right',sequence:1})).document;
 const inputs=counted(),conflicts=inkWireConflicts(document),candidates=inkWireResolutionCandidates(document);
 expect(conflicts).toHaveLength(1);expect(conflicts[0]).toMatchObject({strokeId:'stroke',field:'color',retained:true});
 expect(candidates[0].candidates.map(candidate=>candidate.value).sort()).toEqual(['#0000ff','#ff0000']);expect(inputs).toContain(canonicalInkJSON(ink(document)));
});
it('malformed state is rejected even when no divergent heads would otherwise be visible',()=>{
 const document=source();document.content.attrs!.inkState.strokes.stroke.fields.color=[];counted();
 expect(()=>inkWireConflicts(document)).toThrow('head');
});
it('the normal missing-host path has no DOM or geometry hashes when there are no conflicts',()=>{
 const document=source(),inputs=counted();
 expect(renderToStaticMarkup(createElement(InkConflictInspector,{document,getDocument:()=>document,onResolve:()=>{}}))).toBe('');expect(inputs).toEqual([]);
});
it('the normal missing-host path still rejects malformed wire state',()=>{
 const document=source();document.content.attrs!.inkState.strokes.stroke.fields.color=[];counted();
 expect(()=>renderToStaticMarkup(createElement(InkConflictInspector,{document,getDocument:()=>document,onResolve:()=>{}}))).toThrow('head');
});
it('shows every actual retained color choice inline without an inspector host',()=>{
 const base=source(),left=structuredClone(base),right=structuredClone(base);left.content.content![0].attrs!.color='#ff0000';right.content.content![0].attrs!.color='#0000ff';
 const document=mergePageContent(base,stampInkDocument(left,base,{actor:'left',sequence:1}),stampInkDocument(right,base,{actor:'right',sequence:1})).document;
 const inputs=counted(),html=renderToStaticMarkup(createElement(InkConflictInspector,{document,projectId:'actual-project',getDocument:()=>document,onResolve:()=>{}}));
 expect(html).toContain('surface-inspector ink-conflict-inspector');expect(html).toContain('<summary>');expect(html).toContain('open=""');
 expect(html).toContain('#0000ff');expect(html).toContain('#ff0000');expect(html).toContain('left');expect(html).toContain('right');
 expect(html.match(/<button/g)).toHaveLength(2);expect(html).not.toContain('disabled=""');expect(inputs).toContain(canonicalInkJSON(ink(document)));
 const reading=renderToStaticMarkup(createElement(InkConflictInspector,{document,projectId:'actual-project',readOnly:true,getDocument:()=>document,onResolve:()=>{}}));
 expect(reading).toContain('<fieldset disabled=""');expect(reading.match(/<button/g)).toHaveLength(2);
 const noProject=renderToStaticMarkup(createElement(InkConflictInspector,{document,getDocument:()=>document,onResolve:()=>{}}));
 expect(noProject).toContain('<fieldset disabled=""');
});
it('a placement-only conflict remains structural and does not rehash geometry',()=>{
 const document=source();document.content.attrs!.inkState.strokes.stroke.unplaced=true;
 const inputs=counted();expect(inkWireConflicts(document)).toEqual([{boardId:document.content.attrs!.id,strokeId:'stroke',field:'placement',retained:false,reason:'Ink placement still requires structural resolution.'}]);expect(inputs).toEqual([]);
});
it('genuine conflicting heads without their canonical source are not falsely declared retained',()=>{
 const base=source(),left=structuredClone(base),right=structuredClone(base);left.content.content![0].attrs!.color='#ff0000';right.content.content![0].attrs!.color='#0000ff';
 const document=mergePageContent(base,stampInkDocument(left,base,{actor:'left',sequence:1}),stampInkDocument(right,base,{actor:'right',sequence:1})).document;
 document.content.content=[];delete document.layout!.stroke;counted();
 expect(inkWireConflicts(document)).toMatchObject([{strokeId:'stroke',field:'color',retained:false}]);expect(inkWireResolutionCandidates(document)).toEqual([]);
});
