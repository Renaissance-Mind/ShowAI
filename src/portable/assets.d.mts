import type { ShowDocument } from "../types";
export function externalImageUrls(document: ShowDocument): string[];
export function externalResourceUrls(document: ShowDocument): string[];
export function assertOfflineImages(document: ShowDocument): void;
export function resourceDataUrl(
  url: string,
  kind?: "image" | "video" | "audio" | "pdf",
): Promise<string>;
export function embedDocumentImages(
  document: ShowDocument,
): Promise<ShowDocument>;
export interface ResourceSlot {
  object: Record<string, unknown>;
  key: string;
  kind: "image" | "video" | "audio" | "pdf";
  blockId?: string;
  /** Where the value sits in its block, e.g. `src`, `images[0].src`, `props.clip`. */
  field: string;
}
export function resourceSlots(
  document: ShowDocument,
  options?: { components?: boolean },
): ResourceSlot[];
export function componentFileSlots(
  document: ShowDocument,
): Omit<ResourceSlot, "kind">[];
