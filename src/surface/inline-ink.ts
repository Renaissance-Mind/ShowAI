import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import { findSurfaceNode } from "./document.mjs";
export interface InkUpdate {
  pageId: string;
  boardId: string;
  nodes: JSONContent[];
  layout: Record<string, NodeLayout>;
  /** Incremental native saves retain untouched nodes and their identity. */
  removedIds?: string[];
}
export interface InkFrame {
  token: string;
  pageId: string;
  boardId: string;
  document?: ShowDocument;
  tool: "pen" | "highlighter" | "eraser";
  color: string;
  width: number;
  pressure?: boolean;
  ruler: boolean;
  dark: boolean;
  widthPx: number;
  heightPx: number;
  viewport: number[];
  camera: { x: number; y: number; scale: number };
  cameraVersion: number;
  poses?: Record<string, number[]>;
  holes: { x: number; y: number; width: number; height: number }[];
  shapes?: { x: number; y: number; width: number; height: number }[];
}
export interface InkCommand {
  pageId: string;
  boardId: string;
  camera?: InkFrame["camera"];
  cameraVersion?: number;
  navigating?: boolean;
  tool?: string;
  error?: string;
  clearSelection?: boolean;
  shapeGesture?: {
    id: string;
    phase: "began" | "changed" | "ended" | "cancelled";
    x: number;
    y: number;
  };
}
export interface InlineInkBridge {
  bind(
    pageId: string,
    projectId: string,
    listener: (value: InkUpdate) => Promise<boolean>,
  ): () => void;
  frame(value: InkFrame): Promise<void>;
  viewport?(
    value: Pick<
      InkFrame,
      | "token"
      | "pageId"
      | "boardId"
      | "widthPx"
      | "heightPx"
      | "viewport"
      | "camera"
      | "cameraVersion"
    >,
  ): Promise<void>;
  hide(pageId: string, boardId: string, token: string): Promise<void>;
  flush(): Promise<void>;
  onCommand(listener: (value: InkCommand) => void): () => void;
}
export function inkNodes(board: JSONContent): JSONContent[] {
  const result: JSONContent[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "surface") return;
    if (
      node.attrs?.ink ||
      (node.attrs?.nativeInk ?? node.attrs?.data?.nativeInk)
    )
      result.push(node);
    else node.content?.forEach(visit);
  };
  board.content?.forEach(visit);
  return result;
}
/** Only replace this Board's ink. Other edits and nested Boards remain current. */
export function applyInkUpdate(
  document: ShowDocument,
  value: InkUpdate,
): ShowDocument {
  if (document.id !== value.pageId) return document;
  const board = findSurfaceNode(document, value.boardId)?.node;
  if (!board || board.attrs?.kind !== "board") return document;
  const previous = inkNodes(board);
  const ids = new Set(
    value.removedIds
      ? [...value.removedIds, ...value.nodes.map((node) => node.attrs!.id)]
      : previous.map((node) => node.attrs!.id),
  );
  const clean = (node: JSONContent): JSONContent =>
    node.type === "surface"
      ? node
      : node.content
        ? {
            ...node,
            content: node.content
              .filter((child) => !ids.has(child.attrs?.id))
              .map(clean),
          }
        : node;
  const updated = {
    ...board,
    content: [
      ...(board.content ?? [])
        .filter((node) => !ids.has(node.attrs?.id))
        .map(clean),
      ...value.nodes,
    ],
  };
  const replace = (node: JSONContent): JSONContent =>
    node.attrs?.id === value.boardId
      ? updated
      : node.content
        ? { ...node, content: node.content.map(replace) }
        : node;
  return {
    ...document,
    content: replace(document.content),
    layout: {
      ...Object.fromEntries(
        Object.entries(document.layout ?? {}).filter(([id]) => !ids.has(id)),
      ),
      ...value.layout,
    },
  };
}
