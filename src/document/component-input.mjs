import {
  primitiveNodeTypes,
  primitiveContentNode,
  createRichTextNode,
} from "./rich-text.mjs";
export function componentInputNode(kind, data) {
  if (kind === "text") return createRichTextNode(data);
  if (primitiveNodeTypes[kind])
    return data.document
      ? createRichTextNode({ content: data.document, format: "richtext" })
      : primitiveContentNode(kind, data, crypto.randomUUID());
  return {
    type: "widget",
    attrs: { id: crypto.randomUUID(), kind, data: structuredClone(data) },
  };
}
