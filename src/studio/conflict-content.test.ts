import { expect, it } from "vitest";
import { conflictText, conflictDisplayValue } from "./conflict-content";

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

const document = {
  comments: [],
  id: "page",
  title: "Review",
  icon: "",
  cover: "none",
  parentId: null,
  favorite: false,
  archived: false,
  createdAt: "2026-10-18",
  updatedAt: "2026-10-18",
  content: {
    type: "surface",
    attrs: { id: "page-root", kind: "page" },
    content: [
      {
        type: "paragraph",
        attrs: { id: "opaque-node-id-a", name: "Conclusion" },
        content: [{ type: "text", text: "The first conclusion." }],
      },
      {
        type: "paragraph",
        attrs: { id: "opaque-node-id-b", name: "Evidence" },
        content: [{ type: "text", text: "The supporting evidence." }],
      },
    ],
  },
};

it("shows ordered content names without exposing internal identifiers", () => {
  const result = conflictDisplayValue(
    ["opaque-node-id-b", "opaque-node-id-a"],
    "/nodes/page-root/order",
    document,
  );
  expect(result).toBe("1. Evidence\n2. Conclusion");
  expect(result).not.toContain("opaque-node-id");
});
it("keeps equal rich text readable rather than serializing its structure", () => {
  const text = [
    { type: "text", text: "Conclusion", marks: [{ type: "bold" }] },
  ];
  expect(
    conflictDisplayValue(text, "/nodes/block/node/content", document),
  ).toBe("Conclusion");
  const unsupported = conflictDisplayValue(
    { internalNodeId: "secret-id", config: { renderer: "private-renderer" } },
    "/page/layout",
    document,
  );
  expect(unsupported).not.toMatch(
    /secret-id|private-renderer|internalNodeId|\{|\}/,
  );
});
it("includes text stored in components in the readable page preview", () => {
  const content = {
    type: "widget",
    attrs: {
      id: "opaque-widget",
      kind: "text",
      data: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Final review" }],
            },
          ],
        },
      },
    },
  };
  expect(conflictDisplayValue(content, "", document)).toBe("Final review");
});
