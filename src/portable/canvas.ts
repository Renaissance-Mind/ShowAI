import type { ShowArtifact } from "../types";
import { newDocument } from "../lib/document";
import { CANVAS_KEY } from "../lib/canvas";
import { embedDocumentImages } from "./assets.mjs";
import { loadRemoteComponents } from "./remote.mjs";
import { collectCustomComponentRefs } from "../components/custom/contract";
import {
  findComponent,
  indexComponents,
} from "../components/custom/component-index";
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

/** An explicitly opened thin page becomes a self-contained local editing copy. */
export async function materializeCanvasArtifact(
  artifact: ShowArtifact,
): Promise<ShowArtifact> {
  if (!artifact.remoteComponents?.length) return artifact;
  const downloaded = await loadRemoteComponents(artifact.remoteComponents);
  const index = indexComponents([
    ...(artifact.components ?? []),
    ...downloaded,
  ]);
  for (const ref of collectCustomComponentRefs(artifact.document)) {
    if (!findComponent(index, ref))
      throw new Error(
        `缺少页面锁定的组件 ${ref.componentId}@${ref.version}，原页面未被替换。`,
      );
  }
  return {
    format: artifact.format,
    version: artifact.version,
    document: artifact.document,
    components: [...index.values()],
  };
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
