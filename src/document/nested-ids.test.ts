import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { blankDocument } from "../core/catalog";
import { normalizeDocument } from "../core/diff";
import { createResource } from "./containers.mjs";
import { assignSurfaceIds, placeTemplate, remapSurfaceIds } from "./document.mjs";
import { findNodes } from "./update.mjs";
import { walk } from "./walk.mjs";
import { copyObjects, pasteObjects } from "../surface/board-commands";
import { retargetBindings } from "../datasets/binding.mjs";

const paragraph = (id: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text: id }],
});
const textBlock = (id: string, ...content: JSONContent[]) => ({
  type: "widget",
  attrs: { id, kind: "text", data: { content: { type: "doc", content } } },
});
const nestedIds = (document: ShowDocument) => {
  const ids: string[] = [];
  walk(document.content, (node, { host }) => {
    if (host && typeof node.attrs?.id === "string") ids.push(node.attrs.id);
  }, { scope: "content" });
  return ids;
};

function page(...content: JSONContent[]): ShowDocument {
  const document = createResource(blankDocument()) as unknown as ShowDocument;
  document.content.content = content;
  document.surfaceViews![document.content.attrs!.id].readingOrder = content.map(
    (node) => node.attrs!.id as string,
  );
  return normalizeDocument(document);
}

describe("ids inside component content", () => {
  test("saving gives repeated nested ids and nested components without an id distinct ids", () => {
    const document = page(
      paragraph("top"),
      textBlock("one", paragraph("same"), paragraph("top")),
      textBlock("two", paragraph("same"), {
        type: "widget",
        attrs: { kind: "callout", data: { content: { type: "doc", content: [] } } },
      }),
    );
    const ids = nestedIds(document);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("same");
    expect(ids.filter((id) => id === "top")).toEqual([]);
    expect(ids).toHaveLength(4);
    // Deterministic: saving again changes nothing.
    expect(nestedIds(assignSurfaceIds(structuredClone(document)))).toEqual(ids);
  });

  test("a placed template and a remapped copy get fresh nested ids", () => {
    const template = page(textBlock("note", paragraph("inside")));
    const copy = remapSurfaceIds(template);
    expect(nestedIds(copy)).not.toContain("inside");
    const twice = placeTemplate(placeTemplate(page(), template), template);
    const ids = nestedIds(twice);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  test("pasted board objects get fresh nested ids", () => {
    const board = createResource(blankDocument(), "board") as unknown as ShowDocument;
    board.content.content = [textBlock("note", paragraph("inside"))];
    board.layout = { note: { x: 0, y: 0, width: 200 } };
    const source = normalizeDocument(board);
    const pasted = pasteObjects(
      source,
      source.content.attrs!.id as string,
      copyObjects(source, ["note"]),
    ).document;
    expect(findNodes(pasted.content, "inside", { scope: "content" })).toHaveLength(1);
    expect(nestedIds(pasted)).toHaveLength(2);
  });

  test("moving a page keeps nested bound components on their project's dataset", () => {
    const bound = {
      type: "widget",
      attrs: {
        id: "table",
        kind: "database",
        data: { title: "T", $binding: { dataset: "rows" } },
      },
    };
    const document = {
      id: "page",
      title: "Move",
      content: { type: "doc", content: [textBlock("note", bound)] },
    } as unknown as ShowDocument;
    const moved = retargetBindings(document, "source", "destination");
    expect(
      findNodes(moved.content, "table", { scope: "content" })[0].node.attrs!.data.$binding,
    ).toEqual({ dataset: "rows", project: "source" });
    expect(document.content.content![0].attrs!.data.content.content[0].attrs.data.$binding).toEqual({
      dataset: "rows",
    });
  });
});
