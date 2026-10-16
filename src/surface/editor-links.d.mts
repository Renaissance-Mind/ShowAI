import type { ShowDocument } from "../types";
export function repairEditorLinks(document: ShowDocument): {
  document: ShowDocument;
  repairs: { path: string; action: "normalized" | "unlinked" }[];
};
