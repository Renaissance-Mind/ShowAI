import {CAPACITY,assertContent,measureContent} from "./capacity.mjs";
import {expect,it} from "vitest";
import {parseArtifact,parseArtifactConsumingDocument,parseArtifactWithValidatedDocument} from "./validation.mjs";
import {SourceRuntimeOwner,cloneSourceValue,type SourceSnapshotDelta} from "../surface/source-runtime";
import {blankDocument} from "../core/catalog";
import {createResource} from "../surface/containers.mjs";
import type {ShowDocument} from "../types";

it("keeps complete artifact wrapper validation around an actual registry-held body",()=>{
 const document=createResource(blankDocument(),"board") as ShowDocument,owner=new SourceRuntimeOwner();
 const source=owner.execute({kind:"seed",scope:{homeId:"real-home",projectId:"real-project",pageId:document.id},document,proof:"normalized",leaseId:"current"}) as SourceSnapshotDelta;
 const held=owner.normalizedDocumentMatching({ref:source.next,document:cloneSourceValue(document)})!;expect(held).not.toBeNull();
 const artifact={format:"showai",version:3,document:held,presentation:"reading",selection:{blockIds:[held.content.attrs!.id]}};
 expect(parseArtifactWithValidatedDocument(artifact,held)).toEqual(parseArtifact(artifact));
 for(const patch of [{format:"invalid"},{version:99},{version:1},{presentation:"invalid"},{selection:{blockIds:["missing"]}},{selection:{blockIds:[held.content.attrs!.id,held.content.attrs!.id]}},{components:[{}]},{components:Array.from({length:101},()=>({}))},{remoteComponents:[{}]}]){
  expect(()=>parseArtifact({...artifact,...patch})).toThrow();expect(()=>parseArtifactWithValidatedDocument({...artifact,...patch},held)).toThrow();
 }
 expect(()=>parseArtifactWithValidatedDocument({...artifact,document:cloneSourceValue(held)},held)).toThrow(/actual registered body/);
 const changed=cloneSourceValue(held);changed.createdAt="invalid";expect(owner.normalizedDocumentMatching({ref:source.next,document:changed})).toBeNull();expect(()=>parseArtifact({...artifact,document:changed})).toThrow(/ISO/);
});
it("stores the public parser's complete canonical defaults in factory proofs",()=>{
 const owner=new SourceRuntimeOwner(),fixed="2026-10-21T00:00:00.000Z";
 const missingTitle={id:"minimal-proof-no-title",content:{type:"doc",content:[]},createdAt:fixed,updatedAt:fixed};
 expect(()=>parseArtifact({format:"showai",version:1,document:missingTitle})).toThrow(/title/);
 expect(()=>owner.execute({kind:"seed",scope:{homeId:"real-home",projectId:"real-project",pageId:missingTitle.id},document:missingTitle,proof:"normalized"} as any)).toThrow(/title/);
 const minimal={...missingTitle,id:"minimal-proof-defaults",title:"Minimal",futureRoot:{values:["é","é",null]},comments:[{id:"retained-comment",text:"Comment",createdAt:fixed,resolved:false,futureComment:{keep:true}}]};
 const parsed=parseArtifact({format:"showai",version:1,document:minimal});
 const source=owner.execute({kind:"seed",scope:{homeId:"real-home",projectId:"real-project",pageId:minimal.id},document:minimal as unknown as ShowDocument,proof:"normalized",leaseId:"minimal"}) as SourceSnapshotDelta;
 const held=(owner.execute({kind:"resolve",ref:source.next}) as {document:ShowDocument}).document;
 const trusted=parseArtifactWithValidatedDocument({format:"showai",version:1,document:held},held);
 expect(trusted).toEqual(parsed);expect(held.createdAt).toBe(fixed);expect(held.updatedAt).toBe(fixed);expect((held as any).futureRoot).toEqual(minimal.futureRoot);expect((held.comments![0] as any).futureComment).toEqual({keep:true});
});

function capacityDocument(unit="x"){
 const fixed="2026-10-21T00:00:00.000Z",document={id:"canonical-capacity",title:"Boundary",content:{type:"doc",content:[]},createdAt:fixed,updatedAt:fixed,padding:""};
 return fillCapacity(document,unit);
}
function fillCapacity<T extends {padding:string}>(document:T,unit="x"):T{
 document.padding="";const remaining=CAPACITY.pageStructureBytes-measureContent(document).structureBytes,bytes=measureContent(unit).structureBytes-2;
 document.padding=unit.repeat(Math.floor(remaining/bytes))+"x".repeat(remaining%bytes);expect(measureContent(document).structureBytes).toBe(CAPACITY.pageStructureBytes);return document;
}
it("rejects canonical default growth at the exact structure boundary in both public parsers",()=>{
 for(const parser of [parseArtifact,parseArtifactConsumingDocument])for(const unit of ["x",'中\n"']){
  const document=capacityDocument(unit);expect(()=>assertContent(document)).not.toThrow();
  expect(()=>parser({format:"showai",version:1,document})).toThrow(/Page structure/);
 }
},30000);
it("rejects structural ID, layout and view filling that grows a boundary document",()=>{
 for(const parser of [parseArtifact,parseArtifactConsumingDocument]){
  const document=fillCapacity({...blankDocument(),id:"canonical-structure-capacity",createdAt:"2026-10-21T00:00:00.000Z",updatedAt:"2026-10-21T00:00:00.000Z",content:{type:"surface",content:[{type:"paragraph",content:[{type:"text",text:"Complete the actual missing structure"}]}]},layout:{},views:{initial:null,saved:[],readingOrder:[]},padding:""});
  expect(()=>assertContent(document)).not.toThrow();expect(()=>parser({format:"showai",version:2,document})).toThrow(/Page structure/);
 }
},30000);
it("accepts a legitimately shrinking canonical template and retains deduplicated resources",()=>{
 const url="data:image/png;base64,AAEC",fixed="2026-10-21T00:00:00.000Z";
 for(const parser of [parseArtifact,parseArtifactConsumingDocument]){
  const document=fillCapacity({id:"shrinking-template-capacity",title:"Keep unknown fields",content:{type:"doc",content:[]},createdAt:fixed,updatedAt:fixed,futureRoot:{resources:[url,url],unicode:["é","é"]},comments:[{id:"comment",text:"Keep",createdAt:fixed,resolved:false,futureComment:{resource:url}}],templateContext:{format:1,system:{kind:"template",id:"system-presentation",version:"1.0.0",integrity:"sha256-"+"0".repeat(64),scope:"builtin"},templates:[],extraPadding:"x".repeat(1024),extraResource:url},padding:""});
  const canonical=parser({format:"showai",version:1,document});
  expect(measureContent(canonical.document).structureBytes).toBeLessThan(CAPACITY.pageStructureBytes);expect(measureContent(canonical.document)).toMatchObject({resourceCount:1,resourceBytes:3});expect(()=>assertContent(canonical.document)).not.toThrow();
  expect((canonical.document as any).futureRoot).toEqual(document.futureRoot);expect((canonical.document.comments![0] as any).futureComment).toEqual({resource:url});expect(parseArtifact(canonical)).toEqual(canonical);
 }
},30000);
