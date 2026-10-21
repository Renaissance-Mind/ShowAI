import {expect,it} from "vitest";
import {OwnedSourceSession,sourceSnapshotFor,diffOwnedSource,type SourceRuntimeTransport} from "./source-client";
import {SourceRuntimeOwner,ownSourceValue,cloneSourceValue,type SourceSnapshotDelta} from "./source-runtime";
import {createResource} from "./containers.mjs";
import {blankDocument} from "../core/catalog";
import type {ShowDocument} from "../types";
function fixture(){const owner=new SourceRuntimeOwner(),scopeHome=crypto.randomUUID(),projectId=crypto.randomUUID(),document=createResource(blankDocument(),"board");
 const transport:SourceRuntimeTransport={sourceClientId:crypto.randomUUID(),scope:async(projectId,pageId)=>({homeId:scopeHome,projectId,pageId}),request:async request=>owner.execute(request)};
 return{owner,projectId,document,transport,session:new OwnedSourceSession(projectId,document.id,transport)};
}
it("updates a protected local COW author draft immediately and registers its exact independent body asynchronously",async()=>{
 const {owner,session,document}=fixture(),first=session.replace(document),next=session.replace({...first,title:"Type now",future:{nested:[1,2]}} as ShowDocument);
 expect(session.document).toBe(next);expect(next.title).toBe("Type now");expect(next.content).toBe(first.content);expect(()=>{next.title="illegal"}).toThrow();
 await session.barrier();const ref=await session.reference(next),actual=owner.execute({kind:"resolve",ref}) as {document:ShowDocument};
 expect(actual.document).toEqual(next);expect(actual.document).not.toBe(next);expect(actual.document.content).not.toBe(next.content);
 expect(await sourceSnapshotFor({...next})).toBeNull();expect(await sourceSnapshotFor(next)).toEqual({ref,sourceClientId:session.clientId});await session.dispose();
});
it("does not overwrite N+1 with a normalized result or real saved metadata for N",async()=>{
 const {owner,session,document}=fixture(),initial=session.replace(document);await session.barrier();
 const ref=await session.reference(initial),normalized=await session.normalize(initial);
 const n1=session.replace({...initial,title:"N+1 remains"});expect(session.apply(normalized)).toBeNull();expect(session.document).toBe(n1);
 const actualSaved={...cloneSourceValue(initial),updatedAt:"2026-10-21T22:30:00Z"},saved=owner.registerActualSavedSnapshot({scope:ref.scope,document:actualSaved,base:ref,leaseId:"actual-backend-save"});
 const record=await session.acceptSaved(saved,initial);expect(record.updatedAt).toBe(actualSaved.updatedAt);expect(session.document).toBe(n1);
 await session.barrier();expect(session.document!.title).toBe("N+1 remains");await session.dispose();
});
it("does not let a same-project other view overwrite the document factory's client binding",async()=>{
 const {session,transport,projectId,document}=fixture(),one=session.replace(document);await session.barrier();
 const other=new OwnedSourceSession(projectId,document.id,{...transport,sourceClientId:crypto.randomUUID()}),two=other.replace(one);await other.barrier();
 expect(two).not.toBe(one);expect(two.content).toBe(one.content);expect((await sourceSnapshotFor(one))!.sourceClientId).toBe(session.clientId);expect((await sourceSnapshotFor(two))!.sourceClientId).toBe(other.clientId);
 await other.dispose();expect(await sourceSnapshotFor(two)).toBeNull();expect(await sourceSnapshotFor(one)).not.toBeNull();await session.dispose();
});
it("captures same-object mutable imports again when they change during an actual registration await",async()=>{
 const {session,document}=fixture(),mutable=cloneSourceValue(document),pending=session.captureMutable(()=>mutable);mutable.title="Changed during await";
 const captured=await pending;expect(captured.title).toBe("Changed during await");expect(session.document).toBe(captured);mutable.title="Caller changes after capture";expect(captured.title).toBe("Changed during await");await session.dispose();
});
it("uses identity pruning only for actual owned immutable snapshots, preserving unknown data",()=>{
 const baseline=ownSourceValue({nodes:[{id:"a",payload:{points:Array.from({length:10000},(_,x)=>x)}},{id:"b",value:2}]}),target=ownSourceValue({...baseline,nodes:[baseline.nodes[0],{id:"b",value:3}]});
 expect(diffOwnedSource(baseline,target)).toEqual([{op:"set",path:["nodes",1,"value"],value:3}]);expect(()=>diffOwnedSource({...baseline},target)).toThrow(/owned/);
});
it("owns remote records separately, replaces stable named leases and keeps history generations independent",async()=>{
 const {session,document}=fixture(),current=session.replace(document),record=session.captureExternal(document,"record");
 expect(record).not.toBe(current);expect(session.document).toBe(current);await session.barrier();
 const firstRef=await session.reference(record);const nextRecord=session.captureExternal({...document,title:"Remote record"},"record");
 await session.reference(nextRecord);expect(session.document).toBe(current);expect(await sourceSnapshotFor(record)).toEqual({ref:firstRef,sourceClientId:session.clientId});
 await Promise.all([session.retainHistory([current],"surface"),session.retainHistory([record,nextRecord],"save-captured")]);
 await session.releaseLease("save-captured");expect(session.document).toBe(current);await session.dispose();
});
it("retires its actual transport even after registration failed and preserves the original failure",async()=>{
 const {owner,document,projectId}=fixture();let closed=false;
 const actualFailure=new Error("Actual JSON owner rejects this registration");
 const transport:SourceRuntimeTransport={scope:async(projectId,pageId)=>({homeId:"failure-home",projectId,pageId}),request:async request=>{
  if(request.kind==="seed"){owner.execute({...request,scope:{...request.scope,pageId:"wrong-source"}});throw actualFailure}return owner.execute(request);
 },close:()=>{closed=true}};
 const session=new OwnedSourceSession(projectId,document.id,transport);session.replace(document);
 await expect(session.barrier()).rejects.toThrow(/another page/);await expect(session.dispose()).rejects.toThrow(/another page/);expect(closed).toBe(true);expect(session.disposed).toBe(true);
});
it("keeps distinct semantic undo edges on one owned body and rebases generic history using real owner refs",async()=>{
 const {owner,session,document}=fixture(),base=session.replace(document),own=session.replace({...base,title:"Own"});await session.barrier();
 const semantic=session.snapshot(own);expect(semantic).not.toBe(own);expect(semantic.content).toBe(own.content);expect(await session.reference(semantic)).toEqual(await session.reference(own));
 const incoming=session.replace({...own,comments:[{id:"remote",text:"Foreign",createdAt:own.createdAt,resolved:false}],futureRoot:{keep:true}} as ShowDocument);await session.barrier();
 const result=await session.rebaseHistory(own,incoming,[base],"actual-history");
 expect(result[0].document.title).toBe(base.title);expect(result[0].document.comments![0].text).toBe("Foreign");expect((result[0].document as any).futureRoot).toEqual({keep:true});expect(session.document).toBe(incoming);
 expect((owner.execute({kind:"resolve",ref:await session.reference(result[0].document)}) as {document:ShowDocument}).document).toEqual(result[0].document);await session.dispose();
});
it("accepts a real normalized host projection while retaining author N+1 and complete unknown fields",async()=>{
 const {owner,session,document}=fixture(),captured=session.replace(document);await session.barrier();const base=await session.reference(captured);
 const body=cloneSourceValue(captured);body.comments=[{id:"host",text:"Actual host",createdAt:body.createdAt,resolved:false}];
 const projection=owner.normalizeActualProjection({base,document:body,leaseId:"actual-host-output"});
 const pending=session.replace({...captured,title:"N+1 typed",unknownRoot:{retained:"local"}} as ShowDocument);
 const accepted=await session.acceptProjection(projection,captured);
 expect(accepted.title).toBe("N+1 typed");expect(accepted.comments![0].text).toBe("Actual host");expect((accepted as any).unknownRoot).toEqual({retained:"local"});expect(pending.comments).toEqual(captured.comments);expect(session.document).toBe(accepted);await session.dispose();
});

it("rejects forged delta bodies even when an attacker copies a real issued owner reference",async()=>{
 const {owner,session,document}=fixture(),current=session.replace(document);await session.barrier();const ref=await session.reference(current);
 const actual=owner.execute({kind:"normalize",ref,leaseId:"real-owner"}) as SourceSnapshotDelta;
 const issued=await session.normalize(current);expect(()=>issued.edits!.push({op:"set",path:["title"],value:"Tampered transport"})).toThrow();expect(()=>{issued.next.snapshotId="forged"}).toThrow();
 expect(()=>session.apply({...actual,edits:[{op:"set",path:["title"],value:"Forged UI body"}]})).toThrow(/actual owner transport/);
 const saved=await session.acceptSaved({...actual,edits:[{op:"set",path:["title"],value:"Forged UI body"}]},current);
 expect(saved.title).toBe(current.title);expect((await sourceSnapshotFor(saved))!.ref).toEqual(actual.next);await session.dispose();
});
