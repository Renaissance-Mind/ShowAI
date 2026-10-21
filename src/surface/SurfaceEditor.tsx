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
import { toPageEditor, fromPageEditor } from "./page-content";
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
  onOpenEmbeddedSurface?: (id:string) => void;
}) {
  const document = useMemo(
    () => (isResource(input) ? input : upgradeResource(input)),
    [input],
  );
  const geometry = useMemo(() => new SurfaceGeometryStore(), [document.id]);
  const restored =
    retainedState?.document?.id === document.id ? retainedState : undefined;
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
  const inkActions=useRef(history.current.inkActions??new Map<ContainerDocument,NativeInkHistoryAction>());
  useLayoutEffect(
    () => () => {
      if (!retainedState) return;
      retainedState.document = current.current;
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
  const widgetChanges = useRef(
    new Map<string, (data: Record<string, unknown>) => void>(),
  );
  useLayoutEffect(() => {
    const before = current.current;
    if (before === document) return;
    if (
      before.content !== document.content ||
      before.layout !== document.layout ||
      before.surfaceViews !== document.surfaceViews ||
      before.icon !== document.icon
    ) {
      if (measureNativeSync("surface.propEcho.key",()=>contentKey(before) === contentKey(document))) {
        current.current = document;
        window.showai?.inlineInk?.setDocument?.(document.id, document);
        refresh((value) => value + 1);
        return;
      }
      authorBaseline.current=document;
      geometrySettlement.current.generation++;
      if (before.id !== document.id) {
        history.current = { past: [], future: [], group: "", at: 0 };
        inkActions.current.clear();
        lastAuthorMutation.current=undefined;
      } else {
        measureNativeSync("surface.propEcho.rebase",()=>rebaseHistorySnapshots(history.current,inkActions.current,before,document));
      }
    }
    current.current = document;
    window.showai?.inlineInk?.setDocument?.(document.id, document);
    refresh((value) => value + 1);
  }, [document]);
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
        if (measureNativeSync("surface.settle.key",()=>contentKey(before) === contentKey(measured))) return;
        const settled = measureNativeSync("surface.settle.reconcile",()=>reconcileSurface(
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
    (value: ShowDocument, group = "", nativeAction?:NativeInkHistoryAction, recordHistory=true, authoring=true) => {
      if (latestReadOnly.current) return;
      const before = current.current;
      const next = measureNativeSync("surface.commit.reconcile",()=>
        !authoring ? reconcileSurface(value,{shareWith:before}) :
          isReconciledSurface(value) ? value : reconcileSurface(value)
      ) as ContainerDocument;
      if(!authoring)window.showai?.inlineInk?.copyDocumentMetadata?.(value,next);
      if(nativeAction){
        nativeAction=unregisteredNativeInkHistoryAction(nativeAction,inkActions.current.values());
        recordHistory=!!nativeAction;
      }
      if (!nativeAction && (
        next === before ||
        (authoring && next.content === before.content &&
          next.layout === before.layout &&
          next.surfaceViews === before.surfaceViews &&
          next.icon === before.icon)
      ))
        return;
      if(!recordHistory && measureNativeSync("surface.commit.key",()=>nativeDocumentContentKey(next)===nativeDocumentContentKey(before))){
        current.current=next;
        window.showai?.inlineInk?.setDocument?.(next.id,next);
        return;
      }
      const stack = history.current,
        now = Date.now();
      if (recordHistory&&(nativeAction || !group || group !== stack.group || now - stack.at > 800)) {
        // A semantic-only receipt still owns a distinct history edge; using
        // current itself would overwrite a second edge with that same body.
        const snapshot=nativeAction&&next===before?{...before}:before;
        stack.past.push(snapshot);
        if(nativeAction)inkActions.current.set(snapshot,nativeAction);
        if (stack.past.length > 80) { const expired=stack.past.shift();if(expired)inkActions.current.delete(expired); }
      }
      if(recordHistory){
        for(const discarded of stack.future)inkActions.current.delete(discarded);
        stack.future = [];stack.group=group;stack.at=now;
      }
      else measureNativeSync("surface.commit.rebase",()=>rebaseHistorySnapshots(stack,inkActions.current,before,next));
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
    [settleGeometry],
  );
  const inkSave = useRef(onInkSave);
  inkSave.current = onInkSave;
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
          if(value.document){
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
            const nativeAction=value.operationIds?.length?appendNativeInkHistoryGroups({strokeIds:value.historyStrokeIds},[{boardId:value.boardId,operationIds:value.operationIds}]):undefined;
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
        if(value.publicationId){
          appliedPublications.add(value.publicationId);
          if(appliedPublications.size>64)appliedPublications.delete(appliedPublications.values().next().value!);
        }
        applied?.();
        return (await inkSave.current?.()) ?? true;
      },
    );
    bridge.setDocument?.(document.id, current.current);
    return ()=>{bound=false;unbind()};
  }, [document.id, inlineInkProjectId, readOnly, commit]);
  const travel = useCallback(
    async (redo = false) => {
      await window.showai?.inlineInk?.flush();
      geometrySettlement.current.generation++;
      const stack = history.current,
        source = redo ? stack.future : stack.past,
        target = redo ? stack.past : stack.future,
        next = source.at(-1);
      if (!next) return;
      const before=current.current, action=inkActions.current.get(next);
      let restored:ContainerDocument;
      const groups=action?nativeInkHistoryGroups(action):[];
      if(groups.length&&window.showai?.inlineInk?.nativeScene){
        const generic={...current.current,icon:next.icon,content:next.content,layout:next.layout,surfaceViews:next.surfaceViews};
        const result=await window.showai.invoke<{document:ShowDocument;groups?:NativeInkHistoryGroup[];boardId?:string;operationIds?:string[]}>("native:board.compensate",{
          projectId:inlineInkProjectId,pageId:before.id,groups,
          ...(groups.length===1?groups[0]:{}),
          baseDocument:before,document:generic,
        });
        const merged=mergePageContent(before,current.current,result.document);
        if(!canCommitPageMerge(merged))throw new InkEditConflict("Undo encountered concurrent Board edits");
        restored=merged.document as ContainerDocument;
        authorBaseline.current=result.document;
        const inverseGroups=result.groups??(groups.length===1&&result.operationIds?[{boardId:groups[0].boardId,operationIds:result.operationIds}]:[]);
        inkActions.current.set(before,appendNativeInkHistoryGroups({strokeIds:action?.strokeIds},inverseGroups));
      }else restored = {
        ...current.current,icon:next.icon,content:next.content,layout:next.layout,surfaceViews:next.surfaceViews,
      };
      const latest=(redo?stack.future:stack.past)===source&&source.at(-1)===next;
      const index=source.lastIndexOf(next);
      if(index>=0)source.splice(index,1);
      if(latest)target.push(before);else inkActions.current.delete(before);
      inkActions.current.delete(next);
      stack.group = "";
      current.current = restored;
      window.showai?.inlineInk?.setDocument?.(restored.id, restored);
      latestChange.current(restored);
      refresh((value) => value + 1);
      settleGeometry();
    },
    [settleGeometry,inlineInkProjectId],
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
            }),
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
              source = {
                ...source,
                layout: { ...source.layout },
                surfaceViews: { ...source.surfaceViews },
              };
              value = fromPageEditor(value, source);
            }
            const group =
              options?.historyGroup ??
              (options?.separateHistory ? "" : `text:${parentId}`);
            if (kind === "children")
              commit(
                replaceChildren(source, parentId, ids, value.content ?? []),
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
                }),
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
    <div
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
        canUndo={!!history.current.past.length}
        canRedo={!!history.current.future.length}
      />
      <InkConflictInspector document={current.current} projectId={inlineInkProjectId} host={inspectorHost}
        beforeResolve={onInkSave} getDocument={()=>current.current}
        onResolve={value=>commit(value,"ink-conflict-resolution")} readOnly={readOnly}/>
    </div>
  );
}
export default memo(SurfaceEditor);
