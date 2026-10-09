import { SurfaceGeometryStore } from "./geometry-store";
import type { EditorControls } from "./EditorControls";
import { insertComponentAtText } from "./component-insertion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ShowDocument, ContainerDocument } from "../types";
import { Widget } from "../components/blocks/Widget";
import DocumentEditor from "../editor/DocumentEditor";
import { ContainerRuntime } from "./ContainerRuntime";
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

const contentKey = (document: ShowDocument) =>
  JSON.stringify([
    document.content,
    document.layout,
    document.surfaceViews,
    document.icon,
  ]);
export default function SurfaceEditor({
  document: input,
  onChange,
  header,
  revealId,
  onRevealHandled,
  readOnly = false,
  onActiveSurfaceChange,
  onControlsChange,
}: {
  document: ShowDocument;
  onChange: (document: ShowDocument) => void;
  header?: ReactNode;
  readOnly?: boolean;
  revealId?: string | null;
  onRevealHandled?: () => void;
  onActiveSurfaceChange?: (id: string) => void;
  onControlsChange?: (controls: EditorControls | null) => void;
}) {
  const document = useMemo(
    () => (isResource(input) ? input : upgradeResource(input)),
    [input],
  );
  const geometry = useMemo(() => new SurfaceGeometryStore(), [document.id]);
  const current = useRef<ContainerDocument>(document);
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
  }>({ past: [], future: [], group: "", at: 0 });
  const [, refresh] = useState(0);
  const [insertedId, setInsertedId] = useState<string | null>(null);
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  useEffect(() => {
    const before = current.current;
    if (
      before.content !== document.content ||
      before.layout !== document.layout ||
      before.surfaceViews !== document.surfaceViews ||
      before.icon !== document.icon
    ) {
      if (contentKey(before) === contentKey(document)) {
        current.current = document;
        return;
      }
      geometrySettlement.current.generation++;
      history.current = { past: [], future: [], group: "", at: 0 };
      refresh((value) => value + 1);
    }
    current.current = document;
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
          measured = geometry.materialize(before);
        if (contentKey(before) === contentKey(measured)) return;
        const settled = reconcileSurface(
          { ...measured, surfaceViews: { ...measured.surfaceViews } },
          { clone: false },
        ) as ContainerDocument;
        current.current = settled;
        latestChange.current(settled);
      });
    });
  }, [geometry]);
  const commit = useCallback(
    (value: ShowDocument, group = "") => {
      const next = (
        isReconciledSurface(value) ? value : reconcileSurface(value)
      ) as ContainerDocument;
      const before = current.current;
      if (
        next === before ||
        (next.content === before.content &&
          next.layout === before.layout &&
          next.surfaceViews === before.surfaceViews &&
          next.icon === before.icon)
      )
        return;
      const stack = history.current,
        now = Date.now();
      if (!group || group !== stack.group || now - stack.at > 800) {
        stack.past.push(before);
        if (stack.past.length > 80) stack.past.shift();
      }
      stack.future = [];
      stack.group = group;
      stack.at = now;
      current.current = next;
      latestChange.current(next);
      refresh((value) => value + 1);
      settleGeometry();
    },
    [settleGeometry],
  );
  const travel = useCallback(
    (redo = false) => {
      geometrySettlement.current.generation++;
      const stack = history.current,
        source = redo ? stack.future : stack.past,
        target = redo ? stack.past : stack.future,
        next = source.pop();
      if (!next) return;
      target.push(current.current);
      stack.group = "";
      const restored = {
        ...current.current,
        icon: next.icon,
        content: next.content,
        layout: next.layout,
        surfaceViews: next.surfaceViews,
      };
      current.current = restored;
      latestChange.current(restored);
      refresh((value) => value + 1);
      settleGeometry();
    },
    [settleGeometry],
  );
  const undo = useCallback(() => travel(), [travel]);
  const redo = useCallback(() => travel(true), [travel]);
  const change = useCallback((next: ShowDocument) => commit(next), [commit]);
  const render = ({
    content,
    parentId,
    ids,
    kind,
    renderModule,
  }: ContentRenderProps) => {
    const single = kind === "single" ? content.content?.[0] : undefined;
    if (single?.type === "widget")
      return (
        <Widget
          kind={single.attrs!.kind}
          data={single.attrs!.data}
          readOnly={readOnly}
          onChange={(data) =>
            commit(
              editNode(current.current, parentId, (node) => {
                node.attrs = { ...node.attrs, data };
              }),
              `widget:${parentId}`,
            )
          }
        />
      );
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
      <DocumentEditor
        content={
          renderModule
            ? toPageEditor(content, current.current, parentId)
            : content
        }
        additionalExtensions={renderModule ? pageEditorNodes : undefined}
        trailingNode={!renderModule}
        readOnly={readOnly}
        onInsertNative={
          readOnly
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
              }
        }
        minimal
        onDetachBlock={
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
              }
        }
        onChange={(value, options) => {
          let source = current.current;
          if (renderModule) {
            source = {
              ...source,
              layout: { ...source.layout },
              surfaceViews: { ...source.surfaceViews },
            };
            value = fromPageEditor(value, source);
          }
          const group = options?.separateHistory ? "" : `text:${parentId}`;
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
                  node.attrs = { id: parentId, name: "文本" };
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
        }}
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
            'input,textarea,select,[role="dialog"]',
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
        document={document}
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
        canUndo={!!history.current.past.length}
        canRedo={!!history.current.future.length}
      />
    </div>
  );
}
