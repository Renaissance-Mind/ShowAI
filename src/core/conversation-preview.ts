import { CapacityError } from "../portable/capacity.mjs";
import { toInlineFragment } from "../portable/inline.mjs";
import { toCdnFragment } from "../portable/cdn-fragment.mjs";
import { cdnReaderUrls, type ReaderMode } from "./cdn-reader";

/** Deliver the page's local reader first; network loading is a size fallback. */
export async function conversationPreview(
  html: string,
  requested?: ReaderMode,
) {
  if (requested !== "cdn") {
    try {
      return { inline: toInlineFragment(html), reader: "bundled" as const };
    } catch (error) {
      if (
        requested === "bundled" ||
        !(error instanceof CapacityError) ||
        error.kind !== "Compressed chat preview"
      )
        throw error;
      const urls = await cdnReaderUrls();
      if (!urls) throw error;
      return {
        inline: toCdnFragment(html, { readerUrls: urls }),
        reader: "cdn" as const,
      };
    }
  }
  const urls = await cdnReaderUrls();
  if (!urls) throw new Error("The CDN reader is unavailable.");
  return {
    inline: toCdnFragment(html, { readerUrls: urls }),
    reader: "cdn" as const,
  };
}
