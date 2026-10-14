import type { JSONContent } from "@tiptap/core";
import { markdownToRichText } from "../components/rich-text/model.mjs";

/** Resolve upstream Markdown links for display without changing the stored original. */
export function componentAuthoringContent(
  markdown: string,
  sourceUrl?: string,
  imageLabel = "Image",
) {
  // Skill files open with YAML metadata; show it as a code block instead of
  // letting it run into the first paragraph.
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  const readable = frontmatter
    ? `\`\`\`yaml\n${frontmatter[1]}\n\`\`\`\n\n${markdown.slice(frontmatter[0].length)}`
    : markdown;
  const content = markdownToRichText(readable, { allowComponentBlocks: false });
  const resolveLink = (href: string, image = false): string | undefined => {
    if (/^(https?:\/\/|mailto:|tel:|#)/i.test(href)) return href;
    if (!sourceUrl || /^[a-z][a-z\d+.-]*:/i.test(href)) return undefined;
    const url = new URL(href, sourceUrl);
    if (image && url.hostname === "github.com")
      url.pathname = url.pathname.replace("/blob/", "/raw/");
    return url.href;
  };
  const visit = (node: JSONContent): JSONContent => {
    const next = { ...node };
    if (node.marks)
      next.marks = node.marks.flatMap((mark) => {
        if (mark.type !== "link") return [mark];
        const href = resolveLink(String(mark.attrs?.href ?? ""));
        return href ? [{ ...mark, attrs: { ...mark.attrs, href } }] : [];
      });
    if (node.type === "image") {
      const src = resolveLink(String(node.attrs?.src ?? ""), true);
      if (!src)
        return {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: node.attrs?.alt || String(node.attrs?.src || imageLabel),
            },
          ],
        };
      next.attrs = { ...node.attrs, src };
    }
    if (node.content) next.content = node.content.map(visit);
    return next;
  };
  return visit(content);
}
