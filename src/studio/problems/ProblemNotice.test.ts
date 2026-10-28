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

  it("runs a banner's text together and can leave out the details", () => {
    setLocale("zh-CN");
    const problem = describeError(
      { code: "LOCKED", message: "library is locked" },
      { action: "保存", object: "周报", safety: "saved" },
    );
    const html = renderToStaticMarkup(
      createElement(ProblemNotice, {
        problem,
        details: false,
        actions: [
          { label: "重试保存", onSelect: () => {} },
          { label: "放弃保存", onSelect: () => {}, destructive: true },
        ],
      }),
    );
    expect(html).toMatch(
      /<p class="problem-notice-text"><strong class="problem-notice-title">「周报」保存失败<\/strong><span class="problem-notice-safety is-saved">内容已保存，没有受到影响。<\/span><span class="problem-notice-cause">内容库正在进行另一项操作，完成后再试。<\/span><\/p>/,
    );
    expect(html).toMatch(/<\/div><div class="problem-notice-actions">/);
    expect(html).toContain('class="is-destructive">放弃保存');
    expect(html).not.toContain("技术详情");
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
