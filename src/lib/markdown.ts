import { markdownToRichText } from "../document/rich-text.mjs";
/** Import through the component parser; serialized component fences belong to the host. */
export const parseMarkdown = (source: string) =>
  markdownToRichText(source, { allowComponentBlocks: true });
