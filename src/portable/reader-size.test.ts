import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundleReader, readerOmissions } from "./reader-bundle.mjs";
import { toInlineFragment } from "./inline.mjs";
import { CAPACITY } from "./capacity.mjs";
import type { ShowDocument } from "../types";

const archive = join(
  resolve(import.meta.dirname, "../.."),
  "dist-portable/reader-source.json",
);
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const page = (content: unknown[]) =>
  ({
    id: "reader-size",
    title: "Reader size",
    content: {
      type: "doc",
      content: [
        {
          type: "widget",
          attrs: {
            id: "body",
            kind: "text",
            data: { format: "richtext", content: { type: "doc", content } },
          },
        },
      ],
    },
  }) as unknown as ShowDocument;
const plain = page([paragraph("A plain reading page.")]);
const formula = page([
  paragraph("Energy:"),
  { type: "mathBlock", attrs: { latex: "E = mc^2" } },
]);

describe("reader omissions", () => {
  test("formulas, delimiters and Markdown-like text keep KaTeX", () => {
    expect(readerOmissions([plain])).toEqual(["math"]);
    expect(readerOmissions([formula])).toEqual([]);
    expect(readerOmissions([page([paragraph("cost $5")])])).toEqual([]);
    expect(readerOmissions([page([paragraph("\\(x\\)")])])).toEqual([]);
  });
});

// Conversation hosts cap previews at CAPACITY.chatBytes. Without a
// margin, any reader growth silently moves every preview onto the network.
describe.skipIf(!existsSync(archive))("conversation preview budget", () => {
  const inlineBytes = async (document: ShowDocument) => {
    const reader = await bundleReader(archive, [document]);
    const html = reader.replace(
      '<script id="showai-data" type="application/json">null</script>',
      `<script id="showai-data" type="application/json">${JSON.stringify({ document })}</script>`,
    );
    return { reader, bytes: Buffer.byteLength(toInlineFragment(html)) };
  };
  test("a plain page carries its local reader with room to spare", async () => {
    const { reader, bytes } = await inlineBytes(plain);
    expect(reader).not.toContain("KaTeX_");
    expect(reader).toContain('name="showai-reader-omits" content="math"');
    expect(bytes).toBeLessThan(CAPACITY.chatBytes * 0.6);
  });
  test("a page with formulas still fits its local reader", async () => {
    const { reader, bytes } = await inlineBytes(formula);
    expect(reader).toContain("KaTeX_");
    expect(reader).not.toContain("showai-reader-omits");
    expect(bytes).toBeLessThan(CAPACITY.chatBytes * 0.9);
  });
});
