import type { ShowDocument } from "../types";
import { injectArtifactIntoHtml } from "../portable/validation.mjs";
import { embedDocumentImages } from "../portable/assets.mjs";

export {
  ARTIFACT_DATA_ID,
  MAX_ARTIFACT_BYTES,
  escapeJsonForHtml,
  injectArtifactIntoHtml,
  isSafeUrl,
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";

/** The template contains the entire React viewer and is produced by build:portable. */
export async function buildArtifactHtml(
  document: ShowDocument,
  templateUrl = `${import.meta.env.BASE_URL}portable.html`,
): Promise<string> {
  const response = await fetch(templateUrl);
  if (!response.ok)
    throw new Error(
      "The HTML viewer is unavailable. Run npm run build:portable, then try again.",
    );
  const template = await response.text();
  return injectArtifactIntoHtml(template, await embedDocumentImages(document));
}
