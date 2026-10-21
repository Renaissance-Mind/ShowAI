import {expect,it} from "vitest";
import {parseArtifact,parseArtifactWithValidatedDocument} from "./validation.mjs";
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
