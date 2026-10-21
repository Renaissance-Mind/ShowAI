import type { ShowDocument } from "../types";
export interface EditorLinkRepairDiagnostics {visitedValues:number;opaqueFields:number}
export function repairEditorLinks(document: ShowDocument, diagnostics?: EditorLinkRepairDiagnostics): {
  document: ShowDocument;
  repairs: { path: string; action: "normalized" | "unlinked" }[];
};
