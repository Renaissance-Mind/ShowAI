import type { JSONContent } from "@tiptap/core";
import type { ComponentContract } from "./component-definition.mjs";
export function nodeComponentContract(
  node: JSONContent,
): ComponentContract | undefined;
export function legacyEmbeddedKinds(kind: string, data: unknown): string[];
export function componentContentDocuments(
  data: unknown,
  contract?: ComponentContract,
): JSONContent[];
export function mapComponentContent(
  data: unknown,
  contract: ComponentContract | undefined,
  map: (document: JSONContent) => JSONContent,
  replacements?: WeakMap<JSONContent, JSONContent>,
): unknown;
