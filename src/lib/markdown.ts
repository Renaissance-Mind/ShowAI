import { markdownToRichText } from "../document/rich-text.mjs";
export const parseMarkdown = (source: string) =>
  markdownToRichText(source, { allowComponentBlocks: true });
