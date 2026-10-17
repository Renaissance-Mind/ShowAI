import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import catalog from "../../../resources/catalog/components.json";
import { StructureBrowserBlock } from "./StructureBrowser";
import { CardGridBlock } from "./CardGrid";
import {
  cardGridColumns,
  isSafeHref,
  structureOutline,
  validateDocBrowseData,
} from "./doc-browse-contract.mjs";

const structure = (): any => ({
  title: "订单接口返回值",
  nodes: [
    {
      name: "data",
      kind: "object",
      type: "Order",
      summary: "查询到的订单。",
      children: [
        { name: "id", kind: "field", type: "string", badge: "必填" },
        {
          name: "status",
          kind: "field",
          type: '"pending" | "paid"',
          summary: "订单状态，见 [状态说明](https://example.com/status)。",
          detail:
            "状态只会向前推进：\n\n- `pending`：等待支付\n- `paid`：已支付",
          example: '{ "status": "paid" }',
          exampleLang: "json",
        },
        {
          name: "items",
          kind: "array",
          children: [{ name: "sku", kind: "field", summary: "商品编码。" }],
        },
      ],
    },
    { name: "docs/", children: [{ name: "readme.md" }] },
  ],
  initial: "data/status",
  caption: "字段按返回顺序排列。",
});

const cards = (): any => ({
  variant: "tile",
  cards: [
    {
      icon: "🚀",
      title: "快速上手",
      body: "运行 `npm start` 跑通示例。",
      href: "https://example.com/start",
      tag: "推荐",
      tone: "teal",
    },
    { title: "鉴权", body: "申请 **密钥**。", href: "#auth" },
    {
      title: "联系支持",
      body: "工作日回复。",
      href: "mailto:help@example.com",
    },
    { title: "概念", body: "见 [术语表](./glossary)。" },
  ],
});

const render = (component: any, data: any) =>
  renderToStaticMarkup(createElement(component, { data, readOnly: true }));

describe("structure browser contract", () => {
  it("accepts nested nodes and indexes paths without trailing slashes", () => {
    const data = structure();
    expect(() =>
      validateDocBrowseData("structure-browser", data),
    ).not.toThrow();
    const { items, roots } = structureOutline(data.nodes);
    expect(roots).toEqual(["data", "docs"]);
    expect(items.get("docs/readme.md")?.parent).toBe("docs");
    expect(items.get("docs")?.kind).toBe("dir");
    expect(items.get("docs/readme.md")?.kind).toBe("file");
    expect(items.get("data/items/sku")?.depth).toBe(2);
  });

  it("rejects duplicate sibling names, unresolved initial paths and unknown kinds", () => {
    const duplicate = structure();
    duplicate.nodes[0].children.push({ name: "id" });
    expect(() => validateDocBrowseData("structure-browser", duplicate)).toThrow(
      /nodes\[0\]\.children\[3\]\.name repeats the path data\/id/,
    );
    const initial = structure();
    initial.initial = "data/missing";
    expect(() => validateDocBrowseData("structure-browser", initial)).toThrow(
      /initial data\/missing/,
    );
    const kind = structure();
    kind.nodes[1].kind = "folder";
    expect(() => validateDocBrowseData("structure-browser", kind)).toThrow(
      /nodes\[1\]\.kind/,
    );
    const field = structure();
    field.nodes[0].childern = [];
    expect(() => validateDocBrowseData("structure-browser", field)).toThrow(
      /nodes\[0\]\.childern is not a supported field/,
    );
    const slash = structure();
    slash.nodes[1].name = "a/b";
    expect(() => validateDocBrowseData("structure-browser", slash)).toThrow(
      /one path segment/,
    );
  });

  it("limits depth and refuses unsafe links in text", () => {
    let node: any = { name: "leaf" };
    for (let level = 0; level < 9; level++)
      node = { name: `level${level}`, children: [node] };
    expect(() =>
      validateDocBrowseData("structure-browser", { nodes: [node] }),
    ).toThrow(/deeper than 8/);
    const link = structure();
    link.nodes[0].children[1].detail = "[点我](javascript:alert(1))";
    expect(() => validateDocBrowseData("structure-browser", link)).toThrow(
      /nodes\[0\]\.children\[1\]\.detail links to javascript/,
    );
  });
});

describe("structure browser rendering", () => {
  it("opens the initial path, shows its detail and never needs onChange", () => {
    const html = render(StructureBrowserBlock, structure());
    // The ancestor is expanded and the initial node is the only tab stop.
    expect(html).toMatch(
      /aria-selected="false" aria-expanded="true"[^>]*>.*?data</,
    );
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="location">status</span>');
    expect(html).toContain("<code>pending</code>");
    expect(html).toContain('<ul class="stb-para">');
    expect(html).toContain(
      'href="https://example.com/status" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain("&quot;status&quot;: &quot;paid&quot;");
    expect(html).toContain("复制示例：status");
    // Collapsed nodes are absent from the tree but present in the print outline.
    const tree = html.slice(0, html.indexOf('class="stb-detail"'));
    expect(tree).toContain("docs/");
    expect(tree).not.toContain("readme.md");
    expect(html).toMatch(/class="stb-print".*readme\.md/);
    expect(html).toMatch(/class="stb-print".*商品编码/);
  });

  it("falls back to the first node and shows unsafe links as text", () => {
    const data = structure();
    delete data.initial;
    data.caption = "[坏链接](javascript:void(0))";
    const html = render(StructureBrowserBlock, data);
    expect(html).toContain('aria-current="location">data</span>');
    expect(html).toContain("<span>坏链接</span>");
    expect(html).not.toContain("javascript:");
  });
});

describe("card grid", () => {
  it("allows only http(s), mailto, anchors and relative links", () => {
    for (const href of [
      "https://a.example/x",
      "mailto:a@b.c",
      "#top",
      "./a",
      "../b",
      "/docs",
      "page.html",
    ])
      expect(isSafeHref(href), href).toBe(true);
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.example",
      "file:///etc",
      "vbscript:x",
      "https://",
      "a b",
      "",
    ])
      expect(isSafeHref(href), href).toBe(false);
  });

  it("validates cards, tones, columns and nested links", () => {
    expect(() => validateDocBrowseData("card-grid", cards())).not.toThrow();
    const unsafe = cards();
    unsafe.cards[1].href = "javascript:alert(1)";
    expect(() => validateDocBrowseData("card-grid", unsafe)).toThrow(
      /cards\[1\]\.href/,
    );
    const nested = cards();
    nested.cards[0].body = "见 [文档](https://example.com)";
    expect(() => validateDocBrowseData("card-grid", nested)).toThrow(
      /cards\[0\]\.body cannot contain links/,
    );
    const columns = cards();
    columns.columns = 5;
    expect(() => validateDocBrowseData("card-grid", columns)).toThrow(
      /columns/,
    );
    const tone = cards();
    tone.cards[0].tone = "green";
    expect(() => validateDocBrowseData("card-grid", tone)).toThrow(
      /cards\[0\]\.tone/,
    );
    expect(() =>
      validateDocBrowseData("card-grid", { cards: [{ title: "x", body: "" }] }),
    ).toThrow(/cards\[0\]\.body/);
  });

  it("picks balanced default columns", () => {
    const of = (count: number, variant?: string) =>
      cardGridColumns({
        variant: variant as any,
        cards: Array.from({ length: count }, () => ({ title: "t", body: "b" })),
      });
    expect([1, 2, 3, 4, 5].map((count) => of(count))).toEqual([1, 2, 3, 2, 3]);
    expect([3, 4].map((count) => of(count, "row"))).toEqual([1, 2]);
    expect(cardGridColumns({ columns: 4, cards: [] as any })).toBe(4);
  });

  it("renders whole-card links safely and keeps body links out of linked cards", () => {
    const html = render(CardGridBlock, cards());
    expect(html).toContain(
      'class="cg-card is-link" href="https://example.com/start" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain("在新标签页打开");
    expect(html).toContain('class="cg-card is-link" href="#auth"');
    expect(html).toContain('href="mailto:help@example.com"');
    expect(html).toContain("<code>npm start</code>");
    expect(html).toContain('<a href="./glossary">术语表</a>');
    expect(html).toContain("cg-tone-teal");
    expect(html).toContain("cg-tone-brand");
    expect(html).toContain('data-columns="2"');
    // Data that skipped validation still never becomes a script link.
    const bad = cards();
    bad.cards[0].href = "javascript:alert(1)";
    expect(render(CardGridBlock, bad)).not.toContain("javascript:");
  });

  it("renders the compact row variant", () => {
    const data = cards();
    data.variant = "row";
    const html = render(CardGridBlock, data);
    expect(html).toContain("cg-block cg-row");
    expect(html).toContain('data-columns="2"');
  });
});

describe("catalog entries", () => {
  for (const kind of ["structure-browser", "card-grid"]) {
    const entry = catalog.find((item) => item.kind === kind) as any;
    it.skipIf(!entry)(
      `${kind} default data and examples pass the contract`,
      () => {
        validateDocBrowseData(kind, structuredClone(entry.defaultData));
        for (const example of entry.examples)
          validateDocBrowseData(kind, structuredClone(example.data));
      },
    );
  }
});
