import type { JSONContent } from "@tiptap/core";
import type { NodeLayout } from "../document/types";
import type { InkArchiveGroup } from "../document/geometry.mjs";
export function validateInkArchiveGroup(
  node: JSONContent,
): InkArchiveGroup | null;
export function inkArchiveGroupLayout(
  group: InkArchiveGroup,
  frame: NodeLayout,
): { width: number; height: number; scaleX: number; scaleY: number };
export function flattenInkArchiveChild(
  node: JSONContent,
  localFrame: NodeLayout,
  group: InkArchiveGroup,
  outerFrame: NodeLayout,
): { node: JSONContent; frame: NodeLayout };
