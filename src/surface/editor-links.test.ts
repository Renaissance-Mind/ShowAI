import { expect, test } from "vitest";
import { repairEditorLinks } from "./editor-links.mjs";
import { blankDocument } from "../core/catalog";
import { validateDocument } from "../portable/validation.mjs";

test("nested rich text links retain every word and safe marks while unsafe targets cannot execute", () => {
  const source = blankDocument();
  source.content.content = [
    {
      type: "widget",
      attrs: {
        id: "nested-text",
        kind: "text",
        data: {
          format: "richtext",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Kept text",
                    marks: [
                      { type: "bold" },
                      { type: "link", attrs: { href: "javascript:alert(1)" } },
                    ],
                  },
                  {
                    type: "text",
                    text: "Web",
                    marks: [
                      {
                        type: "link",
                        attrs: { href: " https://example.com/research " },
                      },
                    ],
                  },
                  {
                    type: "text",
                    text: "Relative",
                    marks: [{ type: "link", attrs: { href: "../paper.md" } }],
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ];
  const original = structuredClone(source);
  const result = repairEditorLinks(source);
  expect(result.repairs).toHaveLength(3);
  expect(source).toEqual(original);
  const content =
    result.document.content.content![0].attrs!.data.content.content[0].content;
  expect(content.map((node: { text: string }) => node.text).join(" ")).toBe(
    "Kept text Web Relative",
  );
  expect(content[0].marks).toEqual([{ type: "bold" }]);
  expect(content[1].marks[0].attrs.href).toBe("https://example.com/research");
  expect(content[2].marks).toBeUndefined();
  expect(() => validateDocument(result.document)).not.toThrow();
  expect(repairEditorLinks(result.document).document).toBe(result.document);
});

import {createResource} from './containers.mjs';
import {addNode} from './editing';
import {createPortableInk} from './portable-ink.mjs';
import {stampInkDocument} from './ink-wire.mjs';
import type {ShowDocument} from '../types';
import fixture from './native-ink-fixture.json';
const unsafe=()=>({type:'text',text:'Kept visible text',marks:[{type:'bold'},{type:'link',attrs:{href:'javascript:alert(1)'}}]});
function inkBoard(count=32){
 const points=Array.from({length:count},(_,i)=>({x:i%30,y:i%20,pressure:.5})),ink=createPortableInk(points,2,[40,30]);
 // These are real version1 fields produced by historical native upcasts.
 ink.seed=42;ink.createdAt=123;ink.sourceDrawing=fixture.node.attrs.data.nativeInk.drawing;
 const configuration={version:1,mode:0,width:2,creationZoom:1,fitTolerance:.2,flattenTolerance:.1,positionWindow:.01,jitterWindow:.01,forceBackward:0,forceForward:0,forceTime:0,minimumFraction:.1,maximumFraction:1,curveBlend:.5,estimateTimeout:.01};
 const input={format:'showai-input-v1',sourceID:'source',configuration,raw:points.map((point,i)=>[point.x,point.y,i/120,.5,0,1.5,0,0,0,0]),curves:[{points:[1,2,5,3,15,8,20,10],firstRaw:0,lastRaw:count-1,steps:10}],fragmentCount:2,compositeOpacity:1,composite:'single-opacity-coverage'};
 let document=createResource(blankDocument(),'board') as ShowDocument;
 document=addNode(document,{type:'drawing',attrs:{id:'long',tool:'pen',color:'#111111',strokeWidth:2,extent:[40,30],points:[{x:0,y:0},{x:20,y:10}],ink,inkFragments:[ink],inkInput:input}},
  {x:10,y:20,width:40,height:30},document.content.attrs!.id) as ShowDocument;
 return stampInkDocument(document,undefined,{actor:'seed',sequence:1});
}
test('closed typed stroke data stays identical while real malformed rich-text links are repaired',()=>{
 const source=inkBoard(),attrs=source.content.content![0].attrs!,state=source.content.attrs!.inkState;
 source.content.content!.push({type:'richText',attrs:{id:'rich'},content:[{type:'paragraph',content:[unsafe()]}]});source.layout!.rich={x:0,y:80,width:400,height:100};source.surfaceViews![source.content.attrs!.id].readingOrder.push('rich');
 const result=repairEditorLinks(source),next=result.document.content.content![0].attrs!;
 expect(result.repairs).toHaveLength(1);expect(next).toBe(attrs);expect(next.ink).toBe(attrs.ink);expect(next.ink.samples).toBe(attrs.ink.samples);expect(next.inkFragments).toBe(attrs.inkFragments);expect(next.inkInput).toBe(attrs.inkInput);expect(result.document.content.attrs!.inkState).toBe(state);
 expect(result.document.content.content![1].content![0].content![0].marks).toEqual([{type:'bold'}]);expect(()=>validateDocument(result.document)).not.toThrow();
});
test('actual public legacy archives and version1 archive groups retain original opaque bytes',()=>{
 const source=createResource(blankDocument(),'board') as ShowDocument;
 const legacy=structuredClone(fixture.node),nativeInk=legacy.attrs.data.nativeInk;
 const portable=createPortableInk([{x:1,y:2},{x:20,y:10}],2,[40,30]);
 const group={type:'region',attrs:{id:'group',inkArchiveGroup:{version:1,extent:[40,30],sourceDrawing:nativeInk.drawing}},content:[{type:'drawing',attrs:{id:'child',tool:'pen',color:'#111111',strokeWidth:2,extent:[40,30],points:[{x:1,y:2},{x:20,y:10}],ink:portable}}]};
 source.content.content=[legacy,group,{type:'image',attrs:{id:'inline-native',nativeInk}},{type:'richText',attrs:{id:'link'},content:[{type:'paragraph',content:[unsafe()]}]}];
 const result=repairEditorLinks(source);
 expect(result.repairs).toHaveLength(1);expect(result.document.content.content![0]).toBe(legacy);expect(result.document.content.content![1]).toBe(group);expect(result.document.content.content![2].attrs!.nativeInk).toBe(nativeInk);
 expect(group.attrs.inkArchiveGroup.sourceDrawing).toBe(nativeInk.drawing);
});
test('unknown formats and additional payload keys retain the original link traversal',()=>{
 for(const change of [(ink:Record<string,any>)=>{ink.format='showai-ink-future'},(ink:Record<string,any>)=>{ink.extra={content:[unsafe()]}}]){
  const source=inkBoard(),ink=source.content.content![0].attrs!.ink;change(ink);ink.samples[0][0]={content:[unsafe()]};
  const result=repairEditorLinks(source),next=result.document.content.content![0].attrs!.ink;
  expect(result.repairs.length).toBeGreaterThan(0);expect(next.samples[0][0].content[0].marks).toEqual([{type:'bold'}]);
 }
});
test('arbitrary widget data is not a drawing model even when its keys and format imitate one',()=>{
 const source=blankDocument(),ink=createPortableInk([{x:1,y:2},{x:20,y:10}],2,[40,30]);
 const custom={...ink,samples:[unsafe()]};
 source.content.content=[{type:'widget',attrs:{id:'custom',kind:'custom-component',data:{ink:custom,template:'original-template',source:{id:'original-source'},nested:{type:'drawing',attrs:{ink:custom}}}}}];
 const result=repairEditorLinks(source),data=result.document.content.content![0].attrs!.data;
 expect(result.repairs).toHaveLength(2);expect(data.ink.samples[0].marks).toEqual([{type:'bold'}]);expect(data.nested.attrs.ink.samples[0].marks).toEqual([{type:'bold'}]);expect(data.template).toBe('original-template');expect(data.source).toBe(source.content.content![0].attrs!.data.source);
});
test('nested Pages and string-backed widget rich text still repair every real link',()=>{
 const source=createResource(blankDocument(),'board') as ShowDocument;
 source.content.content=[{type:'surface',attrs:{id:'page',kind:'page'},content:[{type:'richText',attrs:{id:'rich'},content:[{type:'paragraph',content:[unsafe()]}]},{type:'widget',attrs:{id:'widget',kind:'text',data:{format:'richtext',content:'[Widget words](javascript:alert(1))'}}}]}];
 const result=repairEditorLinks(source),children=result.document.content.content![0].content!;
 expect(result.repairs).toHaveLength(2);expect(children[0].content![0].content![0].marks).toEqual([{type:'bold'}]);expect(children[1].attrs!.data.content.content[0].content[0].text).toBe('Widget words');expect(children[1].attrs!.data.content.content[0].content[0].marks).toBeUndefined();
});
test('opaque link repair does not validate or admit malformed numeric ink',()=>{
 const source=inkBoard(),ink=source.content.content![0].attrs!.ink;ink.samples[0][0]='invalid coordinate';
 const result=repairEditorLinks(source);expect(result.document).toBe(source);expect(result.repairs).toEqual([]);expect(()=>validateDocument(result.document)).toThrow(/sample/);
});
test('actual traversal work is bounded by model structure rather than unrelated dense samples',()=>{
 const visits:number[]=[],opaque:number[]=[];
 for(const count of [32,20000]){
  const source=inkBoard(count),diagnostics={visitedValues:0,opaqueFields:0},result=repairEditorLinks(source,diagnostics);
  expect(result.document).toBe(source);expect(result.repairs).toEqual([]);visits.push(diagnostics.visitedValues);opaque.push(diagnostics.opaqueFields);
 }
 expect(visits[1]).toBe(visits[0]);expect(opaque).toEqual([4,4]);expect(visits[1]).toBeLessThan(150);
});

import {inkInputConfiguration} from './ink-kernel/compiled-ink-input.mjs';
const cubicSource=()=>({format:'showai-ink-v2',geometryVersion:1,brushVersion:1,brush:'pen',strokeCount:1,width:2,opacity:1,extent:[40,30],transform:[1,0,0,1,0,0],outlineTolerance:.0025,segments:[{points:[[1,2],[10,20],[20,4]],radius:[1,1]}],capture:{format:'showai-input-capture-v1',sourceID:'identity-not-a-link',configuration:inkInputConfiguration({width:2}),raw:[[1,2,0,.5,0,1.5,1,0,0,0],[20,4,.01,.5,0,1.5,2,0,0,0]]}});
test('only typed drawing cubic ink is opaque; capture identities and source geometry remain unchanged',()=>{
 const source=createResource(blankDocument(),'board') as ShowDocument,ink=cubicSource();source.content.content=[{type:'drawing',attrs:{id:'v2',tool:'pen',color:'#111111',strokeWidth:2,extent:[40,30],points:[{x:1,y:2},{x:20,y:4}],ink}},{type:'richText',attrs:{id:'rich'},content:[{type:'paragraph',content:[unsafe()]}]}];
 const result=repairEditorLinks(source,{visitedValues:0,opaqueFields:0});expect(result.repairs).toHaveLength(1);expect(result.document.content.content![0].attrs!.ink).toBe(ink);expect(ink.capture.sourceID).toBe('identity-not-a-link');expect(()=>validateDocument(result.document)).not.toThrow();
});
test('coincidentally named cubic formats, unknown fields and malformed typed values retain actual link scanning',()=>{
 for(const change of [(i:any)=>{i.extra=unsafe()},(i:any)=>{i.segments[0].points[0][0]=unsafe()},(i:any)=>{i.capture.raw[0][0]=unsafe()},(i:any)=>{i.capture.predicted=[unsafe()]}]){const source=blankDocument(),ink=cubicSource();change(ink);source.content.content=[{type:'drawing',attrs:{id:'v2',ink}}];expect(repairEditorLinks(source).repairs.length).toBeGreaterThan(0);}
 const source=blankDocument(),ink={...cubicSource(),extra:unsafe()};source.content.content=[{type:'widget',attrs:{id:'widget',kind:'custom',data:{ink,nested:{type:'drawing',attrs:{ink}}}}}];expect(repairEditorLinks(source).repairs).toHaveLength(2);
});
