import { ImageContent } from "./ImageContent";
import { richTextStyle } from "./model.mjs";
import { mathHtml } from "../blocks/markdown-math.mjs";
import {
  useEffect,
  useState,
  useContext,
  type PointerEvent,
  type MouseEvent,
} from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronRight } from "../../ui/icons";
import { RichTextEnvironment } from "./environment";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/richText";

export function WidgetView({
  node,
  updateAttributes,
  editor,
  selected,
  getPos,
}: NodeViewProps) {
  const { renderWidget } = useContext(RichTextEnvironment);
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
      {renderWidget({
        kind: node.attrs.kind,
        data: node.attrs.data,
        onChange: (data) => {
          if (editor.isEditable) updateAttributes({ data });
        },
        readOnly: !editable,
      })}
    </NodeViewWrapper>
  );
}

const icons = ["💡", "🌱", "📌", "✨", "⚠️", "🔎"];
const tones = ["sage", "sand", "blue", "rose"];

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useTranslator(messages);
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  return (
    <NodeViewWrapper
      style={richTextStyle(node.attrs.componentStyle)}
      className={`document-callout tone-${node.attrs.tone}`}
      data-block-id={node.attrs.id ?? undefined}
    >
      <div className="callout-decoration" contentEditable={false}>
        <button
          className="callout-icon"
          disabled={!editable}
          title={t("callout.changeIcon")}
          aria-label={t("callout.changeIconLabel")}
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
            title={t("callout.changeColor")}
            aria-label={t("callout.changeColorLabel")}
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
      <div>
        {node.attrs.title && <strong>{node.attrs.title}</strong>}
        <NodeViewContent className="callout-content" />
      </div>
    </NodeViewWrapper>
  );
}

export function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useTranslator(messages);
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  const [open, setOpen] = useState(Boolean(node.attrs.open));
  useEffect(() => setOpen(Boolean(node.attrs.open)), [node.attrs.open]);
  return (
    <NodeViewWrapper
      style={richTextStyle(node.attrs.componentStyle)}
      className={`document-toggle${open ? " is-open" : ""}`}
      data-block-id={node.attrs.id ?? undefined}
    >
      <div className="toggle-heading" contentEditable={false}>
        <button
          aria-label={open ? t("toggle.collapse") : t("toggle.expand")}
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
            aria-label={t("toggle.titleLabel")}
            value={node.attrs.title}
            onChange={(event) =>
              updateAttributes({ title: event.target.value })
            }
            placeholder={t("toggle.titlePlaceholder")}
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

export function MathView({
  node,
  updateAttributes,
  editor,
  selected,
}: NodeViewProps) {
  const t = useTranslator(messages);
  const display = node.type.name === "mathBlock" || node.attrs.display;
  return (
    <NodeViewWrapper
      as={display ? "div" : "span"}
      className={display ? "sb-math-display" : "sb-math-inline"}
      contentEditable={false}
    >
      <span
        dangerouslySetInnerHTML={{
          __html: mathHtml(node.attrs.latex, display),
        }}
      />
      {selected && editor.isEditable && (
        <input
          aria-label={t("math.source")}
          value={node.attrs.latex}
          onChange={(event) => updateAttributes({ latex: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              editor.commands.focus();
            }
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

export function ImageView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper
      data-block-id={node.attrs.id}
      data-drag-handle
      contentEditable={false}
    >
      <ImageContent attrs={node.attrs} />
    </NodeViewWrapper>
  );
}
