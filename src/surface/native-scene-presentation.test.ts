import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Drawing} from './Drawing';
import {SurfaceContent} from './SurfaceContent';
import {ObjectContext,type ObjectActions} from './SurfaceObject';
import {NativeInkPreview} from './NativeInkPreview';
import {createPortableInk} from './portable-ink.mjs';
import {createResource} from './containers.mjs';
import {blankDocument} from '../core/catalog';
import type {ShowDocument} from '../types';
import fixture from './native-ink-fixture.json';
import {build} from 'esbuild';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const context=(nativeScene:boolean):ObjectActions=>({nativeScene,scale:1,selected:null,select:()=>{},readOnly:false,revealAll:true,revealed:new Set()});
const portable=()=>({type:'drawing',attrs:{id:'portable',name:'Editable stroke',tool:'pen',color:'#245ad4',strokeWidth:2,extent:[120,70],points:[{x:2,y:2},{x:80,y:30}],ink:createPortableInk([{x:2,y:2,pressure:.3},{x:80,y:30,pressure:.8}],2,[120,70])}});
const shape=()=>({type:'drawing',attrs:{id:'shape',tool:'rectangle',color:'#222222',fillColor:'#eeeeee',strokeWidth:2,extent:[150,80],points:[{x:0,y:0},{x:150,y:80}],label:'Shape label',labelSize:22}});
function render(nativeScene:boolean){
 const document=createResource(blankDocument(),'board') as ShowDocument;
 document.content.content=[portable(),structuredClone(fixture.node),shape()];
 document.layout={portable:{x:10,y:20,width:240,height:140,rotation:15},'native-ink':fixture.frame,shape:{x:300,y:40,width:150,height:80}};
 return renderToStaticMarkup(createElement(ObjectContext.Provider,{value:context(nativeScene)},createElement(SurfaceContent,{document,container:document.content,renderContent:()=>createElement('p',null,'Rich content')})));
}
it('keeps precise layout/extent/identities and shape labels while native owns paint',()=>{
 const markup=render(true);
 expect(markup.match(/data-native-measurement="true"/g)).toHaveLength(3);
 expect(markup).toContain('data-native-ink-id="portable"');expect(markup).toContain('viewBox="0 0 120 70"');
 expect(markup).toContain('left:10px;top:20px;width:240px');expect(markup).toContain('height:140px');expect(markup).toContain('rotate(15deg)');
 expect(markup).toContain('Shape label');expect(markup).toContain('font-size:22px');expect(markup).not.toMatch(/<(path|rect|ellipse|image)\b/);
});
it('renders the complete browser/desktop geometry and archive preview when ownership is absent or ends',()=>{
 for(const markup of [render(false),render(true),render(false)].filter((_,i)=>i!==1)){
  expect(markup).toContain('data-portable-ink="1"');expect(markup).toMatch(/<path\b/);expect(markup).toMatch(/<rect\b/);expect(markup).toMatch(/<image\b/);expect(markup).not.toContain('data-native-measurement');
 }
 const standalone=renderToStaticMarkup(createElement(Drawing,{node:portable()}));expect(standalone).toContain('data-portable-ink="1"');
});
it('avoids hidden archive image resources but keeps the same intrinsic SVG measurements',()=>{
 const raw=fixture.node.attrs.data.nativeInk,ink={...raw,extent:raw.extent as [number,number]};
 const native=renderToStaticMarkup(createElement(ObjectContext.Provider,{value:context(true)},createElement(NativeInkPreview,{ink})));
 const browser=renderToStaticMarkup(createElement(NativeInkPreview,{ink}));
 expect(native).toContain(`viewBox="0 0 ${ink.extent[0]} ${ink.extent[1]}"`);expect(native).toContain('role="img"');expect(native).not.toContain('<image');expect(browser).toContain('<image');
});

it('renders the actual native-owned portable object with WebAssembly unavailable',async()=>{
 const parent=process.env.SHOWAI_TEST_HOME??tmpdir();await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'native-presentation-'));
 try{
  const entry=join(root,'entry.ts'),output=join(root,'entry.cjs'),repo=process.cwd();
  const source=`import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {Drawing} from ${JSON.stringify(join(repo,'src/surface/Drawing.tsx'))};
import {SurfaceObject,ObjectContext} from ${JSON.stringify(join(repo,'src/surface/SurfaceObject.tsx'))};
if(typeof WebAssembly!=='undefined')throw new Error('This verification requires WebAssembly unavailable');
const node=${JSON.stringify(portable())},value={nativeScene:process.env.INK_NATIVE_OWNED!=="0",scale:1,selected:null,select(){},readOnly:false,revealAll:true,revealed:new Set()};
const html=renderToStaticMarkup(createElement(ObjectContext.Provider,{value},createElement(SurfaceObject,{id:'portable',name:'Editable stroke',drawing:true,drawingNode:node,positioned:true,fixedHeight:true,frame:{x:10,y:20,width:240,height:140}},createElement(Drawing,{node}))));
if(!html.includes('viewBox="0 0 120 70"')||!html.includes('data-native-measurement="true"')||/<(path|image)\\b/.test(html))throw new Error('Native measurement output differs');
console.log('native-owned portable render passed without WebAssembly');`;
  await writeFile(entry,source);await build({entryPoints:[entry],outfile:output,bundle:true,platform:'node',format:'cjs',jsx:'automatic',nodePaths:[join(repo,'node_modules')],loader:{'.css':'empty'},logLevel:'silent'});
  const result=await promisify(execFile)(process.execPath,['--jitless',output]);
  expect(result.stdout.trim()).toBe('native-owned portable render passed without WebAssembly');
  await expect(promisify(execFile)(process.execPath,['--jitless',output],{env:{...process.env,INK_NATIVE_OWNED:'0'}})).rejects.toThrow('WebAssembly');
 }finally{await rm(root,{recursive:true,force:true})}
},30000);
