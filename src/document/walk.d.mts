import type { JSONContent } from "@tiptap/core";

export type WalkScope = "tree" | "content";
export interface WalkContext {
  parent: JSONContent | null;
  host: JSONContent | null;
  owner: JSONContent | null;
  index: number;
}
export interface WalkOptions {
  scope: WalkScope;
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
