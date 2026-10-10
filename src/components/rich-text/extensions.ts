import { richTextStyle } from "./model.mjs";
import { Extension, mergeAttributes, Node, Mark } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { ReadingHighlight } from "./reading-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TableAlignmentAttributes } from "./table-alignment";
import { DropCursorCleanup } from "./drop-cursor-cleanup";
import { CalloutView, ToggleView, WidgetView, MathView } from "./NodeViews";

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
  "mathInline",
  "mathBlock",
];

export const blockIdPluginKey = new PluginKey("showaiBlockIds");

/** Attribute-only steps leave document positions, selection, and text untouched. */
export function createBlockIdPlugin(isEditable: () => boolean): Plugin {
  const types = new Set([
    ...blockIdNodeTypes,
    "region",
    "richText",
    "pageModule",
  ]);
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
        types: [...blockIdNodeTypes, "region", "richText", "pageModule"],
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

export const RichTextNode = Node.create({
  name: "richText",
  priority: 50,
  group: "block",
  content: "block*",
  defining: true,
  addAttributes: () => ({
    id: { default: null },
    name: { default: "富文本" },
    data: {
      default: {},
      parseHTML: (element) =>
        JSON.parse(element.getAttribute("data-rich-text-settings") || "{}"),
      renderHTML: () => ({}),
    },
  }),
  parseHTML: () => [
    { tag: 'div[data-component-kind="text"]' },
    { tag: 'div[data-page-flow="richText"]' },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-component-kind": "text",
      "data-rich-text-settings": JSON.stringify(node.attrs.data),
      class: "page-document-flow rich-text-component",
      style: Object.entries(richTextStyle(node.attrs.data))
        .filter(([, v]) => v !== undefined)
        .map(
          ([k, v]) =>
            `${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${typeof v === "number" ? `${v}px` : v}`,
        )
        .join(";"),
    }),
    0,
  ],
});

const TextStyle = Mark.create({
  name: "textStyle",
  addAttributes: () =>
    Object.fromEntries(
      ["color", "fontFamily", "fontSize"].map((key) => [
        key,
        {
          default: null,
          parseHTML: (element: HTMLElement) => element.style[key as "color"],
          renderHTML: (attrs: Record<string, string>) =>
            attrs[key]
              ? {
                  style: `${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${attrs[key]}`,
                }
              : {},
        },
      ]),
    ),
  parseHTML: () => [{ tag: "span[style]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes),
    0,
  ],
});
const mathNode = (inline: boolean) =>
  Node.create({
    name: inline ? "mathInline" : "mathBlock",
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    addAttributes: () => ({
      latex: { default: "" },
      display: { default: !inline },
    }),
    parseHTML: () => [{ tag: inline ? "span[data-math]" : "div[data-math]" }],
    renderHTML: ({ node, HTMLAttributes }) => [
      inline ? "span" : "div",
      { ...HTMLAttributes, "data-math": node.attrs.latex },
    ],
    addNodeView: () => ReactNodeViewRenderer(MathView),
  });

export function createExtensions(
  options: {
    readOnly?: boolean;
    placeholder?: string;
    trailingNode?: boolean;
  } = {},
) {
  return [
    RichTextNode,
    TextStyle,
    mathNode(true),
    mathNode(false),
    StableBlockIds.configure({ readOnly: options.readOnly ?? false }),
    DropCursorCleanup,
    StarterKit.configure({
      trailingNode: options.trailingNode === false ? false : {},
      heading: { levels: [1, 2, 3, 4, 5, 6] },
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
    TableAlignmentAttributes,
    TaskList,
    TaskItem.configure({ nested: true }),
    ReadingHighlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    CalloutNode,
    ToggleNode,
    WidgetNode,
  ];
}
