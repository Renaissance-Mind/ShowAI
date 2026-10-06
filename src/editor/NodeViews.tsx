import { useEffect, useState, type PointerEvent, type MouseEvent } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronRight } from "lucide-react";
import { Widget } from "../components/blocks/Widget";

export function WidgetView({
  node,
  updateAttributes,
  editor,
  selected,
  getPos,
}: NodeViewProps) {
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  return (
    <NodeViewWrapper
      className={`document-widget${selected && editable ? " is-selected" : ""}`}
      data-widget-kind={node.attrs.kind}
      data-block-id={node.attrs.id ?? undefined}
      onPointerDownCapture={(event: PointerEvent<HTMLDivElement>) => {
        if (
          !editable ||
          event.button !== 0 ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey
        )
          return;
        const position = getPos();
        if (!selected && typeof position === "number")
          editor.commands.setNodeSelection(position);
      }}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (
          !editable ||
          event.button !== 0 ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey
        )
          return;
        const position = getPos();
        if (typeof position !== "number") return;
        editor.commands.setNodeSelection(position);
        // The atom owns the click; ProseMirror must not move its selection to nearby text.
        event.stopPropagation();
      }}
    >
      <Widget
        kind={node.attrs.kind}
        data={node.attrs.data}
        onChange={(data) => {
          if (editor.isEditable) updateAttributes({ data });
        }}
        readOnly={!editable}
      />
    </NodeViewWrapper>
  );
}

const icons = ["💡", "🌱", "📌", "✨", "⚠️", "🔎"];
const tones = ["sage", "sand", "blue", "rose"];

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  return (
    <NodeViewWrapper
      className={`document-callout tone-${node.attrs.tone}`}
      data-block-id={node.attrs.id ?? undefined}
    >
      <div className="callout-decoration" contentEditable={false}>
        <button
          className="callout-icon"
          disabled={!editable}
          title="更换图标"
          aria-label="更换提示图标"
          onClick={() =>
            updateAttributes({
              icon: icons[(icons.indexOf(node.attrs.icon) + 1) % icons.length],
            })
          }
        >
          {node.attrs.icon}
        </button>
        {editable && (
          <button
            className="callout-color"
            title="更换背景色"
            aria-label="更换提示背景色"
            onClick={() =>
              updateAttributes({
                tone: tones[
                  (tones.indexOf(node.attrs.tone) + 1) % tones.length
                ],
              })
            }
          />
        )}
      </div>
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  );
}

export function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  const [open, setOpen] = useState(Boolean(node.attrs.open));
  useEffect(() => setOpen(Boolean(node.attrs.open)), [node.attrs.open]);
  return (
    <NodeViewWrapper
      className={`document-toggle${open ? " is-open" : ""}`}
      data-block-id={node.attrs.id ?? undefined}
    >
      <div className="toggle-heading" contentEditable={false}>
        <button
          aria-label={open ? "收起内容" : "展开内容"}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (editor.isEditable) updateAttributes({ open: !open });
          }}
        >
          <ChevronRight size={16} />
        </button>
        {editable ? (
          <input
            aria-label="折叠块标题"
            value={node.attrs.title}
            onChange={(event) =>
              updateAttributes({ title: event.target.value })
            }
            placeholder="折叠标题"
          />
        ) : (
          <span>{node.attrs.title}</span>
        )}
      </div>
      <div className="toggle-body" hidden={!open}>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}
