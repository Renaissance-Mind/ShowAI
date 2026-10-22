import {PortableCubicContext} from "./PortableCubicContext";
import {HistoryTravelQueue,observeHistoryTravels} from "./history-travel-queue";
import {PortableInputScope,type PortableInputReservation} from "./portable-input-scope";
import {appendNewPortableInk,appendPortableInkFromSource} from "./portable-ink-append.mjs";
import {sourceSessionFor,diffOwnedSource,type OwnedSourceSession} from "./source-client";
import {measureNativeSync} from "./native-perf";
import { rebaseHistorySnapshots } from "./history-rebase";
import { applyInkUpdate, InkEditConflict } from "./inline-ink";
import type {NativeAuthorMutation} from "./inline-ink";
import { SurfaceGeometryStore } from "./geometry-store";
import type { EditorControls } from "./EditorControls";
import { insertComponentAtText } from "./component-insertion";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ShowDocument, ContainerDocument } from "../types";
import { Widget } from "../components/blocks/Widget";
import { ContainerRuntime, type ContainerViewState } from "./ContainerRuntime";
import { isResource, upgradeResource } from "./containers.mjs";
import { editNode, replaceChildren, detachBlock } from "./editing";
import {
  findSurfaceNode,
  reconcileSurface,
  isReconciledSurface,
} from "./document.mjs";
import type { ContentRenderProps } from "./SurfaceContent";
import { toPageEditor, fromPageEditor, fromPageEditorDraft } from "./page-content";
import { PageModuleContext, pageEditorNodes } from "./PageEditorNodes";
import { mergePageContent, canCommitPageMerge } from "../core/page-merge-model";
import InkConflictInspector from "./InkConflictInspector";
import {nativeContentHistoryStages} from "./native-content-history";
import {nativeDocumentContentKey,nativeDocumentBodiesEqual,mergeNativeDocumentReceipt,mergeNativeProjectionReceipt} from "./native-document-content";

import {appendNativeInkHistoryGroups,nativeInkHistoryGroups,unregisteredNativeInkHistoryAction,type NativeInkHistoryAction,type NativeInkHistoryGroup} from "./native-ink-history";

const contentKey = (document: ShowDocument) =>
  JSON.stringify([
    document.content,
    document.layout,
    document.surfaceViews,
    document.icon,
  ]);
export interface SurfaceEditorState {
  runtime?: ContainerViewState;
  document?: ContainerDocument;
  history?: {
    past: ContainerDocument[];
    future: ContainerDocument[];
    group: string;
    at: number;
    inkActions?: Map<ContainerDocument,NativeInkHistoryAction>;
  };
}
const retainedHistoryLeases=new WeakMap<SurfaceEditorState,string>();
function SurfaceEditor({
  document: input,
  onChange,
  header,
  revealId,
  onRevealHandled,
  readOnly = false,
  onActiveSurfaceChange,
  onControlsChange,
  retainedState,
  inspectorHost,
  inlineInkProjectId,
  onInkSave,
  onPublishedInkSave,
  onOpenEmbeddedSurface,
}: {
  document: ShowDocument;
  onChange: (document: ShowDocument) => void;
  header?: ReactNode;
  readOnly?: boolean;
  revealId?: string | null;
  onRevealHandled?: () => void;
  onActiveSurfaceChange?: (id: string) => void;
  onControlsChange?: (controls: EditorControls | null) => void;
  retainedState?: SurfaceEditorState;
  inspectorHost?: HTMLElement | null;
  inlineInkProjectId?: string;
  onInkSave?: () => Promise<boolean>;
  onPublishedInkSave?: () => Promise<boolean>;
  onOpenEmbeddedSurface?: (id:string) => void;
}) {
  const document = useMemo<ContainerDocument>(
    () => {
      if(isResource(input))return input;
      const upgraded=upgradeResource(input),owner=sourceSessionFor(input);
      return (owner?owner.replace(upgraded):upgraded) as ContainerDocument;
    },
    [input],
  );
  const geometry = useMemo(() => new SurfaceGeometryStore(), [document.id]);
  const restored =
    retainedState?.document?.id === document.id && sourceSessionFor(retainedState.document)===sourceSessionFor(document) ? retainedState : undefined;
  if (retainedState && !retainedState.runtime) retainedState.runtime = {};
  const current = useRef<ContainerDocument>(restored?.document ?? document);
  const authorBaseline=useRef<ShowDocument>(document);
  const lastAuthorMutation=useRef<string|undefined>(undefined);
  const geometrySettlement = useRef({ generation: 0, first: 0, second: 0 });
  useEffect(
    () => () => {
      cancelAnimationFrame(geometrySettlement.current.first);
      cancelAnimationFrame(geometrySettlement.current.second);
    },
    [],
  );
  const history = useRef<{
    past: ContainerDocument[];
    future: ContainerDocument[];
    group: string;
    at: number;
    inkActions?: Map<ContainerDocument,NativeInkHistoryAction>;
  }>(restored?.history ?? { past: [], future: [], group: "", at: 0 });
  const pendingInkEdges=useRef(new Map<ContainerDocument,string>());
  const inkActions=useRef(history.current.inkActions??new Map<ContainerDocument,NativeInkHistoryAction>());
  useLayoutEffect(
    () => () => {
      if (!retainedState) return;
      retainedState.document = current.current;
      if(travelQueue.pending){
        // A remount must observe the same history consumption when the old
        // accepted callback eventually finishes; a copied stack would be stale.
        history.current.inkActions=inkActions.current;
        retainedState.history=history.current;
        return;
      }
      retainedState.history = {
        ...history.current,
        past: [...history.current.past],
        future: [...history.current.future],
        inkActions: inkActions.current,
      };
    },
    [retainedState],
  );
  const [, refresh] = useState(0);
  const [insertedId, setInsertedId] = useState<string | null>(null);
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  const latestReadOnly = useRef(readOnly);
  latestReadOnly.current = readOnly;
  const historyLease=useRef((()=>{if(retainedState){let name=retainedHistoryLeases.get(retainedState);if(!name){name=`surface-history-${crypto.randomUUID()}`;retainedHistoryLeases.set(retainedState,name)}return name;}return `surface-history-${crypto.randomUUID()}`})());
  const historyTail=useRef<Promise<void>>(Promise.resolve());
  const historyFailure=useRef<unknown>(undefined);
  const historyReplacements=useRef(new WeakMap<ContainerDocument,ContainerDocument>());
  const pinHistory=useCallback((session:OwnedSourceSession|undefined=sourceSessionFor(current.current))=>{
    if(!session)return;
    const captured=[...new Set([...history.current.past,...history.current.future])];
    const work=session.retainHistory(captured,historyLease.current);
    void work.catch(error=>{historyFailure.current=error});
  },[]);
  const rebaseHistory=useCallback((before:ContainerDocument,incoming:ContainerDocument)=>{
    const session=sourceSessionFor(incoming);
    if(!session||sourceSessionFor(before)!==session){rebaseHistorySnapshots(history.current,inkActions.current,before,incoming);return;}
    if(diffOwnedSource(before,incoming).every(edit=>edit.path.length===1&&edit.path[0]==="updatedAt"))return;
    const entries=[...new Set([...history.current.past,...history.current.future])].filter(entry=>inkActions.current.get(entry)?.kind!=="native-ink");
    if(!entries.length)return;
    const name=`${historyLease.current}:rebase-${crypto.randomUUID()}`;
    const inputs=session.retainHistory([before,incoming,...entries],`${name}:inputs`);
    const work=historyTail.current.then(async()=>{
      await inputs;
      const resolve=(entry:ContainerDocument)=>{let next=historyReplacements.current.get(entry);while(next){entry=next;next=historyReplacements.current.get(entry)}return entry;};
      const present=entries.map(resolve).filter(entry=>history.current.past.includes(entry)||history.current.future.includes(entry));
      const projections=await session.rebaseHistory(before,incoming,present,name);
      if(session.disposed||current.current.id!==incoming.id)return;
      const replacement=new Map<ContainerDocument,ContainerDocument|null>();
      for(const value of projections){
        const old=value.before as ContainerDocument,action=inkActions.current.get(old);
        if(!history.current.past.includes(old)&&!history.current.future.includes(old))continue;
        const pending=pendingInkEdges.current.get(old);
        const next=value.unchanged&&!action&&!pending?null:value.document as ContainerDocument;
        pendingInkEdges.current.delete(old);if(next&&pending)pendingInkEdges.current.set(next,pending);
        replacement.set(old,next);if(next)historyReplacements.current.set(old,next);inkActions.current.delete(old);if(next&&action)inkActions.current.set(next,action);
      }
      const apply=(values:ContainerDocument[])=>values.flatMap(value=>replacement.has(value)?replacement.get(value)?[replacement.get(value)!]:[]:[value]);
      history.current.past=apply(history.current.past);history.current.future=apply(history.current.future);history.current.group="";history.current.at=0;
      await session.retainHistory([...new Set([...history.current.past,...history.current.future])],historyLease.current);
      await session.releaseLease(name);await session.releaseLease(`${name}:inputs`);
    });
    historyTail.current=work;void work.catch(error=>{historyFailure.current=error});
  },[]);
  useEffect(()=>()=>{
    if(retainedState)return;
    const owner=sourceSessionFor(current.current);if(!owner||owner.disposed)return;
    void historyTail.current.then(()=>owner.releaseLease(historyLease.current)).catch(error=>{console.error("Source history retirement failed",error)});
  },[retainedState]);
  const reservePortable=useRef<PortableInputReservation>(()=>{throw new Error("Portable input reservation is not installed")});
  const portableScope=useMemo(()=>new PortableInputScope(options=>reservePortable.current(options),sourceSessionFor(document)),[document.id,sourceSessionFor(document)]);
  const travelQueue=useMemo(()=>new HistoryTravelQueue(sourceSessionFor(document)),[document.id,sourceSessionFor(document)]);
  useEffect(()=>{const owner=sourceSessionFor(document);if(owner)return observeHistoryTravels(owner,()=>refresh(value=>value+1))},[travelQueue]);
  const travelMount=useRef(0),travelActive=useRef(travelQueue);travelActive.current=travelQueue;
  useEffect(()=>{const generation=++travelMount.current;return()=>{queueMicrotask(()=>{if(travelActive.current!==travelQueue||travelMount.current===generation)void travelQueue.close().catch(error=>{console.error("Source history could not retire",error)})})}},[travelQueue]);
  const portableMount=useRef(0),portableActive=useRef(portableScope);portableActive.current=portableScope;
  useEffect(()=>{const generation=++portableMount.current;return()=>{queueMicrotask(()=>{if(portableActive.current!==portableScope||portableMount.current===generation)void portableScope.close().catch(error=>{console.error("Retained cubic input could not retire",error)})})}},[portableScope]);
  const widgetChanges = useRef(
    new Map<string, (data: Record<string, unknown>) => void>(),
  );
  useLayoutEffect(() => {
    const before = current.current;
    if (before === document) return;
    const owned=sourceSessionFor(document);
    if(!owned&&measureNativeSync("surface.propEcho.key",()=>nativeDocumentBodiesEqual(before,document))){
      current.current=document;window.showai?.inlineInk?.setDocument?.(document.id,document);refresh(value=>value+1);return;
    }
    authorBaseline.current=document;
    geometrySettlement.current.generation++;
    if(before.id!==document.id||owned&&sourceSessionFor(before)!==owned){
      history.current={past:[],future:[],group:"",at:0};inkActions.current.clear();lastAuthorMutation.current=undefined;
    }else rebaseHistory(before,document);
    current.current = document;
    window.showai?.inlineInk?.setDocument?.(document.id, document);
    refresh((value) => value + 1);
  }, [document,rebaseHistory]);
  const settleGeometry = useCallback(() => {
    // Let content layout and ResizeObserver settle, then complete this same undo transaction.
    // Opening/reading a document never schedules this authoring-only step.
    const settlement = geometrySettlement.current,
      generation = ++settlement.generation;
    cancelAnimationFrame(settlement.first);
    cancelAnimationFrame(settlement.second);
    settlement.first = requestAnimationFrame(() => {
      settlement.second = requestAnimationFrame(() => {
        if (settlement.generation !== generation) return;
        const before = current.current,
          measured = measureNativeSync("surface.settle.materialize",()=>geometry.materialize(before));
        // materialize guarantees COW after observing this current tree. This
        // only proves the geometry operation made no additional source edit.
        if (before === measured) return;
        const owner=sourceSessionFor(before);
        if (!owner&&measureNativeSync("surface.settle.key",()=>contentKey(before) === contentKey(measured))) return;
        const settled = owner?owner.replace(measured) as ContainerDocument:measureNativeSync("surface.settle.reconcile",()=>reconcileSurface(
          { ...measured, surfaceViews: { ...measured.surfaceViews } },
          { clone: false },
        )) as ContainerDocument;
        current.current = settled;
        window.showai?.inlineInk?.setDocument?.(settled.id, settled);
        latestChange.current(settled);
      });
    });
  }, [geometry]);
  const commit = useCallback(
    (value: ShowDocument, group = "", nativeAction?:NativeInkHistoryAction, recordHistory=true, authoring=true, publish=true) => {
      if (latestReadOnly.current) return;
      const before = current.current;
      const owner=sourceSessionFor(before);
      const next = (owner?(authoring?owner.replace(value):sourceSessionFor(value)===owner?value:owner.replace(value)):measureNativeSync("surface.commit.reconcile",()=>
        !authoring ? reconcileSurface(value,{shareWith:before}) :
          isReconciledSurface(value) ? value : reconcileSurface(value)
      )) as ContainerDocument;
      if(!authoring)window.showai?.inlineInk?.copyDocumentMetadata?.(value,next);
      if(nativeAction){
        nativeAction=unregisteredNativeInkHistoryAction(nativeAction,inkActions.current.values());
        recordHistory=!!nativeAction;
      }
      if (!nativeAction && next===before)return;
      if(!owner&&!recordHistory && measureNativeSync("surface.commit.key",()=>nativeDocumentContentKey(next)===nativeDocumentContentKey(before))){
        current.current=next;
        window.showai?.inlineInk?.setDocument?.(next.id,next);
        return;
      }
      const stack = history.current,
        now = Date.now();
      if (recordHistory&&(nativeAction || !group || group !== stack.group || now - stack.at > 800)) {
        // A semantic-only receipt still owns a distinct history edge; using
        // current itself would overwrite a second edge with that same body.
        const snapshot=nativeAction&&next===before?(owner?owner.snapshot(before) as ContainerDocument:{...before}):before;
        stack.past.push(snapshot);
        if(nativeAction)inkActions.current.set(snapshot,nativeAction);
        if (stack.past.length > 80&&!pendingInkEdges.current.size) { const expired=stack.past.shift();if(expired)inkActions.current.delete(expired); }
      }
      if(recordHistory){
        for(const discarded of stack.future)inkActions.current.delete(discarded);
        stack.future = [];stack.group=group;stack.at=now;
      }
      else rebaseHistory(before,next);
      pinHistory(owner);
      let author:NativeAuthorMutation|undefined;
      if(authoring&&recordHistory&&!nativeAction&&window.showai?.inlineInk?.nativeScene){
        const owner=stack.past.at(-1);
        if(owner){
          const action=inkActions.current.get(owner)??{boardId:"",operationIds:[]};
          action.intentId??=crypto.randomUUID();inkActions.current.set(owner,action);
          const mutationId=crypto.randomUUID();
          author={intentId:action.intentId,mutationId,authorMutationId:lastAuthorMutation.current,authorBaseline:authorBaseline.current,before};
          lastAuthorMutation.current=mutationId;
        }
      }
      if(!publish){current.current=next;return;}
      if(next===before){
        window.showai?.inlineInk?.setDocument?.(next.id,next);
        refresh(value=>value+1);
        return;
      }
      measureNativeSync("surface.commit.publish",()=>{
        current.current = next;
        window.showai?.inlineInk?.setDocument?.(next.id, next,author);
        latestChange.current(next);
        refresh((value) => value + 1);
        settleGeometry();
      });
    },
    [settleGeometry,rebaseHistory,pinHistory],
  );
reservePortable.current = (options) => {
    if (latestReadOnly.current || options.pageId !== current.current.id)
      throw new Error("Cubic contact belongs to a retired or read-only source");
    const session = sourceSessionFor(current.current);
    if (!session)
      throw new Error(
        "Cubic authoring requires an actual immutable source session",
      );
    if (!session.document || session.document.id !== options.pageId)
      throw new Error("Cubic contact owner has no current source for this page");
    if (session.document !== current.current) {
      rebaseHistory(current.current, session.document as ContainerDocument);
      current.current = session.document as ContainerDocument;
    }
    const before = session.snapshot(current.current) as ContainerDocument,
      stack = history.current;
    stack.past.push(before);
    pendingInkEdges.current.set(before, options.strokeId);
    for (const discarded of stack.future) inkActions.current.delete(discarded);
    stack.future = [];
    stack.group = "";
    stack.at = 0;
    pinHistory(session);
    // Marks accepted input dirty using the existing author/save deadline. The
    // save barrier below waits for this real contact, never writes a v1 stand-in.
    latestChange.current(current.current);
    refresh((v) => v + 1);
    let acceptedSource: ContainerDocument | undefined,
      ownedFailure: unknown,
      failedHistoryTask: Promise<void> | undefined;
    return {
      fail(error) {
        ownedFailure = error;
        historyFailure.current = error;
        refresh((v) => v + 1);
      },
      async complete(value) {
        if (session.disposed || current.current.id !== options.pageId)
          throw new Error("Accepted cubic input lost its source owner");
        if (historyFailure.current === ownedFailure)
          historyFailure.current = undefined;
        if (failedHistoryTask && historyTail.current === failedHistoryTask)
          historyTail.current = Promise.resolve();
        await historyTail.current;
        while (session.document !== current.current) {
          const observed = session.document as ContainerDocument;
          rebaseHistory(current.current, observed);
          current.current = observed;
          await historyTail.current;
        }
        const resolveBefore = () => {
          let entry = before,
            following = historyReplacements.current.get(entry);
          while (following) {
            entry = following;
            following = historyReplacements.current.get(entry);
          }
          return entry;
        };
        const authoredBefore = resolveBefore(),
          prior = current.current;
        let source = acceptedSource,
          next: ContainerDocument;
        if (!source && prior.content === authoredBefore.content) {
          // Only actual owned identical child-tree identity proves the Board's
          // authored order is unchanged. Root metadata remains the latest UI.
          next = session.replace(
            appendNewPortableInk(prior, options.boardId, value.node, value.frame),
          ) as ContainerDocument;
          source = acceptedSource = next;
        } else {
          source = acceptedSource ??= session.captureExternal(
            appendNewPortableInk(
              authoredBefore,
              options.boardId,
              value.node,
              value.frame,
            ),
            `${historyLease.current}:accepted-${options.strokeId}`,
          ) as ContainerDocument;
          const appended = appendPortableInkFromSource(
            prior,
            source,
            options.boardId,
            options.strokeId,
          ) as ContainerDocument;
          next =
            appended === prior
              ? prior
              : (session.replace(appended) as ContainerDocument);
        }
        if (next !== prior) {
          current.current = next;
          latestChange.current(next);
          refresh((v) => v + 1);
          settleGeometry();
        }
        const task = historyTail.current.then(async () => {
          const resolve = (entry: ContainerDocument) => {
            let following = historyReplacements.current.get(entry);
            while (following) {
              entry = following;
              following = historyReplacements.current.get(entry);
            }
            return entry;
          };
          const edge = resolve(before),
            index = history.current.past.indexOf(edge);
          if (index < 0)
            throw new Error("Accepted cubic contact lost its reserved undo edge");
          const entries = history.current.past.slice(index + 1);
          const result = await session.appendInkHistory(
            source,
            options.boardId,
            options.strokeId,
            entries,
            `${historyLease.current}:append-${options.strokeId}`,
          );
          try {
            const replacements = new Map<ContainerDocument, ContainerDocument>();
            entries.forEach((entry, index) => {
              const replacement = result.documents[index] as ContainerDocument;
              replacements.set(entry, replacement);
              if (replacement !== entry) {
                historyReplacements.current.set(entry, replacement);
                const action = inkActions.current.get(entry);
                inkActions.current.delete(entry);
                if (action) inkActions.current.set(replacement, action);
                const pending = pendingInkEdges.current.get(entry);
                pendingInkEdges.current.delete(entry);
                if (pending) pendingInkEdges.current.set(replacement, pending);
              }
            });
            history.current.past = history.current.past.map(
              (entry) => replacements.get(entry) ?? entry,
            );
            await session.retainHistory(
              [...new Set([...history.current.past, ...history.current.future])],
              historyLease.current,
            );
            pendingInkEdges.current.delete(edge);
            if (!pendingInkEdges.current.size) {
              while (history.current.past.length > 80) {
                const expired = history.current.past.shift()!;
                inkActions.current.delete(expired);
              }
              pinHistory(session);
            }
          } finally {
            await result.release();
            await session.releaseLease(
              `${historyLease.current}:accepted-${options.strokeId}`,
            );
          }
        });
        historyTail.current = task;
        try {
          await task;
        } catch (error) {
          failedHistoryTask = task;
          throw error;
        }
      },
    };
  };
  const inkSave = useRef(onPublishedInkSave??onInkSave);
  inkSave.current = onPublishedInkSave??onInkSave;
  useEffect(() => {
    const bridge = window.showai?.inlineInk;
    if (!bridge || !inlineInkProjectId || readOnly) return;
    let bound=true;
    const appliedPublications=new Set<string>();
    const unbind = bridge.bind(
      document.id,
      inlineInkProjectId,
      async (value, applied) => {
        if (!bound || latestReadOnly.current || current.current.id !== value.pageId)
          return false;
        if(value.publicationId&&appliedPublications.has(value.publicationId)){
          applied?.();
          return (await inkSave.current?.()) ?? true;
        }
        try {
          if(value.sourceSnapshot&&value.document&&sourceSessionFor(value.document)){
            const session=sourceSessionFor(value.document)!;
            let snapshot=value.sourceSnapshot,target=value.document;
            let published=session.apply(snapshot);
            while(!published){
              if(!bound||latestReadOnly.current||current.current.id!==value.pageId)return false;
              const retried=await session.retryPublication(snapshot);snapshot=retried.sourceSnapshot;target=retried.document;
              published=session.apply(snapshot);
            }
            target=published;bridge.copyDocumentMetadata?.(value.document,target);
            authorBaseline.current=target;
            for(const adopted of value.adoptActions??[])for(const [before,action]of inkActions.current){if(action.intentId===adopted.intentId)inkActions.current.set(before,appendNativeInkHistoryGroups(action,[adopted]));}
            for(const corrected of value.correctionActions??[])for(const [before,action]of inkActions.current){if(action.strokeIds?.includes(corrected.strokeId))inkActions.current.set(before,appendNativeInkHistoryGroups(action,[{boardId:corrected.boardId??value.boardId,operationIds:corrected.operationIds}]));}
            const nativeAction=value.operationIds?.length?appendNativeInkHistoryGroups({strokeIds:value.historyStrokeIds,...(!value.nativeContentAction&&!value.nativeContentActions?.length?{kind:"native-ink" as const}:{})},[{boardId:value.boardId,operationIds:value.operationIds}]):undefined;
            if(snapshot.history?.stages.length){
              if(nativeAction)throw new InkEditConflict("Native ink must reach its history boundary before object editing");
              const before=current.current,sourceOnly=session.apply(snapshot.history.sourceOnly,{publish:false,baseDocument:session.baseline(snapshot)}) as ContainerDocument|null;
              if(!sourceOnly)throw new InkEditConflict("Native history source lost its captured owned baseline");
              rebaseHistory(before,sourceOnly);current.current=sourceOnly;
              let prior:ShowDocument=sourceOnly;
              for(const stage of snapshot.history.stages){const body=session.apply(stage.delta,{publish:false,baseDocument:prior});if(!body)throw new InkEditConflict("Native history stage lost its owned baseline");commit(body,`native-content:${stage.groupId}`,undefined,true,false,false);prior=body;}
              // Worker final normalization is independent from history stages.
              current.current=target as ContainerDocument;bridge.setDocument?.(target.id,target);latestChange.current(target);refresh(value=>value+1);
            }else commit(target,value.nativeContentAction?`native-content:${value.nativeContentGroup??""}`:"",nativeAction,!!nativeAction||value.nativeContentAction===true,false);
          }else if(value.document){
            if(!value.baseDocument||value.document.id!==value.pageId||value.baseDocument.id!==value.pageId)
              throw new InkEditConflict("Native Board projection has no matching writer baseline");
            let merged:ReturnType<typeof mergeNativeDocumentReceipt>;
            while(true){
              if(!bound||latestReadOnly.current||current.current.id!==value.pageId)return false;
              if(measureNativeSync("surface.receipt.compare",()=>nativeDocumentBodiesEqual(value.baseDocument!,current.current))){
                merged={document:value.document,conflicts:[]};break;
              }
              if(bridge.hasProjectionReceipt?.(value.document)&&bridge.mergeProjection){
                const projected=await mergeNativeProjectionReceipt(value.baseDocument,value.document,()=>current.current,
                  (incoming,latest)=>bridge.mergeProjection!(incoming,latest),
                  ()=>bound&&!latestReadOnly.current&&current.current.id===value.pageId,
                  (observed,snapshot)=>bridge.copyDocumentMetadata?.(observed,snapshot));
                if(!projected)return false;
                if(current.current!==projected.current||!nativeDocumentBodiesEqual(projected.basis,current.current))continue;
                merged=projected.result;break;
              }
              merged=measureNativeSync("surface.receipt.merge",()=>mergeNativeDocumentReceipt(value.baseDocument!,current.current,value.document!));break;
            }
            if(!canCommitPageMerge(merged))throw new InkEditConflict("Concurrent Board edits require resolution");
            authorBaseline.current=value.document;
            for(const adopted of value.adoptActions??[]){
              for(const [snapshot,action]of inkActions.current){
                if(action.intentId!==adopted.intentId)continue;
                inkActions.current.set(snapshot,appendNativeInkHistoryGroups(action,[adopted]));
              }
            }
            for(const corrected of value.correctionActions??[]){
              for(const [snapshot,action]of inkActions.current){
                if(!action.strokeIds?.includes(corrected.strokeId))continue;
                inkActions.current.set(snapshot,appendNativeInkHistoryGroups(action,[{boardId:corrected.boardId??value.boardId,operationIds:corrected.operationIds}]));
              }
            }
            const nativeAction=value.operationIds?.length?appendNativeInkHistoryGroups({strokeIds:value.historyStrokeIds,...(!value.nativeContentAction&&!value.nativeContentActions?.length?{kind:"native-ink" as const}:{})},[{boardId:value.boardId,operationIds:value.operationIds}]):undefined;
            if(value.nativeContentActions?.length){
              if(nativeAction)throw new InkEditConflict("Native ink must reach its history boundary before object editing");
              const plan=nativeContentHistoryStages(current.current,value.baseDocument,value.document,value.nativeContentActions,{baseline:value.baseDocument,current:current.current,incoming:value.document,result:merged});
              if(plan.stages.length){
                const sourceOnly=reconcileSurface(plan.sourceOnly,{shareWith:current.current}) as ContainerDocument;
                if(contentKey(current.current)!==contentKey(sourceOnly))
                  measureNativeSync("surface.receipt.historyRebase",()=>rebaseHistorySnapshots(history.current,inkActions.current,current.current,sourceOnly));
                current.current=sourceOnly;
                for(const stage of plan.stages)commit(stage.document,`native-content:${stage.groupId}`,undefined,true,false);
              }else commit(merged.document,"",undefined,false,false);
            }else commit(merged.document,value.nativeContentAction ? `native-content:${value.nativeContentGroup??""}` : "",
              nativeAction,!!nativeAction||value.nativeContentAction===true,false);
          }else commit(applyInkUpdate(current.current, value));
        } catch (error) {
          if(!bound||latestReadOnly.current||current.current.id!==value.pageId)return false;
          if (!(error instanceof InkEditConflict)) throw error;
          const record = await window.showai!.invoke<{
            document: ShowDocument;
            revision: string;
          }>("pages:get", {
            projectId: inlineInkProjectId,
            pageId: document.id,
          });
          const recovery = value.document??applyInkUpdate(record.document, {
            ...value,
            baseNodes: undefined,
            baseLayout: undefined,
          });
          await window.showai!.invoke("drafts:save", {
            input: {
              kind: "page",
              projectId: inlineInkProjectId,
              resourceId: document.id,
              clientId: `ink-conflict-${value.boardId}`,
              baseRevision: record.revision,
              baseContent: record.document,
              content: recovery,
              sequence: Date.now(),
              title: recovery.title,
            },
          });
          throw error;
        }
        const owner=sourceSessionFor(current.current);if(owner)await owner.retainHistory([...new Set([...history.current.past,...history.current.future])],historyLease.current);
        if(value.publicationId){
          appliedPublications.add(value.publicationId);
          if(appliedPublications.size>64)appliedPublications.delete(appliedPublications.values().next().value!);
        }
        applied?.();
        return (await inkSave.current?.()) ?? true;
      },
    );
    bridge.setDocument?.(document.id, current.current);
    return ()=>{
      const retire=()=>{bound=false;unbind()};
      // An accepted trip still needs this actual listener to finish its Native
      // preflush/publication. React cleanup itself cannot await that barrier.
      if(travelQueue.pending)void travelQueue.settled().then(retire);else retire();
    };
  }, [document.id, inlineInkProjectId, readOnly, commit,rebaseHistory,travelQueue]);
  const travel = useCallback(
    (redo = false) => travelQueue.enqueue(async () => {
      if(latestReadOnly.current||current.current.id!==document.id)throw new InkEditConflict("History source is retired or read-only");
      await portableScope.flush(true);
      await window.showai?.inlineInk?.flush();
      geometrySettlement.current.generation++;
      await historyTail.current;if(historyFailure.current)throw historyFailure.current;
      const owner=travelQueue.owner;
      while(owner?.document&&owner.document!==current.current){
        if(owner.disposed||current.current.id!==document.id||sourceSessionFor(current.current)!==owner)throw new InkEditConflict("History source changed while flushing");
        rebaseHistory(current.current,owner.document as ContainerDocument);
        current.current=owner.document as ContainerDocument;
        await historyTail.current;if(historyFailure.current)throw historyFailure.current;
      }
      if(latestReadOnly.current||current.current.id!==document.id||sourceSessionFor(current.current)!==owner)throw new InkEditConflict("History source changed while flushing");
      const stack = history.current,
        source = redo ? stack.future : stack.past,
        next = source.at(-1);
      if (!next) return;
      const before=current.current, action=inkActions.current.get(next);
      let restored:ContainerDocument,inverseBefore=before;
      const groups=action?nativeInkHistoryGroups(action):[];
      if((groups.length||action?.intentId)&&window.showai?.inlineInk?.nativeScene){
        const generic=action?.kind==="native-ink"?before:next;
        const session=sourceSessionFor(before);
        const result=await window.showai.invoke<{document:ShowDocument;sourceSnapshot?:import("./source-runtime").SourceSnapshotDelta;sourceSnapshotDeliveryId?:string;groups?:NativeInkHistoryGroup[];boardId?:string;operationIds?:string[]}>("native:board.compensate",{
          projectId:inlineInkProjectId,pageId:before.id,groups,kind:action?.kind,intentId:action?.intentId,
          ...(groups.length===1?groups[0]:{}),
          baseDocument:before,document:generic,...(session?{sourceCurrentRef:await session.reference(before),sourceClientId:session.clientId}:{}),
        });
        if(session&&result.sourceSnapshot)restored=await session.acceptProjection(result.sourceSnapshot,before,result.sourceSnapshotDeliveryId) as ContainerDocument;
        else if(session){
          const incoming=session.captureExternal(result.document,`${historyLease.current}:undo-result`),merged=await session.merge(before,current.current,incoming);
          if(session.document!==current.current){await merged.release();throw new InkEditConflict("Undo source changed while merging");}
          const applied=session.apply(merged.delta);await merged.release();if(!applied)throw new InkEditConflict("Undo source no longer matches its captured baseline");restored=applied as ContainerDocument;
        }else{
          const merged=mergePageContent(before,current.current,result.document);
          if(!canCommitPageMerge(merged))throw new InkEditConflict("Undo encountered concurrent Board edits");restored=merged.document as ContainerDocument;
        }
        authorBaseline.current=(session&&result.sourceSnapshot?session.registeredBody(result.sourceSnapshot.next):result.document)??restored;
        const inverseGroups=result.groups??(groups.length===1&&result.operationIds?[{boardId:groups[0].boardId,operationIds:result.operationIds}]:[]);
        const inverseOwner=sourceSessionFor(current.current);inverseBefore=(inverseOwner?inverseOwner.snapshot(current.current):{...current.current}) as ContainerDocument;
        inkActions.current.set(inverseBefore,appendNativeInkHistoryGroups({strokeIds:action?.strokeIds,kind:action?.kind},inverseGroups));
      }else {
        const session=sourceSessionFor(before);restored=(session?session.replace(next):next) as ContainerDocument;
      }
      let consumed=next,successor=historyReplacements.current.get(consumed);while(successor){consumed=successor;successor=historyReplacements.current.get(consumed)}
      const activeSource=redo?stack.future:stack.past,activeTarget=redo?stack.past:stack.future,index=activeSource.lastIndexOf(consumed);
      if(index>=0)activeSource.splice(index,1);
      activeTarget.push(inverseBefore);inkActions.current.delete(consumed);if(consumed!==next)inkActions.current.delete(next);
      stack.group = "";
      pinHistory(sourceSessionFor(restored));
      current.current = restored;
      window.showai?.inlineInk?.setDocument?.(restored.id, restored);
      latestChange.current(restored);
      refresh((value) => value + 1);
      settleGeometry();
    }),
    [settleGeometry,inlineInkProjectId,pinHistory,portableScope,travelQueue,document.id,rebaseHistory],
  );
  const undo = useCallback(() => travel(), [travel]);
  const redo = useCallback(() => travel(true), [travel]);
  const change = useCallback(
    (next: ShowDocument, group?: string) => commit(next, group),
    [commit],
  );
  const render = ({
    content,
    parentId,
    ids,
    kind,
    renderModule,
    componentData,
  }: ContentRenderProps) => {
    const single = kind === "single" ? content.content?.[0] : undefined;
    if (single?.type === "widget") {
      let onWidgetChange = widgetChanges.current.get(parentId);
      if (!onWidgetChange) {
        onWidgetChange = (data) => {
          if (latestReadOnly.current) return;
          commit(
            editNode(current.current, parentId, (node) => {
              node.attrs = { ...node.attrs, data };
            },{normalize:false,attributesOnly:true}),
            `widget:${parentId}`,
          );
        };
        widgetChanges.current.set(parentId, onWidgetChange);
      }
      return (
        <Widget
          kind={single.attrs!.kind}
          data={single.attrs!.data}
          readOnly={readOnly}
          onChange={onWidgetChange}
        />
      );
    }
    if (single?.type === "image")
      return (
        <img
          className="surface-image"
          src={single.attrs!.src}
          alt={single.attrs?.alt ?? ""}
          draggable={false}
        />
      );
    const editor = (
      <Widget
        kind="text"
        data={{
          ...componentData,
          format: "richtext",
          content: renderModule
            ? toPageEditor(content, current.current, parentId)
            : content,
        }}
        host={{
          retentionKey: `${parentId}:${kind}:${ids?.[0] ?? "content"}`,
          additionalExtensions: renderModule ? pageEditorNodes : undefined,
          continuousPage: !!renderModule,
          onInsertNative: readOnly
            ? undefined
            : (componentKind, data, point) => {
                const inserted = insertComponentAtText(
                  current.current,
                  { parentId, ids, kind },
                  renderModule
                    ? {
                        before: point.before.map((node) =>
                          fromPageEditor(node),
                        ),
                        after: point.after.map((node) => fromPageEditor(node)),
                      }
                    : point,
                  componentKind,
                  data,
                );
                commit(inserted.document);
                setInsertedId(inserted.nodeId);
              },
          onDetachBlock:
            readOnly || renderModule
              ? undefined
              : (block) => {
                  const target = findSurfaceNode(current.current, parentId);
                  if (!target) return;
                  const next = detachBlock(current.current, parentId, block, {
                    x: 0,
                    y: 0,
                    width: 420,
                  });
                  commit(next);
                },
          onContentChange: (value, options) => {
            let source = current.current;
            if (renderModule) {
              const converted=fromPageEditorDraft(value,source);source=converted.document;value=converted.content;
            }
            const group =
              options?.historyGroup ??
              (options?.separateHistory ? "" : `text:${parentId}`);
            if (kind === "children")
              commit(
                replaceChildren(source, parentId, ids, value.content ?? [],{normalize:false}),
                group,
              );
            else
              commit(
                editNode(current.current, parentId, (node) => {
                  const values = value.content ?? [];
                  if (values.length === 1)
                    Object.assign(node, values[0], {
                      attrs: { ...values[0].attrs, id: parentId },
                    });
                  else {
                    node.type = "richText";
                    node.attrs = { id: parentId, name: "文本" }; // i18n-exempt: default node name saved into documents
                    node.content = values.map((child) =>
                      child.attrs?.id === parentId
                        ? {
                            ...child,
                            attrs: { ...child.attrs, id: crypto.randomUUID() },
                          }
                        : child,
                    );
                  }
                },{normalize:false}),
                group,
              );
          },
        }}
        readOnly={readOnly}
      />
    );
    return renderModule ? (
      <PageModuleContext.Provider value={renderModule}>
        {editor}
      </PageModuleContext.Provider>
    ) : (
      editor
    );
  };
  const renderer = useRef(render);
  renderer.current = render;
  const stableRender = useCallback(
    (props: ContentRenderProps) => renderer.current(props),
    [readOnly],
  );
  return (
    <PortableCubicContext.Provider value={portableScope}><div
      className="surface-editor-shell"
      onKeyDownCapture={(event) => {
        if (
          readOnly ||
          event.nativeEvent.isComposing ||
          !(event.metaKey || event.ctrlKey) ||
          event.altKey ||
          (event.target as Element).closest(
            'input,textarea:not([data-text-selection-input]),select,[role="dialog"],[data-editor-keyboard-scope]',
          )
        )
          return;
        if (
          event.key.toLowerCase() === "z" ||
          event.key.toLowerCase() === "y"
        ) {
          event.preventDefault();
          event.stopPropagation();
          travel(event.shiftKey || event.key.toLowerCase() === "y");
        }
      }}
    >
      <ContainerRuntime
        onOpenEmbeddedSurface={onOpenEmbeddedSurface}
        document={current.current}
        geometry={geometry}
        pageWidthModes
        onActiveSurfaceChange={onActiveSurfaceChange}
        onChange={readOnly ? undefined : change}
        header={header}
        renderContent={stableRender}
        revealId={revealId}
        revealInPlace={insertedId}
        onRevealHandled={onRevealHandled}
        undo={undo}
        redo={redo}
        onControlsChange={onControlsChange}
        retainedState={retainedState?.runtime}
        inspectorHost={inspectorHost}
        canUndo={!travelQueue.failure&&!!history.current.past.length}
        canRedo={!travelQueue.failure&&!!history.current.future.length}
      />
      <InkConflictInspector document={current.current} projectId={inlineInkProjectId} host={inspectorHost}
        beforeResolve={onInkSave} getDocument={()=>current.current}
        onResolve={value=>commit(value,"ink-conflict-resolution")} readOnly={readOnly}/>
    </div></PortableCubicContext.Provider>
  );
}
export default memo(SurfaceEditor);
