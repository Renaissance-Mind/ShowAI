import {expect,it} from "vitest";
import {CAPACITY,measureContent} from "../portable/capacity.mjs";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {SourceRuntimeOwner,type SourceSnapshotDelta} from "./source-runtime";
import type {ShowDocument} from "../types";
function fixture(){
 const owner=new SourceRuntimeOwner(),document=createResource(blankDocument(),"board") as ShowDocument;
 document.createdAt=document.updatedAt="2026-10-22T00:00:00.000Z";
 (document as any).future={unicode:["é","é"],unknown:{keep:true}};
 const scope={homeId:"saved-witness",projectId:"project",pageId:document.id};
 const seed=owner.execute({kind:"seed",scope,document,proof:"normalized",leaseId:"base"}) as SourceSnapshotDelta;
 const canonical=owner.resolveActualSnapshot(seed.next).document;
 return{owner,scope,seed,canonical};
}
it("uses the same real saved factory with an exactly reconstructed timestamp-only body",()=>{
 const f=fixture(),request={scope:f.scope,base:f.seed.next,updatedAt:"2026-10-22T00:01:00.000Z",leaseId:"saved"};
 const next=f.owner.registerActualSavedMetadata(request),document=f.owner.resolveActualSnapshot(next.next).document;
 expect(document).toEqual({...f.canonical,updatedAt:request.updatedAt});expect(document.content).toBe(f.canonical.content);
 expect((document as any).future).toBe((f.canonical as any).future);expect(next.edits).toEqual([{op:"set",path:["updatedAt"],value:request.updatedAt}]);
 const ordinary=f.owner.registerActualSavedSnapshot({scope:f.scope,base:f.seed.next,document:{...f.canonical,updatedAt:request.updatedAt},leaseId:"ordinary"});
 expect(f.owner.resolveActualSnapshot(ordinary.next).document).toEqual(document);
 expect(f.owner.resolveActualSnapshot(next.next).modelValidated).toBe(true);
});
it("rejects unproved bodies, metadata fields, scope, expired identities and client asserted proof",()=>{
 const f=fixture(),request={scope:f.scope,base:f.seed.next,updatedAt:"2026-10-22T00:01:00.000Z",leaseId:"saved"};
 const draft=f.owner.execute({kind:"draft",base:f.seed.next,transactionId:"foreign",edits:[{op:"set",path:["title"],value:"actual new title"}],leaseId:"draft"}) as SourceSnapshotDelta;
 for(const bad of [{...request,base:draft.next},{...request,updatedAt:"invalid date"},{...request,createdAt:request.updatedAt},{...request,scope:{...f.scope,homeId:"other"}},{...request,base:{...f.seed.next,epoch:"other"}},{...request,document:f.canonical}])expect(()=>f.owner.registerActualSavedMetadata(bad as any)).toThrow();
 expect(()=>f.owner.execute({kind:"savedMetadata",...request,modelValidated:true} as any)).toThrow();
 expect(f.owner.resolveActualSnapshot(f.seed.next).document).toEqual(f.canonical);
 f.owner.execute({kind:"dispose",scope:f.scope});expect(()=>f.owner.registerActualSavedMetadata(request)).toThrow(/expired/);
});
it("retains actual native origin and candidates only through the standard timestamp rule",()=>{
 const f=fixture(),packet={document:f.canonical,baseDocument:f.canonical,pageId:f.scope.pageId,boardId:f.canonical.content.attrs!.id,token:"actual-token",operationIds:[]};
 const pub=f.owner.registerActualNativeJSONIfUnchanged(JSON.stringify({current:f.seed.next,publicationId:"actual-pub",sourceVersion:1,packet,leaseId:"published"}),undefined,f.seed.next)!;
 const saved=f.owner.registerActualSavedMetadata({scope:f.scope,base:pub.next,updatedAt:"2026-10-22T00:00:01Z",leaseId:"saved"});
 expect(f.owner.resolveActualSnapshot(saved.next).nativeOrigin?.publicationId).toBe("actual-pub");expect(saved.inkCandidates).toBe(pub.inkCandidates);
});

it("applies official final capacity to growing/escaped timestamps and leaves its old actual source readable",()=>{
 const f=fixture(),document=structuredClone(f.canonical) as ShowDocument&{padding:string};
 document.updatedAt="2026-10-22";document.padding="";
 document.padding="x".repeat(CAPACITY.pageStructureBytes-measureContent(document).structureBytes);
 const seed=f.owner.execute({kind:"seed",scope:f.scope,document,proof:"normalized",leaseId:"boundary"}) as SourceSnapshotDelta;
 const before=f.owner.resolveActualSnapshot(seed.next).document;
 expect(measureContent(before).structureBytes).toBe(CAPACITY.pageStructureBytes);
 for(const updatedAt of ["2026-10-22T00:00:00.000Z","2026-10-22\t"]){
  expect(Number.isFinite(Date.parse(updatedAt))).toBe(true);
  expect(()=>f.owner.registerActualSavedMetadata({scope:f.scope,base:seed.next,updatedAt,leaseId:"overflow"})).toThrow(/Page structure/);
  expect(f.owner.resolveActualSnapshot(seed.next).document).toBe(before);
 }
 const next=f.owner.registerActualSavedMetadata({scope:f.scope,base:seed.next,updatedAt:"2026-10-23",leaseId:"same-boundary"});
 expect(f.owner.resolveActualSnapshot(next.next).document.updatedAt).toBe("2026-10-23");
},60000);
