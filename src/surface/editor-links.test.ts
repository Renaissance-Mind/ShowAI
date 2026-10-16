import { expect, test } from "vitest";
import { repairEditorLinks } from "./editor-links.mjs";
import { blankDocument } from "../core/catalog";
import { validateDocument } from "../portable/validation.mjs";

test("nested rich text links retain every word and safe marks while unsafe targets cannot execute", () => {
  const source = blankDocument();
  source.content.content = [
    {
      type: "widget",
      attrs: {
        id: "nested-text",
        kind: "text",
        data: {
          format: "richtext",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Kept text",
                    marks: [
                      { type: "bold" },
                      { type: "link", attrs: { href: "javascript:alert(1)" } },
                    ],
                  },
                  {
                    type: "text",
                    text: "Web",
                    marks: [
                      {
                        type: "link",
                        attrs: { href: " https://example.com/research " },
                      },
                    ],
                  },
                  {
                    type: "text",
                    text: "Relative",
                    marks: [{ type: "link", attrs: { href: "../paper.md" } }],
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ];
  const original = structuredClone(source);
  const result = repairEditorLinks(source);
  expect(result.repairs).toHaveLength(3);
  expect(source).toEqual(original);
  const content =
    result.document.content.content![0].attrs!.data.content.content[0].content;
  expect(content.map((node: { text: string }) => node.text).join(" ")).toBe(
    "Kept text Web Relative",
  );
  expect(content[0].marks).toEqual([{ type: "bold" }]);
  expect(content[1].marks[0].attrs.href).toBe("https://example.com/research");
  expect(content[2].marks).toBeUndefined();
  expect(() => validateDocument(result.document)).not.toThrow();
  expect(repairEditorLinks(result.document).document).toBe(result.document);
});
