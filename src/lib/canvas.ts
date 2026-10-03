import type { ShowDocument } from "../types";
import { newDocument } from "./document";
import { parseArtifact, serializeArtifact } from "./artifact";

export const CANVAS_KEY = "showai.canvas.v1";

export function loadCanvas(storage: Pick<Storage, "getItem">): ShowDocument {
  const source = storage.getItem(CANVAS_KEY);
  return source ? parseArtifact(source).document : newDocument();
}

export function saveCanvas(
  storage: Pick<Storage, "setItem">,
  document: ShowDocument,
) {
  storage.setItem(CANVAS_KEY, serializeArtifact(document));
}

/** Preserve the preceding page before replacing the visible canvas with a file. */
export function retainPage(
  storage: Pick<Storage, "setItem">,
  document: ShowDocument,
) {
  storage.setItem(`showai.page.${document.id}`, serializeArtifact(document));
}
