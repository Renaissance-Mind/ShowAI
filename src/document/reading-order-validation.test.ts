import { describe, expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { validateDocument } from "../portable/validation.mjs";
import { createResource } from "./containers.mjs";
import { upgradeDocument } from "./document.mjs";
import type { ContainerDocument, ShowDocument } from "../types";

const paragraph = (id: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text: id }],
});
function page(count: number, readingOrder?: unknown) {
  const document = createResource(blankDocument()) as ContainerDocument;
  const root = document.content.attrs!.id;
  document.content.content = Array.from({ length: count }, (_, i) =>
    paragraph(`p-${i}`),
  );
  document.surfaceViews = {
    [root]: { initial: null, saved: [], readingOrder },
  } as never;
  return { document, root };
}
const order = (document: ShowDocument, root: string) =>
  (validateDocument(document) as ContainerDocument).surfaceViews![root]
    .readingOrder;

describe("surface reading order validation", () => {
  it("keeps the saved order and appends missing roots in document order", () => {
    const { document, root } = page(5, ["p-3", "p-1"]);
    expect(order(document, root)).toEqual(["p-3", "p-1", "p-0", "p-2", "p-4"]);
    const empty = page(3, []);
    expect(order(empty.document, empty.root)).toEqual(["p-0", "p-1", "p-2"]);
  });

  it("rejects duplicate, unknown, nested and non-array reading orders", () => {
    const message = "Reading order must contain unique root node ids.";
    for (const readingOrder of [
      ["p-1", "p-1"],
      ["p-1", "missing"],
      "p-1",
      7,
    ])
      expect(() => validateDocument(page(3, readingOrder).document)).toThrow(
        message,
      );
    const { document, root } = page(2, []);
    document.content.content!.push({
      type: "region",
      attrs: { id: "group" },
      content: [paragraph("inside")],
    });
    expect(order(document, root)).toEqual(["p-0", "p-1", "group"]);
    document.surfaceViews![root].readingOrder = ["inside"];
    expect(() => validateDocument(document)).toThrow(message);
  });

  it("validates whiteboard views against root ids only", () => {
    const document = upgradeDocument({
      ...blankDocument(),
      content: { type: "doc", content: [paragraph("a"), paragraph("b")] },
    }) as ShowDocument & { views: { readingOrder: string[] } };
    const [region] = document.content.content!;
    expect(
      (validateDocument(document) as typeof document).views.readingOrder,
    ).toEqual([region.attrs!.id]);
    document.views.readingOrder = ["a"];
    expect(() => validateDocument(document)).toThrow(
      "Reading order must contain unique root node ids.",
    );
  });

  it("orders a page with 5000 root blocks", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `p-${i}`);
    const saved = ids.filter((_, i) => i % 2).reverse();
    const { document, root } = page(5000, saved);
    expect(order(document, root)).toEqual([
      ...saved,
      ...ids.filter((_, i) => i % 2 === 0),
    ]);
  });
});
