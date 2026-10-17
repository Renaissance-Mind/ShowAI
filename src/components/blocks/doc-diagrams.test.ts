import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SequenceDiagramBlock } from "./SequenceDiagram";
import { LayerDiagramBlock } from "./LayerDiagram";
import { validateDocDiagramData } from "./doc-diagrams-contract.mjs";

const sequence = (): any => ({
  title: "一次修改怎样到达其他成员",
  actors: [
    { id: "a", label: "你的设备", icon: "💻", tone: "accent" },
    { id: "s", label: "同步服务器", sub: "WebSocket", tone: "teal" },
    { id: "b", label: "成员的设备", tone: "orange" },
  ],
  steps: [
    { from: "a", to: "a", label: "本机保存", kind: "note" },
    {
      from: "a",
      to: "s",
      label: "上传缺少的对象",
      detail: "只传输**变化的部分**，见 [说明](https://example.com/sync)。",
    },
    { from: "s", to: "a", label: "新的版本号", kind: "reply" },
    { from: "s", to: "b", label: "推送变化通知", detail: "使用 `WebSocket`。" },
  ],
});

const layers = (): any => ({
  caption: "上层只调用下层。",
  initial: "store",
  layers: [
    {
      id: "entry",
      name: "入口",
      sub: "启动方式不同，能力相同",
      modules: [
        { id: "desktop", name: "桌面 App", path: "src/desktop/main.ts" },
        { id: "cli", name: "命令行", detail: "一条命令执行一次。" },
      ],
    },
    {
      id: "core",
      name: "核心",
      tone: "orange",
      modules: [
        {
          id: "store",
          name: "存储",
          path: "src/core/store.ts",
          detail: "内容已被改过时**拒绝覆盖**。",
        },
      ],
    },
    { id: "empty", name: "预留", modules: [] },
  ],
});

const render = (Block: any, data: unknown) =>
  renderToStaticMarkup(createElement(Block, { data, readOnly: true }));

describe("sequence diagram contract", () => {
  it("accepts a complete sequence", () => {
    expect(() =>
      validateDocDiagramData("sequence-diagram", sequence()),
    ).not.toThrow();
  });
  it("rejects steps that point at missing actors with the step path", () => {
    const data = sequence();
    data.steps[2].to = "nobody";
    expect(() => validateDocDiagramData("sequence-diagram", data)).toThrow(
      "steps[2].to nobody does not match an actor id.",
    );
  });
  it("rejects duplicate actors, unknown kinds and tones, and too many steps", () => {
    const duplicate = sequence();
    duplicate.actors[2].id = "a";
    expect(() => validateDocDiagramData("sequence-diagram", duplicate)).toThrow(
      /actors\[2\]\.id duplicates id a/,
    );
    const kind = sequence();
    kind.steps[0].kind = "async";
    expect(() => validateDocDiagramData("sequence-diagram", kind)).toThrow(
      /steps\[0\]\.kind/,
    );
    const tone = sequence();
    tone.actors[0].tone = "brand";
    expect(() => validateDocDiagramData("sequence-diagram", tone)).toThrow(
      /actors\[0\]\.tone/,
    );
    const long = sequence();
    long.steps = Array.from({ length: 41 }, () => long.steps[1]);
    expect(() => validateDocDiagramData("sequence-diagram", long)).toThrow(
      /steps must be an array of 1 to 40/,
    );
    expect(() =>
      validateDocDiagramData("sequence-diagram", { ...sequence(), steps: [] }),
    ).toThrow(/steps/);
  });
});

describe("layer diagram contract", () => {
  it("accepts layers, including one without modules", () => {
    expect(() =>
      validateDocDiagramData("layer-diagram", layers()),
    ).not.toThrow();
  });
  it("requires module ids unique across layers and initial to exist", () => {
    const duplicate = layers();
    duplicate.layers[1].modules[0].id = "cli";
    expect(() => validateDocDiagramData("layer-diagram", duplicate)).toThrow(
      /layers\[1\]\.modules\[0\]\.id duplicates id cli/,
    );
    const initial = layers();
    initial.initial = "missing";
    expect(() => validateDocDiagramData("layer-diagram", initial)).toThrow(
      "initial missing does not match a module id.",
    );
    const nameless = layers();
    nameless.layers[0].modules[1].name = " ";
    expect(() => validateDocDiagramData("layer-diagram", nameless)).toThrow(
      /layers\[0\]\.modules\[1\]\.name/,
    );
  });
  it("rejects unknown kinds and non-object data", () => {
    expect(() => validateDocDiagramData("venn", {})).toThrow(/Unknown/);
    expect(() => validateDocDiagramData("layer-diagram", [])).toThrow(
      /must be an object/,
    );
  });
});

describe("sequence diagram rendering", () => {
  it("draws every actor and step, the first step current and later ones faded", () => {
    const html = render(SequenceDiagramBlock, sequence());
    for (const label of [
      "你的设备",
      "同步服务器",
      "上传缺少的对象",
      "推送变化通知",
    ])
      expect(html).toContain(label);
    expect(html.match(/class="sq-step"/g)).toHaveLength(4);
    expect(html).toContain('data-state="cur" data-kind="note"');
    expect(html.match(/data-state="todo"/g)).toHaveLength(3);
    // Replies use the dashed line and open arrow head.
    expect(html).toContain("data-reply");
    expect(html).toContain("sq-open");
    expect(html).toContain("第 1 / 4 步");
  });
  it("keeps every step and detail in the static list for print", () => {
    const html = render(SequenceDiagramBlock, sequence());
    const staticList = html.slice(html.indexOf('class="sq-static"'));
    expect(staticList).toContain("<strong>变化的部分</strong>");
    expect(staticList).toContain('href="https://example.com/sync"');
    expect(staticList).toContain("<code>WebSocket</code>");
    expect(staticList.match(/<li>/g)).toHaveLength(4);
  });
  it("skips steps whose actors are missing instead of failing to render", () => {
    const data = sequence();
    data.steps.push({ from: "a", to: "ghost", label: "丢失" });
    const html = render(SequenceDiagramBlock, data);
    expect(html).not.toContain("丢失");
    expect(html).toContain("第 1 / 4 步");
  });
});

describe("layer diagram rendering", () => {
  it("renders layers top-down with the initial module selected and its detail", () => {
    const html = render(LayerDiagramBlock, layers());
    expect(html.indexOf("入口")).toBeLessThan(html.indexOf("核心"));
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    const panel = html.slice(html.indexOf('class="ly-panel"'));
    expect(panel).toContain("src/core/store.ts");
    expect(panel).toContain("<strong>拒绝覆盖</strong>");
    expect(html).toContain("暂无模块");
    // Layers without a tone take the default order; the second layer keeps its own.
    expect(html).toContain('data-tone="accent"');
    expect(html).toContain('data-tone="orange"');
    expect(html).toContain('data-tone="violet"');
  });
  it("prompts for a selection without an initial module and lists everything for print", () => {
    const data = layers();
    delete data.initial;
    const html = render(LayerDiagramBlock, data);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain("选择上方任一模块");
    const staticList = html.slice(html.indexOf('class="ly-static"'));
    expect(staticList).toContain("src/desktop/main.ts");
    expect(staticList).toContain("一条命令执行一次。");
  });
});
