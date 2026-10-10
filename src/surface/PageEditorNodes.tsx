import { createContext, useContext, type ReactNode } from "react";
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";

export const PageModuleContext = createContext<
  (node: JSONContent) => ReactNode
>(() => null);

function PageModuleView({ node }: NodeViewProps) {
  const render = useContext(PageModuleContext);
  return (
    <NodeViewWrapper
      className="page-document-module"
      data-block-id={node.attrs.id}
      contentEditable={false}
    >
      {render(node.attrs.node)}
    </NodeViewWrapper>
  );
}

const flowNode = (name: string) =>
  Node.create({
    name,
    group: "block",
    content: "block*",
    defining: true,
    addAttributes: () => ({ id: { default: null }, name: { default: null } }),
    parseHTML: () => [{ tag: `div[data-page-flow="${name}"]` }],
    renderHTML: ({ HTMLAttributes, node }) => [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-flow": name,
        "data-block-id": node.attrs.id,
        class: "page-document-flow",
      }),
      0,
    ],
  });

export const pageEditorNodes = [
  flowNode("region"),
  Node.create({
    name: "pageModule",
    group: "block",
    atom: true,
    draggable: true,
    addAttributes: () => ({
      id: { default: null },
      node: {
        default: null,
        parseHTML: (element) =>
          JSON.parse(element.getAttribute("data-page-module") || "null"),
        renderHTML: () => ({}),
      },
    }),
    parseHTML: () => [{ tag: "div[data-page-module]" }],
    renderHTML: ({ node }) => [
      "div",
      {
        "data-page-module": JSON.stringify(node.attrs.node),
        "data-block-id": node.attrs.id,
      },
    ],
    addNodeView: () => ReactNodeViewRenderer(PageModuleView),
  }),
];
