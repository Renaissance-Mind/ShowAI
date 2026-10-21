import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  isSafeHref,
  parseInline,
  plainInline,
  unsafeInlineLinks,
} from "./inline-markup.mjs";
import { InlineMarkup } from "./InlineMarkup";

describe("inline markup", () => {
  it("parses nested bold, code and links", () => {
    expect(parseInline("a **b `c`** [d](https://x.dev)")).toEqual([
      { type: "text", text: "a " },
      {
        type: "strong",
        children: [
          { type: "text", text: "b " },
          { type: "code", text: "c" },
        ],
      },
      { type: "text", text: " " },
      {
        type: "link",
        href: "https://x.dev",
        children: [{ type: "text", text: "d" }],
      },
    ]);
    expect(plainInline("**a** `b` [c](#d)")).toBe("a b c");
    expect(parseInline("**[x]{横轴}** 与 [y](#y)")).toEqual([
      {
        type: "strong",
        children: [
          { type: "note", note: "横轴", children: [{ type: "text", text: "x" }] },
        ],
      },
      { type: "text", text: " 与 " },
      { type: "link", href: "#y", children: [{ type: "text", text: "y" }] },
    ]);
    expect(plainInline("[**a**]{b} `c`")).toBe("a c");
  });

  it("accepts web, mail, anchor and relative links only", () => {
    for (const href of ["https://a.b", "mailto:x@y.z", "#ref", "guide.html"])
      expect(isSafeHref(href), href).toBe(true);
    for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil"])
      expect(isSafeHref(href), href).toBe(false);
    expect(unsafeInlineLinks("[a](https://a.b) [b](javascript:x)")).toEqual([
      "javascript:x",
    ]);
  });

  it("renders unsafe or disabled links as their label, never as HTML", () => {
    const html = (source: string, links = true) =>
      renderToStaticMarkup(createElement(InlineMarkup, { source, links }));
    expect(html("[doc](https://a.b)")).toBe(
      '<a href="https://a.b" target="_blank" rel="noopener noreferrer">doc</a>',
    );
    expect(html("[doc](#x)")).toBe('<a href="#x">doc</a>');
    expect(html("[run](javascript:x)")).toBe("<span>run</span>");
    expect(html("[doc](https://a.b)", false)).toBe("<span>doc</span>");
    expect(html("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});
