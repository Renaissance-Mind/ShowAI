import { createHash } from "node:crypto";
import type { ShowDocument } from "./model";

/**
 * Parsing, validating and hashing stored page bytes always yields the same
 * document, so recent results are kept by the digest of those bytes. Callers
 * receive copies and may change them freely.
 */
const pages = new Map<
  string,
  { document: ShowDocument; hash: string; bytes: number }
>();
const HELD_BYTES = 64 * 1024 * 1024;
let held = 0;

export function storedPageKey(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function storedPage(
  key: string,
): { document: ShowDocument; hash: string } | undefined {
  const page = pages.get(key);
  if (!page) return undefined;
  pages.delete(key);
  pages.set(key, page);
  return { document: structuredClone(page.document), hash: page.hash };
}

/** Keeps the document parsed from the bytes behind `key`; call before changing it. */
export function rememberStoredPage(
  key: string,
  bytes: number,
  document: ShowDocument,
  hash: string,
) {
  if (pages.has(key) || bytes > HELD_BYTES / 4) return;
  pages.set(key, { document: structuredClone(document), hash, bytes });
  held += bytes;
  for (const [name, page] of pages) {
    if (held <= HELD_BYTES && pages.size <= 32) break;
    pages.delete(name);
    held -= page.bytes;
  }
}
