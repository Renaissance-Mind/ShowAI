import type { ShowArtifact } from "../types";
import { newDocument } from "../lib/document";
import { CANVAS_KEY } from "../lib/canvas";
import { embedDocumentImages } from "./assets.mjs";
import {
  injectArtifactIntoHtml,
  parseArtifact,
  serializeArtifact,
} from "./validation.mjs";

export function loadCanvasArtifact(
  storage: Pick<Storage, "getItem">,
): ShowArtifact {
  const raw = storage.getItem(CANVAS_KEY);
  return raw
    ? parseArtifact(raw)
    : { format: "showai", version: 1, document: newDocument() };
}

export function saveCanvasArtifact(
  storage: Pick<Storage, "setItem">,
  artifact: ShowArtifact,
): void {
  storage.setItem(
    CANVAS_KEY,
    serializeArtifact(artifact.document, artifact.components),
  );
}

export function retainCanvasArtifact(
  storage: Pick<Storage, "setItem">,
  artifact: ShowArtifact,
): void {
  storage.setItem(
    `showai.page.${artifact.document.id}`,
    serializeArtifact(artifact.document, artifact.components),
  );
}

export async function buildCanvasArtifactHtml(
  artifact: ShowArtifact,
  templateUrl = `${import.meta.env.BASE_URL}portable.html`,
): Promise<string> {
  const response = await fetch(templateUrl);
  if (!response.ok)
    throw new Error(
      "The HTML viewer is unavailable. Run npm run build:portable, then try again.",
    );
  return injectArtifactIntoHtml(
    await response.text(),
    await embedDocumentImages(artifact.document),
    artifact.components,
  );
}
