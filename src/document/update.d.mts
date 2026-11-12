import type { JSONContent } from "@tiptap/core";
import type { WalkContext, WalkOptions } from "./walk.mjs";

export function mapWidgetDocuments(
  data: unknown,
  map: (document: JSONContent) => JSONContent,
): unknown;
export function mapNodes<T extends JSONContent>(
  root: T,
  map: (
    node: JSONContent,
    context: { host: JSONContent | null; owner: JSONContent | null },
  ) => JSONContent,
  options: WalkOptions,
): T;
export function findNodes(
  root: JSONContent,
  id: string,
  options: WalkOptions,
): (WalkContext & { node: JSONContent })[];
export function addressNode(
  root: JSONContent,
  id: string,
): (WalkContext & { node: JSONContent }) | undefined;
export function updateNode<T extends JSONContent>(
  root: T,
  id: string,
  update: (node: JSONContent) => JSONContent,
  options: WalkOptions,
): T;
