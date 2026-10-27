import { describe, expect, it } from "vitest";
import {
  NAVIGATE_EVENT,
  navigationTarget,
  pageLink,
  parsePageLink,
  requestNavigation,
} from "./page-link.mjs";
import { isSafeUrl, validateDocument } from "./validation.mjs";
import { repairEditorLinks } from "../surface/editor-links.mjs";
import type { ShowDocument } from "../types";

describe("ShowAI page links", () => {
  it("round-trips pages and linked blocks", () => {
    const page = { projectId: "project-a", pageId: "page_1", blockIds: [] };
    expect(pageLink(page)).toBe("showai://project/project-a/page/page_1");
    expect(parsePageLink(pageLink(page))).toEqual(page);
    const blocks = { ...page, blockIds: ["b-1", "chart_2"] };
    expect(pageLink(blocks)).toBe(
      "showai://project/project-a/page/page_1?blocks=b-1,chart_2",
    );
    expect(parsePageLink(pageLink(blocks))).toEqual(blocks);
  });

  it("rejects anything that is not exactly a page link", () => {
    for (const value of [
      "showai://join?invite=abc",
      "showai://login?flow=a&code=b",
      "showai://project/a/page",
      "showai://project/a/folder/b",
      "showai://project/a/page/b/extra",
      "showai://project/a/page/b#c",
      "showai://project/a/page/b?blocks=c&x=1",
      "showai://project/a/page/b?blocks=c&blocks=d",
      "showai://project/a/page/b?blocks=c,,d",
      "showai://project/a/page/b?blocks=<x>",
      "showai://project/../page/b",
      "showai://user:pass@project/a/page/b",
      "showai://project:1/a/page/b",
      "SHOWAI://project/a/page/b",
      " showai://project/a/page/b",
      "https://project/a/page/b",
      null,
      42,
    ])
      expect(parsePageLink(value), String(value)).toBeNull();
    const many = Array.from({ length: 101 }, (_, index) => `b${index}`);
    expect(
      parsePageLink(`showai://project/a/page/b?blocks=${many.join(",")}`),
    ).toBeNull();
    expect(() => pageLink({ projectId: "a", pageId: "../b" })).toThrow();
  });

  it("reads component navigation targets relative to the current page", () => {
    expect(navigationTarget("#block-1")).toEqual({ blockIds: ["block-1"] });
    expect(navigationTarget({ blockId: "block-1" })).toEqual({
      blockIds: ["block-1"],
    });
    expect(navigationTarget({ pageId: "p2" })).toEqual({
      pageId: "p2",
      blockIds: [],
    });
    expect(
      navigationTarget({ projectId: "a", pageId: "p2", blockId: "b" }),
    ).toEqual({ projectId: "a", pageId: "p2", blockIds: ["b"] });
    expect(navigationTarget("showai://project/a/page/p2?blocks=b")).toEqual({
      projectId: "a",
      pageId: "p2",
      blockIds: ["b"],
    });
    for (const value of [
      {},
      { projectId: "a", blockId: "b" },
      { pageId: "p", extra: 1 },
      { pageId: "../p" },
      "#",
      "#bad id",
      "https://example.com",
      ["p"],
      null,
    ])
      expect(navigationTarget(value), JSON.stringify(value)).toBeNull();
  });

  it("reports whether a host took the navigation request", () => {
    const host = new EventTarget();
    const target = { pageId: "p2", blockIds: [] };
    expect(requestNavigation(host, target)).toBe(false);
    host.addEventListener(NAVIGATE_EVENT, (event) => {
      expect((event as CustomEvent).detail).toEqual({ target });
      event.preventDefault();
    });
    expect(requestNavigation(host, target)).toBe(true);
  });

  it("is a valid saved link mark that link repair keeps", () => {
    const href = "showai://project/project-a/page/page_2?blocks=block-9";
    expect(isSafeUrl(href)).toBe(true);
    expect(isSafeUrl(href, true)).toBe(false);
    expect(isSafeUrl("showai://join?invite=abc")).toBe(false);
    const document = {
      id: "page_1",
      title: "Links",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "p-1" },
            content: [
              {
                type: "text",
                text: "Next page",
                marks: [{ type: "link", attrs: { href } }],
              },
            ],
          },
        ],
      },
    } as unknown as ShowDocument;
    expect(() => validateDocument(document)).not.toThrow();
    const repaired = repairEditorLinks(document);
    expect(repaired.document).toBe(document);
    expect(repaired.repairs).toEqual([]);
    const broken = JSON.parse(
      JSON.stringify(document).replace(href, "showai://join?invite=abc"),
    );
    expect(() => validateDocument(broken)).toThrow(/ShowAI page URL/);
  });
});
