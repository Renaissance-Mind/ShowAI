import { applyOperations } from "../core/diff";
import { createResource } from "../document/containers.mjs";
import type { ShowDocument } from "../core/model";
export function blocksDocument(
  blocks: { kind: string; data: Record<string, unknown> }[],
  title = "未命名页面",
  kind: "page" | "board" = "page",
): ShowDocument {
  const now = new Date().toISOString();
  const blank = createResource(
    {
      id: "pending",
      title,
      icon: "",
      cover: "none",
      parentId: null,
      favorite: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      comments: [],
    },
    kind,
  );
  for (const starter of blank.content.content ?? [])
    delete blank.layout?.[starter.attrs?.id];
  blank.content.content = [];
  return applyOperations(
    blank,
    blocks.map((block) => ({
      type: "component.insert" as const,
      kind: block.kind,
      data: block.data,
    })),
  );
}
