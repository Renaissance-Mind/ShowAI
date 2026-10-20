import { describe, expect, it } from "vitest";
import type { ShowDocument } from "../types";
import {
  addressableIds,
  formatReference,
  pageReference,
  referenceLink,
  referenceVersion,
} from "./page-reference";

const text = (value: string) => [{ type: "text", text: value }];
const document = {
  id: "page-1",
  title: "Damping",
  content: {
    type: "surface",
    attrs: { id: "root", kind: "page" },
    content: [
      {
        type: "richText",
        attrs: { id: "body" },
        content: [
          {
            type: "heading",
            attrs: { id: "h1", level: 2 },
            content: text("Overview"),
          },
          {
            type: "paragraph",
            attrs: { id: "p1" },
            content: text("First   line"),
          },
          {
            type: "paragraph",
            attrs: { id: "p2" },
            content: text("Second line"),
          },
        ],
      },
      {
        type: "surface",
        attrs: { id: "board", kind: "board" },
        content: [
          {
            type: "widget",
            attrs: {
              id: "note",
              kind: "text",
              data: {
                format: "richtext",
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { id: "inner" },
                      content: text("Assumption A"),
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    ],
  },
} as unknown as ShowDocument;
const record = { document, hash: "a".repeat(64), revision: "b".repeat(64) };

describe("page references", () => {
  it("keeps addressable IDs and maps rich text inside components to them", () => {
    const { ids, missing } = addressableIds(document, [
      "p1",
      "inner",
      "p1",
      "gone",
    ]);
    expect(ids).toEqual(["p1", "note"]);
    expect(missing).toEqual(["gone"]);
  });

  it("references a text selection with its text as labels", () => {
    const reference = pageReference("project-1", record, {
      kind: "text",
      pageId: "page-1",
      blockIds: ["p1", "p2"],
      text: "line\nSecond",
    });
    expect(reference).toEqual({
      type: "showai.reference",
      version: 1,
      kind: "selection",
      projectId: "project-1",
      pageId: "page-1",
      title: "Damping",
      hash: record.hash,
      revision: record.revision,
      blockIds: ["p1", "p2"],
      labels: ["line", "Second"],
    });
  });

  it("references Board objects or a whole Board with their text labels", () => {
    const objects = pageReference("project-1", record, {
      kind: "board",
      blockIds: ["note"],
      surfaceId: "board",
    });
    expect(objects).toMatchObject({
      kind: "board",
      nodeIds: ["note"],
      surfaceId: "board",
      labels: ["Assumption A"],
    });
    const whole = pageReference("project-1", record, {
      kind: "board",
      surfaceId: "board",
    });
    expect(whole.nodeIds).toBeUndefined();
    expect(whole.labels).toEqual(["Assumption A"]);
  });

  it("references the page with up to twenty normalised labels", () => {
    const reference = pageReference("project-1", record, { kind: "page" });
    expect(reference.kind).toBe("page");
    expect(reference.blockIds).toBeUndefined();
    expect(reference.labels).toEqual([
      "Overview",
      "First line",
      "Second line",
      "Assumption A",
    ]);
    const many = {
      ...record,
      document: {
        ...document,
        content: {
          type: "doc",
          content: Array.from({ length: 30 }, (_, index) => ({
            type: "paragraph",
            attrs: { id: `n${index}` },
            content: text(`Line ${index} ${"x".repeat(200)}`),
          })),
        },
      } as unknown as ShowDocument,
    };
    const bounded = pageReference("project-1", many, { kind: "page" });
    expect(bounded.labels).toHaveLength(20);
    expect(bounded.labels[0]).toHaveLength(160);
  });

  it("refuses content that is not in the saved page", () => {
    expect(() =>
      pageReference("project-1", record, {
        kind: "blocks",
        blockIds: ["gone"],
      }),
    ).toThrow(/not in the saved page: gone/);
    expect(() =>
      pageReference("project-1", record, { kind: "board", surfaceId: "nope" }),
    ).toThrow(/Board is not in the saved page/);
  });

  it("formats a heading, an app link and one JSON line", () => {
    const reference = pageReference("project 1", record, {
      kind: "blocks",
      blockIds: ["p1"],
    });
    expect(referenceLink(reference)).toBe(
      "showai://project/project%201/page/page-1?blocks=p1",
    );
    expect(referenceVersion(reference)).toBe("bbbbbbb");
    const lines = formatReference(reference, "Heading").split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Heading");
    expect(JSON.parse(lines[2])).toEqual(reference);
  });
});
