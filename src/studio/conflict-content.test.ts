import { expect, it } from "vitest";
import { conflictText } from "./conflict-content";

it("shows rich text as paragraphs and retains line breaks", () => {
  expect(
    conflictText({
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "Review" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Evidence" },
            { type: "hardBreak" },
            { type: "text", text: "Conclusion", marks: [{ type: "bold" }] },
          ],
        },
      ],
    }),
  ).toBe("Review\nEvidence\nConclusion");
});
it("does not hide component data or unknown rich content behind an empty text preview", () => {
  expect(
    conflictText({ type: "image", attrs: { src: "image.png" } }),
  ).toBeNull();
  expect(conflictText({ items: [{ value: 42 }] })).toBeNull();
  expect(conflictText([{ label: "A" }])).toBeNull();
  expect(conflictText(null)).toBeNull();
});
