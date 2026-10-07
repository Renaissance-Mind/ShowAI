import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { remapSurfaceIds, visitNodes } from "./document.mjs";
import { createSurface } from "./containers.mjs";

/** Keep structural identities in the document while exposing one continuous editor. */
export function toPageEditor(
  node: JSONContent,
  document: ShowDocument,
  tailId?: string,
): JSONContent {
  if (
    node.type === "surface" ||
    node.type === "drawing" ||
    (node.type === "region" &&
      (document.layout?.[node.attrs!.id]?.mode ?? "flow") !== "flow")
  )
    return { type: "pageModule", attrs: { id: node.attrs!.id, node } };
  const content = node.content?.map((child) => toPageEditor(child, document));
  if (
    node.type === "doc" &&
    tailId &&
    ["pageModule", "widget", "image", "horizontalRule"].includes(
      content?.at(-1)?.type ?? "",
    )
  ) {
    const ids = new Set<string>();
    visitNodes(document.content, (child) => {
      if (child.attrs?.id) ids.add(child.attrs.id);
    });
    let id = `page-tail-${tailId.slice(0, 170)}`;
    while (ids.has(id)) id += "-copy";
    content!.push({ type: "paragraph", attrs: { id } });
  }
  return {
    ...node,
    ...(content ? { content } : {}),
  };
}

export function fromPageEditor(
  node: JSONContent,
  source?: ShowDocument,
): JSONContent {
  if (node.type === "pageModule") {
    const original = structuredClone(node.attrs!.node) as JSONContent;
    if (original.attrs!.id !== node.attrs!.id) {
      if (!source) throw new Error("复制嵌入内容需要来源文档的布局与视图。");
      const ids = new Set<string>();
      visitNodes(original, (child) => {
        if (child.attrs?.id) ids.add(child.attrs.id);
      });
      const wrapper = createSurface("page");
      wrapper.content = [original];
      let index = 0;
      const copy = remapSurfaceIds(
        {
          ...source,
          content: wrapper,
          layout: Object.fromEntries(
            Object.entries(source?.layout ?? {}).filter(([id]) => ids.has(id)),
          ),
          surfaceViews: Object.fromEntries(
            Object.entries(source?.surfaceViews ?? {}).filter(([id]) =>
              ids.has(id),
            ),
          ),
        },
        () => (++index === 2 ? node.attrs!.id : crypto.randomUUID()),
      );
      if (source) {
        source.layout = { ...source.layout, ...copy.layout };
        source.surfaceViews = { ...source.surfaceViews, ...copy.surfaceViews };
      }
      return copy.content.content![0];
    }
    original.attrs = { ...original.attrs, id: node.attrs!.id };
    return original;
  }
  return {
    ...node,
    ...(node.content
      ? { content: node.content.map((child) => fromPageEditor(child, source)) }
      : {}),
  };
}
