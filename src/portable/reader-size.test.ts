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
const code = page([
  paragraph("Example:"),
  {
    type: "codeBlock",
    attrs: { language: "js" },
    content: [{ type: "text", text: 'const message = "hello";' }],
  },
]);
// A grammar name only the syntax highlighter's registry carries.
const GRAMMARS = "Visual Basic .NET";

describe("reader omissions", () => {
  test("formulas, delimiters and Markdown-like text keep KaTeX", () => {
    expect(readerOmissions([plain])).toEqual(["code", "math", "notes", "ink"]);
    expect(readerOmissions([formula])).toEqual(["code", "notes", "ink"]);
    expect(readerOmissions([page([paragraph("cost $5")])])).toEqual([
      "code",
      "notes",
      "ink",
    ]);
    expect(readerOmissions([page([paragraph("\\(x\\)")])])).toEqual([
      "code",
      "notes",
      "ink",
    ]);
  });
  test("code blocks, code components and Markdown fences keep syntax grammars", () => {
    expect(readerOmissions([code])).toEqual(["math", "notes", "ink"]);
    expect(readerOmissions([page([paragraph("```js\nx\n```")])])).toEqual([
      "math",
      "notes",
      "ink",
    ]);
    expect(readerOmissions([page([paragraph("~~~\nx\n~~~")])])).toEqual([
      "math",
      "notes",
      "ink",
    ]);
    const component = {
      id: "code-component",
      title: "Code component",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: {
              id: "snippet",
              kind: "code",
              data: { content: "x = 1", language: "python" },
            },
          },
        ],
      },
    } as unknown as ShowDocument;
    expect(readerOmissions([component])).toEqual(["math", "notes", "ink"]);
  });
  test("strokes and drawings keep the compiled ink kernel", () => {
    const drawing = page([paragraph("A plain reading page.")]);
    (drawing.content.content as unknown[]).push({
      type: "drawing",
      attrs: { id: "stroke" },
    });
    expect(readerOmissions([drawing])).toEqual(["code", "math", "notes"]);
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
    expect(reader).not.toContain(GRAMMARS);
    expect(reader).toContain(
      'name="showai-reader-omits" content="code math notes ink"',
    );
    expect(bytes).toBeLessThan(CAPACITY.chatBytes * 0.6);
  });
  test("a page with formulas still fits its local reader", async () => {
    const { reader, bytes } = await inlineBytes(formula);
    expect(reader).toContain("KaTeX_");
    expect(reader).not.toContain(GRAMMARS);
    expect(reader).toContain(
      'name="showai-reader-omits" content="code notes ink"',
    );
    expect(bytes).toBeLessThan(CAPACITY.chatBytes * 0.9);
  });
  test("a page with code carries its syntax grammars", async () => {
    const { reader, bytes } = await inlineBytes(code);
    expect(reader).toContain(GRAMMARS);
    expect(reader).toContain(
      'name="showai-reader-omits" content="math notes ink"',
    );
    expect(bytes).toBeLessThan(CAPACITY.chatBytes * 0.6);
  });
});
