import { expect, test } from "vitest";
import type { ShowDocument } from "../types";
import { templateHeadings } from "./template-headings";

const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});

test("template headings include those in component rich text", () => {
  const document = {
    id: "template",
    title: "Template",
    content: {
      type: "doc",
      content: [
        heading("Background"),
        {
          type: "widget",
          attrs: {
            id: "steps",
            kind: "stepper",
            data: {
              steps: [
                {
                  title: "One",
                  content: { type: "doc", content: [heading("Inside a step")] },
                },
              ],
            },
          },
        },
        {
          type: "widget",
          attrs: { id: "note", kind: "text", data: { content: "## From Markdown" } },
        },
      ],
    },
  } as unknown as ShowDocument;
  expect(templateHeadings(document)).toEqual([
    "Background",
    "Inside a step",
    "From Markdown",
  ]);
});
