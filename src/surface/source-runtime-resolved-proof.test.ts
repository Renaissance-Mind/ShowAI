import {expect,it} from "vitest";
import {blankDocument} from "../core/catalog";
import {createResource} from "./containers.mjs";
import {SourceRuntimeOwner,type SourceSnapshotDelta} from "./source-runtime";
import type {ShowDocument} from "../types";
function setup(){
 const document=createResource(blankDocument(),"board") as ShowDocument;
 document.createdAt=document.updatedAt="2026-10-22T00:00:00.000Z";
 const owner=new SourceRuntimeOwner(),scope={homeId:"real-home",projectId:"real-project",pageId:document.id};
 const seed=owner.execute({kind:"seed",scope,document,proof:"normalized",leaseId:"seed"}) as SourceSnapshotDelta;
 return{owner,scope,seed,document:owner.resolveActualSnapshot(seed.next).document};
}
it("resolves actual model and origin proof with the exact immutable source while public resolve stays data only",()=>{
 const f=setup(),boardId=f.document.content.attrs!.id as string;
 const packet={document:f.document,baseDocument:f.document,pageId:f.scope.pageId,boardId,token:"real-token",operationIds:[]};
 const result=f.owner.registerActualNativeJSONIfUnchanged(JSON.stringify({current:f.seed.next,publicationId:"actual-publication",sourceVersion:1,packet,leaseId:"published"}),undefined,f.seed.next)!;
 const snapshot=f.owner.resolveActualSnapshot(result.next);
 expect(snapshot.modelValidated).toBe(true);expect(snapshot.nativeOrigin?.publicationId).toBe("actual-publication");
 expect(snapshot.document).toBe((f.owner.execute({kind:"resolve",ref:result.next}) as any).document);
 expect(Object.keys(f.owner.execute({kind:"resolve",ref:result.next}))).toEqual(["ref","document"]);
 const timestamp=f.owner.execute({kind:"draft",base:result.next,edits:[{op:"set",path:["updatedAt"],value:"2026-10-22T00:00:01.000Z"}],transactionId:"timestamp",leaseId:"timestamp"}) as SourceSnapshotDelta;
 const timed=f.owner.resolveActualSnapshot(timestamp.next);expect(timed.ref.kind).toBe("draft");expect(timed.modelValidated).toBe(true);expect(timed.nativeOrigin?.publicationId).toBe("actual-publication");
 const changed=f.owner.execute({kind:"draft",base:timestamp.next,edits:[{op:"set",path:["futureRoot"],value:{"é":1,"é":2}}],transactionId:"real-edit",leaseId:"changed"}) as SourceSnapshotDelta;
 const foreign=f.owner.resolveActualSnapshot(changed.next);expect(foreign.modelValidated).toBe(false);expect(foreign.nativeOrigin).toBeNull();
 expect(timed.document).not.toHaveProperty("futureRoot");expect(foreign.document).toHaveProperty("futureRoot");
});
it("does not mint private proof from client fields and rejects expired, ABA, scope and kind mismatches",()=>{
 const f=setup();
 const draft=f.owner.execute({kind:"seed",scope:f.scope,document:structuredClone(f.document),modelValidated:true,nativeOrigin:{publicationId:"forged"},leaseId:"draft"} as any) as SourceSnapshotDelta;
 expect(f.owner.resolveActualSnapshot(draft.next).modelValidated).toBe(false);
 for(const ref of [{...draft.next,kind:"normalized"},{...draft.next,epoch:"other"},{...draft.next,scope:{...f.scope,projectId:"other"}}])expect(()=>f.owner.resolveActualSnapshot(ref as any)).toThrow();
 expect(()=>f.owner.execute({kind:"resolveActualSnapshot",ref:draft.next} as any)).toThrow();
 f.owner.execute({kind:"dispose",scope:f.scope});expect(()=>f.owner.resolveActualSnapshot(draft.next)).toThrow(/expired/);
 const next=f.owner.execute({kind:"seed",scope:f.scope,document:f.document,leaseId:"new"}) as SourceSnapshotDelta;
 expect(next.next.snapshotId).not.toBe(draft.next.snapshotId);expect(()=>f.owner.resolveActualSnapshot(draft.next)).toThrow();
});
