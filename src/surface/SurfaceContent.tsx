import { Drawing } from "./Drawing";
import { isResource, resourceNodes, surfaceKind } from "./containers.mjs";
import {
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { ObjectContext, SurfaceObject } from "./SurfaceObject";
import { orderedSurfaceNodes } from "./document.mjs";

export function nodeName(node: JSONContent) {
  return String(
    node.attrs?.name ||
      node.attrs?.data?.title ||
      (
        {
          region: "内容区域",
          surface: node.attrs?.kind === "board" ? "Board" : "Page",
          drawing: "绘画",
          richText: "文本",
          image: "图片",
          paragraph: "文本",
          heading: "标题",
          table: "表格",
          widget: node.attrs?.kind || "组件",
        } as Record<string, string>
      )[node.type ?? ""] ||
      "内容",
  );
}
export interface ContentRenderProps {
  content: JSONContent;
  parentId: string;
  ids: string[];
  kind: "children" | "single";
}
export type ContentRenderer = (props: ContentRenderProps) => ReactNode;

function FreeLayout({
  children,
  minHeight = 160,
}: {
  children: ReactNode;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(minHeight);
  useEffect(() => {
    const root = ref.current!;
    const measure = () =>
      setHeight(
        Math.max(
          minHeight,
          ...[...root.children].map(
            (child) =>
              (child as HTMLElement).offsetTop +
              (child as HTMLElement).offsetHeight +
              24,
          ),
        ),
      );
    const observer = new ResizeObserver(measure);
    for (const child of root.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [children, minHeight]);
  return (
    <div
      className="surface-layout-free"
      ref={ref}
      style={{ minHeight: height }}
    >
      {children}
    </div>
  );
}

const ContentNode = memo(
  function RenderNode({
    node,
    document,
    positioned,
    renderContent,
    spatial = true,
    renderSurface,
  }: {
    node: JSONContent;
    document: ShowDocument;
    positioned: boolean;
    renderContent: ContentRenderer;
    spatial?: boolean;
    renderSurface?: (node: JSONContent) => ReactNode;
  }) {
    const id = node.attrs!.id,
      frame = document.layout?.[id];
    let body: ReactNode;
    if (node.type === "surface") body = renderSurface?.(node);
    else if (node.type === "drawing") body = <Drawing node={node} />;
    else if (node.type === "region") {
      const mode = frame?.mode ?? "flow",
        children = node.content ?? [];
      if (mode === "flow") {
        const groups: (JSONContent[] | JSONContent)[] = [];
        for (const child of children) {
          if (
            ["region", "richText", "surface", "drawing"].includes(
              child.type ?? "",
            )
          )
            groups.push(child);
          else {
            const previous = groups.at(-1);
            if (Array.isArray(previous)) previous.push(child);
            else groups.push([child]);
          }
        }
        if (!groups.length) groups.push([]);
        body = (
          <div className="surface-layout-flow">
            {groups.map((group, index) =>
              Array.isArray(group) ? (
                <div key={`flow-${index}`}>
                  {renderContent({
                    content: { type: "doc", content: group },
                    parentId: id,
                    ids: group.map((item) => item.attrs?.id),
                    kind: "children",
                  })}
                </div>
              ) : (
                <ContentNode
                  key={group.attrs!.id}
                  node={group}
                  document={document}
                  positioned={false}
                  spatial={spatial}
                  renderContent={renderContent}
                  renderSurface={renderSurface}
                />
              ),
            )}
          </div>
        );
      } else {
        const empty = !children.length ? <AddToRegion id={id} /> : null;
        const items = children.map((child) => (
          <ContentNode
            key={child.attrs!.id}
            node={child}
            document={document}
            positioned={spatial && mode === "free"}
            spatial={spatial}
            renderContent={renderContent}
            renderSurface={renderSurface}
          />
        ));
        body =
          mode === "grid" ? (
            <div
              className="surface-layout-grid"
              style={{
                gridTemplateColumns: `repeat(${frame?.columns ?? 2}, minmax(0, 1fr))`,
                gap: frame?.gap ?? 24,
              }}
            >
              {items}
              {empty}
            </div>
          ) : spatial ? (
            <FreeLayout minHeight={frame?.height ?? 200}>
              {items}
              {empty}
            </FreeLayout>
          ) : (
            <div className="surface-layout-flow">{items}</div>
          );
      }
    } else if (node.type === "richText")
      body = renderContent({
        content: { type: "doc", content: node.content ?? [] },
        parentId: id,
        ids: (node.content ?? []).map((child) => child.attrs?.id),
        kind: "children",
      });
    else
      body = renderContent({
        content: { type: "doc", content: [node] },
        parentId: id,
        ids: [id],
        kind: "single",
      });
    return (
      <SurfaceObject
        id={id}
        name={nodeName(node)}
        positioned={positioned}
        region={node.type === "region"}
        container={node.type === "surface"}
        drawing={node.type === "drawing"}
        fixedHeight={
          (node.type === "surface" &&
            (surfaceKind(node) === "board" || frame?.heightMode !== "auto")) ||
          node.type === "drawing"
        }
        frame={frame}
      >
        {body}
      </SurfaceObject>
    );
  },
  (before, after) => {
    if (
      before.node !== after.node ||
      before.positioned !== after.positioned ||
      before.spatial !== after.spatial ||
      before.renderSurface !== after.renderSurface ||
      before.renderContent !== after.renderContent
    )
      return false;
    const sameFrames = (node: JSONContent): boolean =>
      before.document.layout?.[node.attrs?.id] ===
        after.document.layout?.[node.attrs?.id] &&
      (node.type !== "region" || (node.content ?? []).every(sameFrames));
    return sameFrames(after.node);
  },
);
function AddToRegion({ id }: { id: string }) {
  const actions = useContext(ObjectContext);
  return actions.readOnly ? null : (
    <button
      type="button"
      className="surface-add-to-region"
      data-surface-ui
      onClick={() => actions.addText?.(id)}
    >
      ＋ 添加文本
    </button>
  );
}

export function SurfaceContent({
  document,
  renderContent,
  spatial = true,
  container = document.content,
  renderSurface,
}: {
  document: ShowDocument;
  renderContent: ContentRenderer;
  spatial?: boolean;
  container?: JSONContent;
  renderSurface?: (node: JSONContent) => ReactNode;
}) {
  if (
    isResource(document) &&
    container.type === "surface" &&
    surfaceKind(container) === "page"
  ) {
    const groups: (JSONContent[] | JSONContent)[] = [];
    for (const node of container.content ?? []) {
      if (
        ["region", "richText", "surface", "drawing"].includes(node.type ?? "")
      )
        groups.push(node);
      else {
        const last = groups.at(-1);
        if (Array.isArray(last)) last.push(node);
        else groups.push([node]);
      }
    }
    if (!groups.length) groups.push([]);
    return (
      <div className="surface-layout-flow">
        {groups.map((group, index) =>
          Array.isArray(group) ? (
            <div key={`flow-${index}`}>
              {renderContent({
                content: { type: "doc", content: group },
                parentId: container.attrs!.id,
                ids: group.map((node) => node.attrs!.id),
                kind: "children",
              })}
            </div>
          ) : (
            <ContentNode
              key={group.attrs!.id}
              node={group}
              document={document}
              positioned={false}
              spatial={spatial}
              renderContent={renderContent}
              renderSurface={renderSurface}
            />
          ),
        )}
      </div>
    );
  }
  const nodes = isResource(document)
    ? resourceNodes(document, container)
    : orderedSurfaceNodes(document);
  return (
    <>
      {nodes.map((node) => (
        <ContentNode
          key={node.attrs!.id}
          node={node}
          document={document}
          positioned={spatial}
          spatial={spatial}
          renderContent={renderContent}
          renderSurface={renderSurface}
        />
      ))}
    </>
  );
}
