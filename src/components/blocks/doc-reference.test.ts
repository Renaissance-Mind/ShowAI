import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StepGuideBlock } from "./StepGuide";
import { CommandReferenceBlock } from "./CommandReference";
import {
  commandMatches,
  matchRanges,
  searchTerms,
  stepTimeline,
  timelineTicks,
  validateDocReferenceData,
} from "./doc-reference-contract.mjs";

const guide = (): any => ({
  title: "安装",
  steps: [
    {
      id: "node",
      title: "准备 Node.js",
      body: "需要 **Node.js 22** 或更高版本。",
      variants: [
        { label: "macOS", code: "brew install node@22\nnode --version" },
        { label: "Windows", code: "winget install OpenJS.NodeJS.LTS" },
      ],
      result: "终端输出 `v22.12.0`。",
    },
    {
      id: "build",
      title: "构建",
      code: "# install\nnpm ci",
      lang: "sh",
      timer: { minutes: 3, label: "等待安装" },
      segments: [
        { start: 0, minutes: 2, kind: "active" },
        { start: 2, minutes: 8, kind: "wait" },
      ],
      cue: "看到 added 字样。",
      wait: "趁机阅读文档。",
    },
    {
      id: "open",
      title: "打开 [文档](https://example.com/docs)",
      note: "保持终端运行。",
    },
  ],
});

const reference = (): any => ({
  program: "tool",
  groups: [
    { id: "start", label: "启动" },
    { id: "pages", label: "页面" },
  ],
  commands: [
    {
      group: "start",
      command: "tool serve [--port PORT]",
      summary: "启动本地服务",
      params: [{ name: "--port PORT", meaning: "指定端口" }],
      examples: [{ code: "tool serve --port 5173" }],
    },
    {
      group: "pages",
      command: "tool pages read PAGE",
      summary: "读取 `page` 内容",
      detail: "返回 JSON。\n\n- 支持 outline\n- 支持 image",
      params: [{ name: "--format json|markdown", meaning: "输出格式" }],
    },
    { group: "pages", command: "tool pages list", summary: "列出页面" },
  ],
});

describe("step guide contract", () => {
  it("accepts a guide and reports precise paths for invalid steps", () => {
    expect(() => validateDocReferenceData("step-guide", guide())).not.toThrow();
    const both = guide();
    both.steps[0].code = "echo";
    expect(() => validateDocReferenceData("step-guide", both)).toThrow(
      /steps\[0\] uses either code or variants/,
    );
    const duplicate = guide();
    duplicate.steps[2].id = "node";
    expect(() => validateDocReferenceData("step-guide", duplicate)).toThrow(
      /steps\[2\]\.id duplicates node/,
    );
    const segment = guide();
    segment.steps[1].segments[1].kind = "passive";
    expect(() => validateDocReferenceData("step-guide", segment)).toThrow(
      /steps\[1\]\.segments\[1\]\.kind/,
    );
    const timer = guide();
    timer.steps[1].timer.minutes = 0;
    expect(() => validateDocReferenceData("step-guide", timer)).toThrow(
      /steps\[1\]\.timer\.minutes/,
    );
    const field = guide();
    field.steps[0].text = "legacy";
    expect(() => validateDocReferenceData("step-guide", field)).toThrow(
      /steps\[0\]\.text is not a known field/,
    );
  });
  it("checks layout, initial step and variant labels", () => {
    expect(() =>
      validateDocReferenceData("step-guide", { ...guide(), layout: "grid" }),
    ).toThrow(/layout/);
    expect(() =>
      validateDocReferenceData("step-guide", { ...guide(), initialStep: 3 }),
    ).toThrow(/initialStep/);
    const labels = guide();
    labels.steps[0].variants[1].label = "macOS";
    expect(() => validateDocReferenceData("step-guide", labels)).toThrow(
      /variants\[1\]\.label duplicates/,
    );
    expect(() => validateDocReferenceData("unknown", guide())).toThrow(
      /Unknown/,
    );
  });
  it("sums active and waiting minutes and spaces the axis", () => {
    expect(stepTimeline(guide().steps)).toEqual({
      active: 2,
      wait: 8,
      total: 10,
    });
    expect(timelineTicks(10)).toEqual([0, 5, 10]);
    expect(timelineTicks(160)).toEqual([0, 30, 60, 90, 120, 150]);
    expect(timelineTicks(0)).toEqual([]);
  });
});

describe("step guide rendering", () => {
  it("lists every step with code variants, hints, timer and ribbon", () => {
    const html = renderToStaticMarkup(
      createElement(StepGuideBlock, { data: guide(), readOnly: true }),
    );
    for (const title of ["准备 Node.js", "构建"]) expect(html).toContain(title);
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain("<strong>Node.js 22</strong>");
    expect(html).toContain('role="tablist"');
    // The inactive variant stays in the document for print.
    expect(html).toContain("winget install");
    expect(html).toContain('class="sg-comment"');
    expect(html).toContain("已完成 0 / 3 步");
    expect(html).toContain("开始计时");
    expect(html).toContain("3:00");
    expect(html).toContain("看到这样就对了");
    expect(html).toContain("sg-seg is-wait");
    expect(html).toContain("10 分钟");
  });
  it("shows one step in focus mode and keeps a printable list of all steps", () => {
    const data = { ...guide(), layout: "focus", initialStep: 1, start: 0 };
    const html = renderToStaticMarkup(
      createElement(StepGuideBlock, { data, readOnly: true }),
    );
    expect(html).toContain("步骤 2 / 3");
    expect(html).toContain("sg-ring");
    expect(html).toContain('class="sg-print" start="0"');
    expect(html).toContain("等待安装 · 3 分钟");
    expect(html).toContain("保持终端运行。");
    expect(html).toContain("上一步");
  });
});

describe("command reference", () => {
  it("validates groups, commands and parameters with precise paths", () => {
    expect(() =>
      validateDocReferenceData("command-reference", reference()),
    ).not.toThrow();
    const group = reference();
    group.commands[1].group = "absent";
    expect(() => validateDocReferenceData("command-reference", group)).toThrow(
      /commands\[1\]\.group absent does not match/,
    );
    const duplicate = reference();
    duplicate.groups[1].id = "start";
    expect(() =>
      validateDocReferenceData("command-reference", duplicate),
    ).toThrow(/groups\[1\]\.id duplicates/);
    const param = reference();
    param.commands[0].params.push({ name: "--port PORT", meaning: "again" });
    expect(() => validateDocReferenceData("command-reference", param)).toThrow(
      /params\[1\]\.name duplicates/,
    );
    const legacy = reference();
    legacy.commands[0].flags = [];
    expect(() => validateDocReferenceData("command-reference", legacy)).toThrow(
      /commands\[0\]\.flags is not a known field/,
    );
  });
  it("matches every term across command, summary and parameters", () => {
    const [serve, read] = reference().commands;
    expect(commandMatches(serve, searchTerms("serve PORT"))).toBe(true);
    expect(commandMatches(read, searchTerms("markdown"))).toBe(true);
    expect(commandMatches(read, searchTerms("page serve"))).toBe(false);
    expect(matchRanges("pages read PAGE", ["page", "ead"])).toEqual([
      [0, 4],
      [7, 10],
      [11, 15],
    ]);
  });
  it("renders groups with counts, styled command lines and collapsed details", () => {
    const html = renderToStaticMarkup(
      createElement(CommandReferenceBlock, {
        data: reference(),
        readOnly: true,
      }),
    );
    expect(html).toContain("3 条命令");
    expect(html).toContain("启动<span>1</span>");
    expect(html).toContain("页面<span>2</span>");
    expect(html).toContain('<span class="cr-prog">tool</span>');
    expect(html).toContain('<span class="cr-verb">pages</span>');
    expect(html).toContain('<span class="cr-flag">[--port</span>');
    expect(html).toContain('<span class="cr-ph">PAGE</span>');
    // Details stay in the document (hidden) so print and static reading keep them.
    expect(html).toMatch(/class="cr-detail"[^>]*hidden/);
    expect(html).toContain("<li>支持 outline</li>");
    expect(html).toContain("tool serve --port 5173");
    expect(html).toContain("指定端口");
  });
});
