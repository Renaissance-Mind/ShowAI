import {
  primitiveContentNode,
  primitiveNodeTypes,
  createRichTextNode,
} from "../components/rich-text/model.mjs";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "../document/types";
import { builtinComponent } from "../components/catalog";
import { translator } from "../i18n";
import messages from "../i18n/messages/surface";
import { createSurface, upgradeResource, surfaceKind } from "../document/containers.mjs";
import {
  findSurfaceNode,
  reconcileSurface,
  remapSurfaceIds,
} from "../document/document.mjs";

const t = translator(messages);
import { validateDocument } from "../portable/validation.mjs";

export function nativeComponentDocument(
  kind: string,
  data: Record<string, unknown>,
) {
  const definition = builtinComponent(kind);
  if (!definition?.insertion)
    throw new Error(`Component ${kind} is not a native container.`);
  if (
    Object.keys(data).some(
      (key) => !["title", "content", "layout", "surfaceViews"].includes(key),
    )
  )
    throw new Error("Unsupported container component property.");
  const node = createSurface(
    definition.insertion.surfaceKind,
    data.title === undefined ? undefined : (data.title as string),
  );
  if (data.content !== undefined)
    node.content = structuredClone(data.content) as JSONContent[];
  return validateDocument({
    id: crypto.randomUUID(),
    title: "",
    content: node,
    ...(data.layout !== undefined ? { layout: data.layout } : {}),
    ...(data.surfaceViews !== undefined
      ? { surfaceViews: data.surfaceViews }
      : {}),
  });
}
/**
 * The block a component that is not a native container becomes, and the
 * frame it gets in a container: rich text, a primitive's native nodes, or
 * a widget holding a copy of the data.
 */
export function componentBlock(
  kind: string,
  data: Record<string, unknown>,
): { node: JSONContent; frame: NodeLayout } {
  if (kind === "text")
    return { node: createRichTextNode(data), frame: { x: 0, y: 0, width: 640 } };
  if (primitiveNodeTypes[kind])
    return {
      node: data.document
        ? createRichTextNode({ content: data.document, format: "richtext" })
        : primitiveContentNode(kind, data, crypto.randomUUID()),
      frame: { x: 0, y: 0, width: 640 },
    };
  return {
    node: {
      type: "widget",
      attrs: { id: crypto.randomUUID(), kind, data: structuredClone(data) },
    },
    frame: { x: 0, y: 0, width: 640 },
  };
}

/**
 * Every catalog item enters the same insertion path; containers remain native nodes.
 * An omitted afterId appends, null inserts first, and an id inserts after that sibling.
 */
export function insertComponent(
  source: ShowDocument,
  parentId: string | null,
  kind: string,
  data: Record<string, unknown>,
  afterId?: string | null,
): { document: ReturnType<typeof upgradeResource>; nodeId: string } {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Component data must be an object.");
  if (
    kind === "stepper" &&
    Array.isArray(data.steps) &&
    data.steps.some(
      (step) => step && typeof step === "object" && "blocks" in step,
    )
  )
    return insertStepper(source, parentId, data, afterId);
  const document = upgradeResource(source);
  const parent = parentId
    ? findSurfaceNode(document, parentId)?.node
    : document.content;
  if (!parent || !["surface", "region", "step"].includes(parent.type ?? ""))
    throw new Error("Component destination must be a container.");
  // A stepper's step holds content blocks in flow; it has no layout frames.
  const inStep = parent.type === "step";
  const definition = builtinComponent(kind);
  if (!definition && kind !== "custom")
    throw new Error(`Unknown component: ${kind}.`);
  if (inStep && definition?.insertion)
    throw new Error(
      `A step holds content blocks; insert ${kind} into a Page or Board instead.`,
    );
  let node: JSONContent, frame: NodeLayout;
  if (definition?.insertion) {
    const incoming = remapSurfaceIds(nativeComponentDocument(kind, data));
    node = incoming.content;
    Object.assign(document.layout, incoming.layout);
    Object.assign(document.surfaceViews, incoming.surfaceViews);
    const free =
      parent.type === "surface"
        ? surfaceKind(parent) === "board"
        : document.layout[parent.attrs!.id]?.mode === "free";
    frame = {
      x: 0,
      y: 0,
      width: 760,
      height: 460,
      heightMode: surfaceKind(node) === "page" && !free ? "auto" : "fixed",
    };
  } else ({ node, frame } = componentBlock(kind, data));
  const free =
    (parent.type === "surface" && surfaceKind(parent) === "board") ||
    (parent.type === "region" &&
      document.layout[parent.attrs!.id]?.mode === "free");
  if (free && !definition?.insertion) {
    const child = node;
    node = createSurface(
      "page",
      typeof data.title === "string" && data.title.trim()
        ? data.title
        : (definition?.name ?? "Page"),
    );
    node.content = [child];
    document.layout[child.attrs!.id] = { x: 0, y: 0, width: frame.width };
    frame = {
      x: 0,
      y: 0,
      width: frame.width + 48,
      height: 360,
      heightMode: "auto",
    };
  }
  const siblings = parent.content ?? [];
  if (
    (parent.type === "surface" && surfaceKind(parent) === "board") ||
    (parent.type === "region" &&
      document.layout[parent.attrs!.id]?.mode === "free")
  )
    frame.x = Math.min(
      1000000,
      Math.max(
        0,
        ...siblings.map((sibling) => {
          const f = document.layout[sibling.attrs!.id];
          return f ? f.x + f.width + 48 : 0;
        }),
      ),
    );
  let index = siblings.length;
  if (afterId === null) index = 0;
  else if (afterId !== undefined) {
    const sibling = siblings.findIndex((child) => child.attrs?.id === afterId);
    if (sibling < 0)
      throw new Error(
        `Insertion anchor ${afterId} does not belong to this parent.`,
      );
    index = sibling + 1;
  }
  parent.content = [
    ...siblings.slice(0, index),
    node,
    ...siblings.slice(index),
  ];
  if (!inStep) document.layout[node.attrs!.id] = frame;
  return {
    document: reconcileSurface(document),
    nodeId: node.attrs!.id as string,
  };
}

type StepBlock = { kind: string; data: Record<string, unknown> };
/**
 * A stepper may arrive with components for each step (steps[].blocks); they
 * enter each step through the same insertion path, after the step's text.
 */
function insertStepper(
  source: ShowDocument,
  parentId: string | null,
  data: Record<string, unknown>,
  afterId?: string | null,
) {
  const steps = data.steps as Record<string, unknown>[];
  const blocks = steps.map((step, index): StepBlock[] => {
    const value = step && typeof step === "object" ? step.blocks : undefined;
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      value.some(
        (block) =>
          !block ||
          typeof block !== "object" ||
          typeof block.kind !== "string" ||
          !block.data ||
          typeof block.data !== "object",
      )
    )
      throw new Error(
        `steps[${index}].blocks must be a list of { kind, data } components.`,
      );
    return value as StepBlock[];
  });
  const shell = {
    ...data,
    steps: steps.map((step) => {
      const { blocks: _, ...rest } = step;
      return rest;
    }),
  };
  let inserted = insertComponent(source, parentId, "stepper", shell, afterId);
  const stepIds = (
    findSurfaceNode(inserted.document, inserted.nodeId)!.node.content ?? []
  ).map((step) => step.attrs!.id as string);
  blocks.forEach((list, index) => {
    if (!list.length) return;
    const step = findSurfaceNode(inserted.document, stepIds[index])!.node;
    // A step given only components drops the empty paragraph it was created with.
    const empty =
      !(steps[index].content as string | undefined)?.length &&
      step.content?.length === 1 &&
      step.content[0].type === "paragraph" &&
      !step.content[0].content?.length;
    if (empty) step.content = [];
    for (const block of list)
      inserted = {
        ...insertComponent(
          inserted.document,
          stepIds[index],
          block.kind,
          block.data,
        ),
        nodeId: inserted.nodeId,
      };
  });
  return inserted;
}

/** Insert a structural component at a text caret, splitting only the active text run. */
export function insertComponentAtText(
  source: ShowDocument,
  context: { parentId: string; ids: string[]; kind: "single" | "children" },
  point: { before: JSONContent[]; after: JSONContent[] },
  kind: string,
  data: Record<string, unknown>,
) {
  const draft = upgradeResource(source);
  const target = findSurfaceNode(draft, context.parentId);
  if (!target) throw new Error(t("error.insertionGone"));
  const text = target.node.type === "richText";
  const parent =
    text || context.kind === "single" ? target.parent : target.node;
  if (!parent || !["surface", "region"].includes(parent.type ?? ""))
    throw new Error(t("error.componentNeedsContainer"));
  const inserted = insertComponent(draft, parent.attrs!.id, kind, data);
  const destination = findSurfaceNode(
    inserted.document,
    parent.attrs!.id,
  )!.node;
  const component = destination.content!.pop()!;
  const replaced =
    text || context.kind === "single" ? [target.node.attrs!.id] : context.ids;
  const start = destination.content!.findIndex((node) =>
    replaced.includes(node.attrs?.id),
  );
  const index = start < 0 ? destination.content!.length : start;
  let before = structuredClone(point.before),
    after = structuredClone(point.after);
  if (text) {
    const wrapper = (content: JSONContent[], id: string) => ({
      ...target.node,
      attrs: { ...target.node.attrs, id },
      content,
    });
    const original = target.node.attrs!.id;
    before = before.length ? [wrapper(before, original)] : [];
    after = after.length
      ? [wrapper(after, before.length ? crypto.randomUUID() : original)]
      : [];
    if (before.length && after.length && draft.layout[original]) {
      const frame = inserted.document.layout[component.attrs!.id];
      inserted.document.layout[after[0].attrs!.id] = {
        ...draft.layout[original],
        x: frame.x + frame.width + 48,
      };
    }
  }
  destination.content = [
    ...destination.content!.slice(0, index),
    ...before,
    component,
    ...after,
    ...destination
      .content!.slice(index)
      .filter((node) => !replaced.includes(node.attrs?.id)),
  ];
  return {
    document: reconcileSurface(inserted.document),
    nodeId: inserted.nodeId,
  };
}
