import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartBlock } from "./Chart";

const render = (data: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ChartBlock, { data }));
const viewHeight = (html: string) =>
  Number(/viewBox="0 0 760 (\d+(?:\.\d+)?)"/.exec(html)?.[1]);

describe("chart bars keep every category label", () => {
  it("lays many categories out horizontally with all labels", () => {
    const labels = Array.from(
      { length: 13 },
      (_, index) => `基准 ${index + 1}`,
    );
    const html = render({
      type: "bar",
      labels,
      series: [
        { name: "扩散", values: labels.map((_, index) => 40 + index) },
        { name: "自回归", values: labels.map((_, index) => 50 + index) },
      ],
    });
    for (const label of labels) expect(html).toContain(`>${label}<`);
    expect(viewHeight(html)).toBeGreaterThan(272);
    expect(html).toContain('text-anchor="end"');
  });

  it("lays long labels out horizontally even with few categories", () => {
    const html = render({
      type: "bar",
      labels: ["长上下文检索准确率", "多轮对话一致性评分", "代码补全通过率"],
      series: [{ name: "得分", values: [61, 72, 58] }],
    });
    expect(html).toContain('text-anchor="end"');
    expect(html).toContain(">长上下文检索准确率<");
  });

  it("shows lying labels in full up to the label column and shortens longer ones with the full text on hover", () => {
    const long = "一个非常非常非常非常非常非常非常长的基准名称";
    const html = render({
      type: "bar",
      labels: [
        "LiveCodeBench",
        long,
        ...Array.from({ length: 10 }, (_, i) => `B${i}`),
      ],
      series: [{ name: "得分", values: Array.from({ length: 12 }, () => 50) }],
    });
    expect(html).toContain('class="sb-chart-label">LiveCodeBench<');
    expect(html).toContain(`data-showai-note="${long}"`);
    expect(html).not.toContain(`class="sb-chart-label">${long}<`);
    expect(html).toContain("<title>LiveCodeBench · 得分: 50</title>");
  });

  it("keeps short, few categories as vertical bars and lines unchanged", () => {
    const bars = render({
      type: "bar",
      labels: ["命中", "未命中"],
      series: [{ name: "次数", values: [8, 2] }],
    });
    expect(viewHeight(bars)).toBe(272);
    expect(bars).toContain(">命中<");
    const line = render({
      type: "line",
      labels: Array.from({ length: 30 }, (_, index) => `第${index + 1}步`),
      series: [{ name: "损失", values: Array.from({ length: 30 }, () => 1) }],
    });
    expect(viewHeight(line)).toBe(272);
  });
});
