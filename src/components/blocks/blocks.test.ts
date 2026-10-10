import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Widget } from "./Widget";
import {
  blockDefinitions,
  createBlockData,
  getBlockDefinition,
  getRegistryRevision,
  registerBlock,
  subscribeToBlocks,
} from "./registry";
import {
  filterSortRows,
  parseChartData,
  safeImageUrl,
  safeUrl,
  toCsv,
} from "./helpers";
import { calculate } from "./Playground";
import { validateDocument } from "../../portable/validation.mjs";
import type { DatabaseColumn, DatabaseRow } from "./types";

describe("interactive block data", () => {
  it("offers one rich-text entry while retaining legacy text renderers", () => {
    expect(getBlockDefinition("text")!.title).toBe("富文本");
    for (const kind of ["callout", "divider", "code"]) {
      expect(blockDefinitions.some((block) => block.kind === kind)).toBe(false);
      expect(getBlockDefinition(kind)!.replacedBy).toBe("text");
      expect(
        renderToStaticMarkup(
          createElement(Widget, {
            kind,
            data: createBlockData(kind),
            readOnly: true,
          }),
        ),
      ).toContain("sb-primitive");
    }
    for (const kind of ["image", "table", "toggle"]) {
      expect(blockDefinitions.some((block) => block.kind === kind)).toBe(true);
    }
  });

  it("renders prose, quotes, lists, code and dividers from one Markdown content", () => {
    const html = renderToStaticMarkup(
      createElement(Widget, {
        kind: "text",
        data: {
          content:
            "## 标题\n\n正文 **强调**\n\n> 引用\n\n- 要点\n\n```javascript\nconst result = 1;\n```\n\n---",
          format: "markdown",
        },
        readOnly: true,
      }),
    );
    for (const markup of [
      "<h2>",
      "<strong>",
      "<blockquote>",
      "<ul>",
      '<code class="language-javascript">',
      "<hr/>",
    ]) {
      expect(html).toContain(markup);
    }
  });

  it("renders and exports every built-in empty block with independent data", () => {
    for (const block of [...blockDefinitions]) {
      const first = createBlockData(block.kind),
        second = createBlockData(block.kind);
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
      expect(() =>
        validateDocument({
          id: `block-${block.kind}`,
          title: "区块",
          content: {
            type: "doc",
            content: [
              { type: "widget", attrs: { kind: block.kind, data: first } },
            ],
          },
        }),
      ).not.toThrow();
      expect(
        renderToStaticMarkup(
          createElement(Widget, {
            kind: block.kind,
            data: first,
            readOnly: true,
          }),
        ),
      ).toMatch(/sb-block|sb-primitive/);
      first.title = "Changed title";
      expect(createBlockData(block.kind)).toEqual(second);
    }
  });

  it("preserves unknown block data as inert text and provides its source", () => {
    const data = { html: "<script>alert(1)</script>", nested: { value: 7 } };
    const html = renderToStaticMarkup(
      createElement(Widget, {
        kind: "unregistered-widget",
        data,
        readOnly: true,
      }),
    );
    expect(html).toContain("尚未注册");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("下载区块数据");
    expect(data.nested.value).toBe(7);
  });

  it("allows registration through the public React component API and notifies readers", () => {
    let notified = 0;
    const unsubscribe = subscribeToBlocks(() => {
      notified++;
    });
    const revision = getRegistryRevision();
    registerBlock({
      kind: "test-value-block",
      label: "值",
      description: "A custom block",
      createData: () => ({ value: 42 }),
      Component: ({ data }) =>
        createElement("output", null, String(data.value)),
    });
    expect(notified).toBe(1);
    expect(getRegistryRevision()).toBe(revision + 1);
    expect(getBlockDefinition("test-value-block")?.title).toBe("值");
    expect(
      renderToStaticMarkup(
        createElement(Widget, { kind: "test-value-block", data: { value: 7 } }),
      ),
    ).toContain("<output>7</output>");
    expect(() =>
      registerBlock({
        kind: "test-value-block",
        label: "duplicate",
        description: "",
        createData: () => ({}),
        Component: () => null,
      }),
    ).toThrow("already registered");
    expect(() =>
      registerBlock({
        kind: "bad-data-test",
        label: "invalid",
        description: "",
        createData: () => ({ value: undefined }),
        Component: () => null,
      }),
    ).toThrow("serializable");
    unsubscribe();
  });

  it("shows malformed built-in data without crashing or discarding the source", () => {
    const html = renderToStaticMarkup(
      createElement(Widget, {
        kind: "playground",
        data: { inputs: [null] },
        readOnly: true,
      }),
    );
    expect(html).toContain("区块数据需要检查");
    expect(html).toContain("null");
  });

  it("validates chart data lengths, finite numbers and color strings", () => {
    expect(
      parseChartData(
        '{"labels":["A","B"],"series":[{"name":"测量","values":[-1,2]}]}',
      ).series[0].values,
    ).toEqual([-1, 2]);
    expect(() =>
      parseChartData('{"labels":["A"],"series":[{"name":"x","values":[]}]}'),
    ).toThrow("数据数量");
    expect(() =>
      parseChartData('{"labels":["A"],"series":[{"name":"x","values":["1"]}]}'),
    ).toThrow("有限数字");
    expect(() =>
      parseChartData(
        '{"labels":[],"series":[{"name":"x","values":[],"color":"url(https://example.com)"}]}',
      ),
    ).toThrow("颜色");
  });

  it("filters, numerically sorts and exports actual database values without mutating rows", () => {
    const columns: DatabaseColumn[] = [
      { id: "title", name: "Title", type: "text" },
      { id: "count", name: "Count", type: "number" },
      { id: "status", name: "Status", type: "select" },
    ];
    const rows: DatabaseRow[] = [
      { id: "one", title: "Alpha", count: 10, status: "Open" },
      { id: "two", title: "Beta", count: 2, status: "Open" },
      { id: "three", title: "Gamma", count: 5, status: "Done" },
    ];
    const original = structuredClone(rows);
    expect(
      filterSortRows(
        rows,
        columns,
        "",
        { column: "status", value: "Open" },
        { column: "count", direction: "asc" },
      ).map((row) => row.id),
    ).toEqual(["two", "one"]);
    expect(
      filterSortRows(
        rows,
        columns,
        "ALPHA",
        { column: "", value: "" },
        null,
      ).map((row) => row.id),
    ).toEqual(["one"]);
    expect(rows).toEqual(original);
    const csv = toCsv(columns, [
      {
        id: "four",
        title: '=HYPERLINK("https://example.com")',
        count: -2,
        status: "line\nbreak",
      },
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"-2"');
    expect(csv).toContain('"line\nbreak"');
  });

  it("keeps calculation operations deterministic including an empty set", () => {
    expect(calculate([30, 7], "product")).toBe(210);
    expect(calculate([2, 4, 6], "average")).toBe(4);
    expect(calculate([-2, 1], "sum")).toBe(-1);
    expect(calculate([], "product")).toBe(0);
  });

  it("only opens web links and raster images, with no executable URL variants", () => {
    for (const unsafe of [
      "javascript:alert(1)",
      "data:text/html,<h1>hello</h1>",
      "file:///etc/passwd",
      " https://example.com",
      "https:\n//example.com",
    ])
      expect(safeUrl(unsafe)).toBeUndefined();
    expect(safeUrl("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(safeImageUrl("data:image/png;base64,iVBORw0KGgo=")).toBeDefined();
    expect(safeImageUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined();
  });
});
