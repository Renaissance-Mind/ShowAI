import type { ShowDocument } from "../types";
export function externalImageUrls(document: ShowDocument): string[];
export function externalResourceUrls(document: ShowDocument): string[];
export function assertOfflineImages(document: ShowDocument): void;
export function embedDocumentImages(
  document: ShowDocument,
): Promise<ShowDocument>;
