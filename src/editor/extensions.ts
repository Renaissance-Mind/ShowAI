import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { CalloutView, ToggleView, WidgetView } from "./NodeViews";

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
