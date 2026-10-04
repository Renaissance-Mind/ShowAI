import { memo, useRef, useState, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import { Undo2 } from "lucide-react";
import DocumentEditor from "../editor/DocumentEditor";
import PageSurface, { type SurfaceHandle } from "./PageSurface";
import {
  dockItem,
  makeCanvasItem,
  placement,
  replaceBody,
  splitContent,
  type CanvasPlacement,
} from "./model";

const ItemEditor = memo(function ItemEditor({
  node,
  onChange,
  onBrowseComponents,
  readOnly,
}: {
  node: JSONContent;
  onChange: (id: string, content: JSONContent) => void;
  onBrowseComponents?: () => void;
  readOnly?: boolean;
}) {
  return (
    <DocumentEditor
      content={{ type: "doc", content: node.content ?? [] }}
      onChange={(content) => onChange(node.attrs!.id, content)}
      onBrowseComponents={onBrowseComponents}
      minimal
      readOnly={readOnly}
    />
  );
});

export default function SurfaceEditor({
  content,
  onChange,
  title,
  pageClassName,
  onBrowseComponents,
  readOnly = false,
}: {
  content: JSONContent;
  onChange: (content: JSONContent) => void;
  title: ReactNode;
  pageClassName: string;
  onBrowseComponents?: () => void;
  readOnly?: boolean;
}) {
  const viewport = useRef<SurfaceHandle>(null);
  const current = useRef(content);
  current.current = content;
  const change = useRef(onChange);
  change.current = onChange;
  const commit = useRef((value: JSONContent) => {
    current.current = value;
    change.current(value);
  }).current;
  const [deleted, setDeleted] = useState<JSONContent | null>(null);
  const { body, items } = splitContent(content);
  const editItem = useRef((id: string, value: JSONContent) => {
    const source = current.current;
    commit({
      ...source,
      content: source.content?.map((node) =>
        node.attrs?.id === id
          ? {
              ...node,
              content: value.content?.length
                ? value.content
                : [{ type: "paragraph" }],
            }
          : node,
      ),
    });
  }).current;
  const moveItem = (id: string, position: CanvasPlacement) => {
    const source = current.current;
    commit({
      ...source,
      content: source.content?.map((node) =>
        node.attrs?.id === id
          ? { ...node, attrs: { ...node.attrs, canvas: position } }
          : node,
      ),
    });
  };
  const add = (node?: JSONContent) => {
    const position = viewport.current!.insertPosition();
    const item = makeCanvasItem(node ? [node] : [], position);
    const source = current.current;
    commit({
      ...source,
      content: [
        ...(source.content ?? []).filter(
          (entry) => !node || entry.attrs?.id !== node.attrs?.id,
        ),
        item,
      ],
    });
    viewport.current!.reveal(position);
  };
  return (
    <PageSurface
      ref={viewport}
      items={items.map((node) => ({
        id: node.attrs!.id,
        position: placement(node)!,
        content: (
          <ItemEditor
            node={node}
            onChange={editItem}
            onBrowseComponents={onBrowseComponents}
            readOnly={readOnly}
          />
        ),
      }))}
      onAdd={readOnly ? undefined : () => add()}
      onMove={readOnly ? undefined : moveItem}
      onDock={
        readOnly ? undefined : (id) => commit(dockItem(current.current, id))
      }
      onDelete={
        readOnly
          ? undefined
          : (id) => {
              const source = current.current;
              setDeleted(
                source.content?.find((node) => node.attrs?.id === id) ?? null,
              );
              commit({
                ...source,
                content: source.content?.filter(
                  (node) => node.attrs?.id !== id,
                ),
              });
            }
      }
      extraActions={
        !readOnly &&
        deleted && (
          <button
            onClick={() => {
              const source = current.current;
              if (
                !source.content?.some(
                  (node) => node.attrs?.id === deleted.attrs?.id,
                )
              )
                commit({
                  ...source,
                  content: [...(source.content ?? []), deleted],
                });
              viewport.current!.reveal(placement(deleted)!);
              setDeleted(null);
            }}
          >
            <Undo2 size={15} />
            <span>撤销删除</span>
          </button>
        )
      }
    >
      <article className={pageClassName}>
        {title}
        <DocumentEditor
          content={body}
          onChange={(value) => commit(replaceBody(current.current, value))}
          onBrowseComponents={onBrowseComponents}
          onMoveToCanvas={readOnly ? undefined : add}
          readOnly={readOnly}
          minimal
        />
      </article>
    </PageSurface>
  );
}
