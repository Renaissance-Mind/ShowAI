import { CapacityError, formatBytes } from "../portable/capacity.mjs";
import { toInlineFragment } from "../portable/inline.mjs";
import { toCdnFragment } from "../portable/cdn-fragment.mjs";
import { cdnReaderUrls, type ReaderMode } from "./cdn-reader";

/** Why a page loads its reader online instead of carrying it. */
export interface ReaderReason {
  cause: "requested" | "size";
  message: string;
  /** Size of the bundled fragment that did not fit (cause "size"). */
  bytes?: number;
  /** The conversation host's limit for that fragment (cause "size"). */
  limitBytes?: number;
}

export const REQUESTED_CDN: ReaderReason = Object.freeze({
  cause: "requested",
  message: "The cdn reader was requested; the page needs network access.",
});

const tooLarge =(error: unknown): error is CapacityError =>
  error instanceof CapacityError && error.kind === "Compressed chat preview";

/** Deliver the page's local reader first; network loading is a size fallback. */
export async function conversationPreview(
  html: string,
  requested?: ReaderMode,
): Promise<{
  inline: string;
  reader: ReaderMode;
  readerReason?: ReaderReason;
}> {
  if (requested !== "cdn") {
    try {
      return { inline: toInlineFragment(html), reader: "bundled" as const };
    } catch (error) {
      if (!tooLarge(error)) throw error;
      const size = `The inline page with its bundled reader is ${formatBytes(error.actualBytes)}; the conversation host limit is ${formatBytes(error.limitBytes)}.`;
      if (requested === "bundled") {
        error.message = `${size} The bundled reader was requested, so nothing was written. Select fewer blocks, export html, or choose reader cdn.`;
        throw error;
      }
      const urls = await cdnReaderUrls();
      if (!urls) throw error;
      return {
        inline: toCdnFragment(html, { readerUrls: urls }),
        reader: "cdn" as const,
        readerReason: {
          cause: "size",
          message: `${size} The page loads its reader from the CDN and needs network access.`,
          bytes: error.actualBytes,
          limitBytes: error.limitBytes,
        },
      };
    }
  }
  const urls = await cdnReaderUrls();
  if (!urls) throw new Error("The CDN reader is unavailable.");
  return {
    inline: toCdnFragment(html, { readerUrls: urls }),
    reader: "cdn" as const,
    readerReason: REQUESTED_CDN,
  };
}
