import { expect, test } from "vitest";
import { blockChanges } from "./page-receipt";
import type { ShowDocument } from "../types";

const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
const page = (title: string, content: unknown[]) =>
  ({
    id: "p",
    title,
    content: { type: "doc", content },
  }) as unknown as ShowDocument;

test("receipts name added, removed, changed and moved blocks", () => {
  const before = page("T", [
    paragraph("a", "one"),
    paragraph("b", "two"),
    paragraph("c", "three"),
    paragraph("d", "four"),
  ]);
  const after = page("T", [
    paragraph("a", "one"),
    paragraph("c", "THREE"),
    paragraph("e", "new"),
    paragraph("d", "four"),
  ]);
  // b is gone and e is new; d only shifted, so it did not move.
  expect(blockChanges(before, after)).toEqual({
    added: ["e"],
    removed: ["b"],
    changed: ["c"],
    moved: [],
  });
  const reordered = page("Renamed", [
    paragraph("d", "four"),
    paragraph("a", "one"),
    paragraph("b", "two"),
    paragraph("c", "three"),
  ]);
  expect(blockChanges(before, reordered)).toEqual({
    added: [],
    removed: [],
    changed: [],
    moved: ["d", "a"],
    page: true,
  });
});

test("long lists keep the first 100 ids and report totals", () => {
  const many = Array.from({ length: 150 }, (_, index) =>
    paragraph(`n${index}`, "x"),
  );
  const result = blockChanges(page("T", []), page("T", many));
  expect(result.added).toHaveLength(100);
  expect(result.counts).toEqual({ added: 150, removed: 0, changed: 0, moved: 0 });
});
