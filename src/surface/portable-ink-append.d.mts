import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "../document/types";
export function appendNewPortableInk<T extends ShowDocument>(
  target: T,
  boardId: string,
  node: JSONContent,
  frame: NodeLayout,
): T;
export function appendPortableInkFromSource<T extends ShowDocument>(
  target: T,
  source: ShowDocument,
  boardId: string,
  strokeId: string,
): T;
