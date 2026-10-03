import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { CalloutView, ToggleView, WidgetView } from "./NodeViews";

export const blockIdNodeTypes = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "callout",
  "toggle",
  "widget",
];

export const blockIdPluginKey = new PluginKey("showaiBlockIds");

/** Attribute-only steps leave document positions, selection, and text untouched. */
export function createBlockIdPlugin(isEditable: () => boolean): Plugin {
  const types = new Set(blockIdNodeTypes);
  return new Plugin({
    key: blockIdPluginKey,
    appendTransaction(transactions, _previous, current) {
      if (
        !isEditable() ||
        !transactions.some(
          (transaction) =>
            transaction.docChanged ||
            transaction.getMeta(blockIdPluginKey) ||
            transaction.getMeta("editableChanged"),
        )
      )
        return null;
      const used = new Set<string>();
      const transaction = current.tr;
      current.doc.descendants((node, position) => {
        if (!types.has(node.type.name)) return;
        const existing = node.attrs.id;
        if (
          typeof existing === "string" &&
          existing.trim() &&
          !used.has(existing)
        ) {
          used.add(existing);
          return;
        }
        let id: string;
        do {
          id = globalThis.crypto.randomUUID();
        } while (used.has(id));
        used.add(id);
        transaction.setNodeAttribute(position, "id", id);
      });
      if (!transaction.docChanged) return null;
      return transaction
        .setMeta(blockIdPluginKey, true)
        .setMeta("addToHistory", false);
    },
  });
}

export const StableBlockIds = Extension.create<{ readOnly: boolean }>({
  name: "showaiStableBlockIds",
  addOptions: () => ({ readOnly: false }),
  addGlobalAttributes() {
    return [
      {
        types: blockIdNodeTypes,
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes) =>
              typeof attributes.id === "string" && attributes.id.trim()
                ? { "data-block-id": attributes.id }
                : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      createBlockIdPlugin(
        () => !this.options.readOnly && this.editor.isEditable,
      ),
    ];
  },
  onCreate() {
    if (!this.options.readOnly && this.editor.isEditable) {
      this.editor.view.dispatch(
        this.editor.state.tr
          .setMeta(blockIdPluginKey, true)
          .setMeta("addToHistory", false),
      );
    }
  },
});

export const WidgetNode = Node.create({
  name: "widget",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      kind: { default: "chart" },
      data: {
        default: {},
        parseHTML: (element) => {
          const value = element.getAttribute("data-widget-content");
          if (!value) return {};
          try {
            return JSON.parse(value);
          } catch {
            return {};
          }
        },
        renderHTML: (attributes) => ({
          "data-widget-content": JSON.stringify(attributes.data),
        }),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-showai-widget]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-showai-widget": "" }),
  ],
  addNodeView: () => ReactNodeViewRenderer(WidgetView),
});

export const CalloutNode = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  draggable: true,
  addAttributes: () => ({ icon: { default: "💡" }, tone: { default: "sage" } }),
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "aside",
    mergeAttributes(HTMLAttributes, { "data-callout": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),
});

export const ToggleNode = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,
  draggable: true,
  addAttributes: () => ({
    title: { default: "展开了解更多" },
    open: { default: true },
  }),
  parseHTML: () => [{ tag: "section[data-toggle]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "section",
    mergeAttributes(HTMLAttributes, { "data-toggle": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(ToggleView),
});

export function createExtensions(
  options: { readOnly?: boolean; placeholder?: string } = {},
) {
  return [
    StableBlockIds.configure({ readOnly: options.readOnly ?? false }),
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: options.readOnly ?? false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
      codeBlock: { HTMLAttributes: { class: "code-block" } },
    }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "heading"
          ? "标题"
          : (options.placeholder ?? "写下想法，或输入 / 添加内容…"),
      includeChildren: false,
    }),
    Image.configure({
      allowBase64: true,
      HTMLAttributes: { class: "document-image" },
    }),
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    CalloutNode,
    ToggleNode,
    WidgetNode,
  ];
}
