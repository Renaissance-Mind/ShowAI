import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLocale } from "../../i18n";
import { describeError } from "./describe";
import { NoticeStack, ProblemNotice } from "./ProblemNotice";

describe("ProblemNotice", () => {
  it("renders what happened, safety, cause, actions and collapsed details", () => {
    setLocale("zh-CN");
    const problem = describeError(
      { code: "ERROR", errno: "ENOSPC", message: "ENOSPC: no space left on device" },
      { action: "导出页面", safety: "draftKept" },
    );
    const html = renderToStaticMarkup(
      createElement(ProblemNotice, {
        problem,
        actions: [{ label: "重试", onSelect: () => {} }],
        onDismiss: () => {},
      }),
    );
    expect(html).toContain("导出页面失败");
    expect(html).toContain("修改已保留在本机草稿中。");
    expect(html).toContain("磁盘空间不足");
    expect(html).toContain('class="is-primary"');
    expect(html).toMatch(
      /<details class="problem-notice-details"><summary>技术详情<\/summary>/,
    );
    expect(html).toContain("复制详情");
    expect(html).toContain("报告问题");
    expect(html).toContain('role="alert"');
  });

  it("stacks notices by priority behind 还有 N 项", () => {
    setLocale("zh-CN");
    const html = renderToStaticMarkup(
      createElement(
        NoticeStack,
        null,
        createElement("div", { key: "a", "data-priority": 1 }, "low"),
        false,
        createElement("div", { key: "b", "data-priority": 4 }, "high"),
        createElement("div", { key: "c", "data-priority": 1 }, "low2"),
      ),
    );
    expect(html).toContain("high");
    expect(html).not.toContain("low");
    expect(html).toContain("还有 2 项");
  });
});
