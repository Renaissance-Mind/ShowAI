import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankDocument } from "./catalog";
import { InkOperationJournal } from "./ink-operation-journal";
import { InkOperationReplica, canonicalInkJSON, inkOperationDigest } from "../surface/ink-operations.mjs";
import { inkCheckpointFromDocument, inkWireHydrateAuthorBaseline, inkWireAuthorReceipt, inkWireEditPlans, inkWireImportCheckpoints, inkWireDocumentFromCheckpoint, stampInkDocument } from "../surface/ink-wire.mjs";
import { createResource } from "../surface/containers.mjs";
import { addNode } from "../surface/editing";
import { mergePageContent } from "./page-merge-model";
import { createPortableInk } from "../surface/portable-ink.mjs";
import type { ShowDocument } from "../types";
const roots:string[]=[],journals:InkOperationJournal[]=[];
async function open(){const parent=process.env.SHOWAI_TEST_HOME??tmpdir();await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,"ink-author-receipt-"));roots.push(root);const journal=await InkOperationJournal.open(root);journals.push(journal);return journal;}
afterEach(async()=>{journals.splice(0).forEach(journal=>journal.close());for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const node=(id:string)=>({type:"drawing",attrs:{id,tool:"pen",color:"#111111",strokeWidth:2,extent:[40,30],points:[{x:1,y:2},{x:20,y:12}],ink:createPortableInk([{x:1,y:2},{x:20,y:12}],2,[40,30])}});
const frame={x:10,y:20,width:40,height:30};
function source(){let document=createResource(blankDocument(),"board") as ShowDocument;document=addNode(document,node("base"),frame,document.content.attrs!.id) as ShowDocument;return stampInkDocument(document,undefined,{actor:"seed",sequence:1});}
const scopeOf=(document:ShowDocument)=>({pageId:document.id,boardId:document.content.attrs!.id as string});

it("chains width then color intent using the real receipt while excluding unseen native stroke registers",async()=>{
  const base=source(),scope=scopeOf(base),journal=await open();journal.importCheckpoint(scope,inkCheckpointFromDocument(base,scope.boardId));
  const nativeC=journal.appendLocal({...scope,parents:["seed:1"],changes:[{kind:"create",strokeId:"native-C",node:node("native-C"),layout:{...frame,x:500}}]});
  const rawA=structuredClone(base);rawA.content.content![0].attrs!.strokeWidth=10;
  const planA=inkWireEditPlans(base,rawA)[0],opA=journal.appendLocal({pageId:base.id,...planA});
  expect(opA.parents).toContain(nativeC.id);
  const checkpointA=journal.read(scope).checkpoint!,receiptA=inkWireAuthorReceipt(base,rawA,[opA],checkpointA);
  expect(receiptA.content.content!.map(node=>node.attrs!.id)).toEqual(["base"]);
  expect(receiptA.content.attrs!.inkState.strokes["native-C"]).toBeUndefined();
  expect(receiptA.content.attrs!.inkState.strokes.base.fields.strokeWidth[0][0]).toBe(opA.id);
  expect(receiptA.content.attrs!.inkState.contexts[opA.id]).toEqual(checkpointA.known[opA.id].clock);
  expect(receiptA.content.attrs!.inkState.digests[opA.id]).toBe(inkOperationDigest(opA));
  const rawB=structuredClone(rawA);rawB.content.content![0].attrs!.color="#ff0000";
  const planB=inkWireEditPlans(receiptA,rawB);
  expect(planB).toHaveLength(1);expect(planB[0].changes).toEqual([{kind:"edit",strokeId:"base",patch:{color:"#ff0000"}}]);
  expect(planB.flatMap(plan=>plan.changes).some(change=>change.strokeId==="native-C")).toBe(false);
  for(const incoming of inkWireImportCheckpoints(receiptA,rawB))journal.importCheckpoint({pageId:base.id,boardId:incoming.boardId},incoming.checkpoint);
  const opB=journal.appendLocal({pageId:base.id,...planB[0]}),receiptB=inkWireAuthorReceipt(receiptA,rawB,[opB],journal.read(scope).checkpoint!);
  expect(receiptB.content.content!).toHaveLength(1);expect(receiptB.content.content![0].attrs).toMatchObject({strokeWidth:10,color:"#ff0000"});
  expect(receiptB.content.attrs!.inkState.strokes.base.fields.strokeWidth[0][0]).toBe(opA.id);
  expect(journal.read(scope).materialization!.strokes.find(stroke=>stroke.id==="native-C")!.deleted).toBe(false);
  const undoB=new InkOperationReplica({checkpoint:journal.read(scope).checkpoint!}).compensationPlan(opB,journal.undoRecord(scope,opB.id)!);
  journal.appendLocal({...scope,parents:undoB.parents,changes:undoB.changes});
  const undoA=new InkOperationReplica({checkpoint:journal.read(scope).checkpoint!}).compensationPlan(opA,journal.undoRecord(scope,opA.id)!);
  expect(undoA.changes).toEqual([{kind:"edit",strokeId:"base",patch:{strokeWidth:2}}]);
  journal.appendLocal({...scope,parents:undoA.parents,changes:undoA.changes});
  expect(journal.read(scope).materialization!.strokes.find(stroke=>stroke.id==="base")!.node.attrs).toMatchObject({strokeWidth:2,color:"#111111"});
  expect(journal.read(scope).materialization!.strokes.find(stroke=>stroke.id==="native-C")!.deleted).toBe(false);
  expect(inkWireAuthorReceipt(base,rawA,[opA],checkpointA)).toEqual(receiptA);
});
it("keeps a UI creation and its coalesced deletion separate from unseen native creation",async()=>{
  const base=source(),scope=scopeOf(base),journal=await open();journal.importCheckpoint(scope,inkCheckpointFromDocument(base,scope.boardId));
  journal.appendLocal({...scope,parents:["seed:1"],changes:[{kind:"create",strokeId:"native-C",node:node("native-C"),layout:{...frame,x:500}}]});
  const rawA=addNode(base,node("ui-A"),{...frame,x:200},scope.boardId) as ShowDocument;
  const opA=journal.appendLocal({pageId:base.id,...inkWireEditPlans(base,rawA)[0]});
  const receiptA=inkWireAuthorReceipt(base,rawA,[opA],journal.read(scope).checkpoint!);
  const rawB=structuredClone(rawA);rawB.content.content=rawB.content.content!.filter(node=>node.attrs!.id!=="ui-A");delete rawB.layout!["ui-A"];
  const plans=inkWireEditPlans(receiptA,rawB);expect(plans[0].changes).toEqual([{kind:"delete",strokeId:"ui-A"}]);
  const opB=journal.appendLocal({pageId:base.id,...plans[0]}),receiptB=inkWireAuthorReceipt(receiptA,rawB,[opB],journal.read(scope).checkpoint!);
  expect(receiptB.content.content!.map(node=>node.attrs!.id)).toEqual(["base"]);
  expect(receiptB.content.attrs!.inkState.strokes["ui-A"].fields.alive[0][0]).toBe(opB.id);
  expect(journal.read(scope).materialization!.strokes.find(stroke=>stroke.id==="native-C")!.deleted).toBe(false);
});
it("rejects wrong source identity, scope, hidden operation payload, mismatched intent and missing coverage",async()=>{
  const base=source(),scope=scopeOf(base),journal=await open();journal.importCheckpoint(scope,inkCheckpointFromDocument(base,scope.boardId));
  const nativeC=journal.appendLocal({...scope,parents:["seed:1"],changes:[{kind:"create",strokeId:"native-C",node:node("native-C"),layout:frame}]});
  const raw=structuredClone(base);raw.content.content![0].attrs!.strokeWidth=10;
  const op=journal.appendLocal({pageId:base.id,...inkWireEditPlans(base,raw)[0]}),checkpoint=journal.read(scope).checkpoint!;
  const edited=structuredClone(op);edited.changes=[{kind:"edit",strokeId:"base",patch:{strokeWidth:11}}];
  expect(()=>inkWireAuthorReceipt(base,raw,[edited],checkpoint)).toThrow("committed source");
  const other=structuredClone(raw);other.id="other";expect(()=>inkWireAuthorReceipt(base,other,[op],checkpoint)).toThrow("scope");
  expect(()=>inkWireAuthorReceipt(base,raw,[nativeC,op],checkpoint)).toThrow("visible source");
  expect(()=>inkWireAuthorReceipt(base,raw,[],checkpoint)).toThrow("omits");
  const mismatch=structuredClone(raw);mismatch.content.content![0].attrs!.strokeWidth=12;expect(()=>inkWireAuthorReceipt(base,mismatch,[op],checkpoint)).toThrow("visible source");
  const context=structuredClone(checkpoint);context.known[op.id].clock.seed=2;expect(()=>inkWireAuthorReceipt(base,raw,[op],context)).toThrow("context differs");
  expect(canonicalInkJSON(journal.read(scope).checkpoint)).toBe(canonicalInkJSON(checkpoint));
});
it("returns only the latest author branch rather than accumulating history times Board payload",async()=>{
  const base=source(),scope=scopeOf(base),journal=await open();journal.importCheckpoint(scope,inkCheckpointFromDocument(base,scope.boardId));
  journal.appendLocal({...scope,parents:["seed:1"],changes:[{kind:"create",strokeId:"native-C",node:node("native-C"),layout:frame}]});
  let receipt=base,raw=structuredClone(base),firstBytes=0;
  for(let index=0;index<30;index++){
    const draft=structuredClone(raw);draft.content.content![0].attrs![index%2 ? "color":"strokeWidth"]=index%2 ? (index%4===1 ? "#ff0000":"#0000ff"):3+index;
    const plan=inkWireEditPlans(receipt,draft)[0],actual=journal.appendLocal({pageId:base.id,...plan});
    receipt=inkWireAuthorReceipt(receipt,draft,[actual],journal.read(scope).checkpoint!);raw=draft;
    if(index===2)firstBytes=canonicalInkJSON(receipt).length;
    expect(receipt.content.content).toHaveLength(1);
    expect(Object.keys(receipt.content.attrs!.inkState.contexts).length).toBeLessThanOrEqual(3);
  }
  expect(journal.operations(scope)).toHaveLength(31);
  expect(canonicalInkJSON(receipt).length).toBeLessThan(firstBytes+500);
  expect(receipt.content.attrs!.inkState.strokes["native-C"]).toBeUndefined();
});

it("imports a field not covered by the author branch even when its dot is inherited in that branch's global clock", async()=>{
  const base=source(),scope=scopeOf(base),journal=await open();journal.importCheckpoint(scope,inkCheckpointFromDocument(base,scope.boardId));
  const native=journal.appendLocal({...scope,parents:["seed:1"],changes:[{kind:"edit",strokeId:"base",patch:{color:"#ff0000"}}]});
  const raw=structuredClone(base);raw.content.content![0].attrs!.strokeWidth=10;
  const authored=journal.appendLocal({pageId:base.id,...inkWireEditPlans(base,raw)[0]});
  const receipt=inkWireAuthorReceipt(base,raw,[authored],journal.read(scope).checkpoint!);
  expect(receipt.content.attrs!.inkState.contexts[authored.id][native.actor]).toBe(authored.sequence);
  const projected=inkWireDocumentFromCheckpoint(raw,scope.boardId,journal.read(scope).checkpoint!);
  expect(projected.content.content![0].attrs!.color).toBe("#ff0000");
  expect(inkWireEditPlans(receipt,projected)).toEqual([]);
});

it("hydrates an acknowledged placement predecessor after a separately stamped native stroke, without rewriting source",async()=>{
  const base=source(),scope=scopeOf(base),journal=await open();journal.importCheckpoint(scope,inkCheckpointFromDocument(base,scope.boardId));
  const raw=structuredClone(base);
  raw.content.content!.push({type:"drawing",attrs:{id:"rectangle",tool:"rectangle",color:"#111111",strokeWidth:2,points:[{x:0,y:0},{x:80,y:60}]}});
  raw.layout!.rectangle={x:120,y:80,width:80,height:60};
  const plan=inkWireEditPlans(base,raw)[0],op=journal.appendLocal({pageId:base.id,...plan});
  const receipt=inkWireAuthorReceipt(base,raw,[op],journal.read(scope).checkpoint!);
  journal.appendLocal({...scope,parents:journal.read(scope).checkpoint!.frontier,changes:[{kind:"create",strokeId:"native-next",node:node("native-next"),layout:{...frame,x:500},placement:{parentId:scope.boardId,after:"rectangle",before:null}}]});
  const mixed=inkWireDocumentFromCheckpoint(raw,scope.boardId,journal.read(scope).checkpoint!);
  mixed.content.attrs!.inkState.strokes.base.fields.placement=structuredClone(base.content.attrs!.inkState.strokes.base.fields.placement);
  mixed.content.attrs!.inkState.strokes.base.variants.placement=structuredClone(base.content.attrs!.inkState.strokes.base.variants.placement);
  const before=structuredClone(mixed);
  expect(inkWireEditPlans(mixed,mixed)).toEqual([]);
  const restored=inkWireHydrateAuthorBaseline(mixed,{[scope.boardId]:receipt.content.attrs!.inkState});
  expect(mixed).toEqual(before);
  expect(restored.layout).toEqual(mixed.layout);
  expect(restored.content.content).toEqual(mixed.content.content);
  expect(inkWireEditPlans(restored,restored)).toEqual([]);
  expect(restored.content.attrs!.inkState.strokes["native-next"]).toEqual(mixed.content.attrs!.inkState.strokes["native-next"]);
  const shapeOnly=structuredClone(mixed);shapeOnly.content.content!.find(value=>value.attrs!.id==="rectangle")!.attrs!.color="#ff0000";
  expect(inkWireEditPlans(restored,shapeOnly)).toEqual([]);
  const carried=inkWireAuthorReceipt(restored,shapeOnly,[],journal.read(scope).checkpoint!);
  expect(inkWireEditPlans(carried,carried)).toEqual([]);
});
it("rejects a predecessor receipt that cannot account for an unstamped visible edit",()=>{
  const base=source(),changed=structuredClone(base);changed.content.content![0].attrs!.color="#ff0000";
  const before=structuredClone(changed);
  expect(()=>inkWireHydrateAuthorBaseline(changed,{[base.content.attrs!.id as string]:base.content.attrs!.inkState})).toThrow("confirmed predecessor");
  expect(changed).toEqual(before);
});

it("leaves Boards with no stamped predecessor state unchanged",()=>{
  const base=source();
  expect(inkWireHydrateAuthorBaseline(base,{[base.content.attrs!.id as string]:null})).toEqual(base);
});

it("retains authored placement bounds when another generic shape enters the interval, while detecting a real move",async()=>{
  const initial=source(),scope=scopeOf(initial);
  const raw=structuredClone(initial),ink=raw.content.content![0];
  const shape=(id:string)=>({type:"drawing",attrs:{id,tool:"rectangle",color:"#111111",strokeWidth:2,points:[{x:0,y:0},{x:50,y:50}]}});
  raw.content.content=[shape("left"),ink,shape("right")];raw.layout!.left={...frame,x:100};raw.layout!.right={...frame,x:200};
  const base=stampInkDocument(raw,initial,{actor:"ordering",sequence:1}),journal=await open();
  journal.importCheckpoint(scope,inkCheckpointFromDocument(base,scope.boardId));
  const projected=inkWireDocumentFromCheckpoint(base,scope.boardId,journal.read(scope).checkpoint!);
  const inserted=structuredClone(projected);inserted.content.content!.splice(2,0,shape("concurrent"));inserted.layout!.concurrent={...frame,x:300};
  expect(inkWireEditPlans(inserted,inserted)).toEqual([]);
  const imported=inkCheckpointFromDocument(inserted,scope.boardId);
  expect(imported.strokes.find(stroke=>stroke.id==="base")!.registers.placement[0].value).toEqual({parentId:scope.boardId,after:"left",before:"right"});
  const merged=mergePageContent(projected,inserted,projected).document;
  expect(Object.keys(merged.content.attrs!.inkState.contexts).some(dot=>dot.startsWith("legacy-"))).toBe(false);
  const moved=structuredClone(inserted),children=moved.content.content!;children.splice(children.findIndex(node=>node.attrs!.id==="base"),1);children.push(ink);
  expect(inkWireEditPlans(inserted,moved)[0].changes).toContainEqual({kind:"edit",strokeId:"base",patch:{placement:{parentId:scope.boardId,after:"right",before:null}}});
  const stamped=stampInkDocument(moved,inserted,{actor:"explicit-move",sequence:1});
  expect(inkWireEditPlans(stamped,stamped)).toEqual([]);
  expect(stamped.content.attrs!.inkState.strokes.base.fields.placement[0][0]).toBe("explicit-move:1");
});
