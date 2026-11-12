import type { JSONContent } from "@tiptap/core";

export type WalkScope = "tree" | "content";
export interface WalkContext {
  /** The node whose content holds this one; for a held document's root, the component holding it. */
  parent: JSONContent | null;
  /** The nearest component whose data holds this node; null at the top level. */
  host: JSONContent | null;
  /** The outermost component whose data holds this node; null at the top level. */
  owner: JSONContent | null;
  /** Position in parent.content; -1 for the root and held documents. */
  index: number;
}
export interface WalkOptions {
  scope: WalkScope;
  /** Context reported for the root when walking a subtree. */
  parent?: JSONContent | null;
  host?: JSONContent | null;
  owner?: JSONContent | null;
}
export const SKIP: unique symbol;
export function widgetDocuments(data: unknown): JSONContent[];
export function walk(
  root: JSONContent,
  visit: (node: JSONContent, context: WalkContext) => unknown,
  options: WalkOptions,
): void;
