import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockHeader } from "./shared";
import { FlowchartBlock } from "./Flowchart";
import { BookmarkBlock } from "./Bookmark";

describe("content-first component presentation", () => {
  it("omits type labels while retaining captions and edit access", () => {
    for (const title of [
      "交互流程图",
      "数据库",
      "关键指标",
      "图片画廊",
      "柱状图",
      "词云",
    ])
      expect(renderToStaticMarkup(createElement(BlockHeader, { title }))).toBe(
        "",
      );
    const caption = renderToStaticMarkup(
      createElement(BlockHeader, {
        title: "季度营收",
        description: "单位：万元",
        editable: true,
        editing: true,
      }),
    );
    expect(caption).toContain("季度营收");
    expect(caption).toContain("单位：万元");
    expect(caption).toContain("is-editing");
    expect(caption).toContain('aria-label="关闭设置"');
    const tools = renderToStaticMarkup(
      createElement(BlockHeader, { title: "数据图表", editable: true }),
    );
    expect(tools).toContain('aria-label="编辑区块"');
    expect(tools).not.toContain("sb-heading");
  });

  it("starts with the diagram alone even when nodes have supplementary details", () => {
    const html = renderToStaticMarkup(
      createElement(FlowchartBlock, {
        readOnly: true,
        data: {
          title: "交互流程图",
          flows: [
            {
              id: "flow",
              label: "流程",
              nodes: [{ id: "start", label: "开始", detail: "按需阅读的解释" }],
              edges: [],
            },
          ],
        },
      }),
    );
    expect(html).not.toContain("sb-heading");
    expect(html).not.toContain("sf-detail");
    expect(html).not.toContain("CLI 查询");
    expect(html).toContain('aria-label="节点列表"');
    expect(html).toContain('aria-label="放大流程图"');
  });

  it("shows a source's own title once without a component heading", () => {
    const html = renderToStaticMarkup(
      createElement(BookmarkBlock, {
        readOnly: true,
        data: {
          title: "来源论文",
          url: "https://example.com/paper",
          description: "实验出处",
        },
      }),
    );
    expect(html.match(/<strong>来源论文<\/strong>/g)).toHaveLength(1);
    expect(html).not.toContain("sb-header");
    expect(html).not.toContain("来源书签");
    expect(html).toContain("实验出处");
  });
});
