import type { ShowDocument } from "../types";
export function readerKinds(documents: ShowDocument[]): string[];
export function bundleReader(
  archivePath: string,
  documents: ShowDocument[],
): Promise<string>;
