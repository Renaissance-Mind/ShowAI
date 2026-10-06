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
import { findSurfaceNode, reconcileSurface } from "./document.mjs";
import type { ContentRenderProps } from "./SurfaceContent";

const contentKey = (document: ShowDocument) =>
  JSON.stringify([document.content, document.layout, document.surfaceViews]);
export default function SurfaceEditor({
  document: input,
  onChange,
  header,
  onBrowseComponents,
  revealId,
  onRevealHandled,
  readOnly = false,
  onActiveSurfaceChange,
}: {
  document: ShowDocument;
  onChange: (document: ShowDocument) => void;
  header?: ReactNode;
  onBrowseComponents?: () => void;
  readOnly?: boolean;
  revealId?: string | null;
  onRevealHandled?: () => void;
  onActiveSurfaceChange?: (id: string) => void;
}) {
  const document = useMemo(
    () => (isResource(input) ? input : upgradeResource(input)),
    [input],
  );
  const current = useRef<ContainerDocument>(document);
  const history = useRef<{
    past: ContainerDocument[];
    future: ContainerDocument[];
    group: string;
    at: number;
  }>({ past: [], future: [], group: "", at: 0 });
  const [, refresh] = useState(0);
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  useEffect(() => {
    if (contentKey(current.current) !== contentKey(document)) {
      history.current = { past: [], future: [], group: "", at: 0 };
      refresh((value) => value + 1);
    }
    current.current = document;
  }, [document]);
  const commit = useCallback((value: ShowDocument, group = "") => {
    const next = reconcileSurface(value) as ContainerDocument;
    const before = current.current;
    if (contentKey(next) === contentKey(before)) return;
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
  }, []);
  const travel = (redo = false) => {
    const stack = history.current,
      source = redo ? stack.future : stack.past,
      target = redo ? stack.past : stack.future,
      next = source.pop();
    if (!next) return;
    target.push(current.current);
    stack.group = "";
    const restored = {
      ...current.current,
      content: next.content,
      layout: next.layout,
      surfaceViews: next.surfaceViews,
    };
    current.current = restored;
    latestChange.current(restored);
    refresh((value) => value + 1);
  };
  const render = ({ content, parentId, ids, kind }: ContentRenderProps) => {
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
    return (
      <DocumentEditor
        content={content}
        readOnly={readOnly}
        onBrowseComponents={onBrowseComponents}
        minimal
        onDetachBlock={
          readOnly
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
        onChange={(value) => {
          if (kind === "children")
            commit(
              replaceChildren(
                current.current,
                parentId,
                ids,
                value.content ?? [],
              ),
              `text:${parentId}`,
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
              `text:${parentId}`,
            );
        }}
      />
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
          (event.target as Element).closest("input,textarea,select")
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
        onActiveSurfaceChange={onActiveSurfaceChange}
        onChange={readOnly ? undefined : (next) => commit(next)}
        header={header}
        renderContent={stableRender}
        revealId={revealId}
        onRevealHandled={onRevealHandled}
        undo={() => travel()}
        redo={() => travel(true)}
        canUndo={!!history.current.past.length}
        canRedo={!!history.current.future.length}
      />
    </div>
  );
}
