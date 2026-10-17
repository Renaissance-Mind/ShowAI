import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  journeyStepEdges,
  validateFlowchartData,
} from "./flowchart-contract.mjs";
import { FlowchartBlock, initialPlayback, playbackView } from "./Flowchart";
import { validateDocument } from "../../portable/validation.mjs";

const flow = {
  id: "process",
  label: "流程",
  nodes: [
    { id: "a", label: "开始" },
    { id: "b", label: "结果" },
  ],
  edges: [{ id: "ab", source: "a", target: "b" }],
};
test("flowchart rejects dangling edges before saving or exporting a page", () => {
  const data = {
    flows: [
      { ...flow, edges: [{ id: "missing", source: "a", target: "absent" }] },
    ],
  };
  expect(() =>
    validateDocument({
      id: "flow",
      title: "Flow",
      content: {
        type: "doc",
        content: [{ type: "widget", attrs: { kind: "flowchart", data } }],
      },
    }),
  ).toThrow("missing node");
});
test("flowchart accepts finite saved positions and rejects conflicting node identities", () => {
  expect(() =>
    validateFlowchartData({
      flows: [
        {
          ...flow,
          nodes: [{ id: "a", label: "A", sourceSide: "center" }],
          edges: [],
        },
      ],
    }),
  ).toThrow("connection side");
  expect(validateFlowchartData({ flows: [flow] })).toEqual({ flows: [flow] });
  expect(() =>
    validateFlowchartData({
      flows: [{ ...flow, nodes: [...flow.nodes, flow.nodes[0]] }],
    }),
  ).toThrow("unique");
  expect(() =>
    validateFlowchartData({
      flows: [
        {
          ...flow,
          nodes: [{ id: "a", label: "A", position: { x: Infinity, y: 0 } }],
          edges: [],
        },
      ],
    }),
  ).toThrow("finite");
});

const route = {
  id: "route",
  label: "路线",
  nodes: [
    { id: "a", label: "入口" },
    { id: "b", label: "处理" },
    { id: "c", label: "存储" },
  ],
  edges: [
    { id: "ab", source: "a", target: "b" },
    { id: "cb", source: "c", target: "b", label: "回读" },
  ],
  journeys: [
    {
      id: "write",
      label: "写入",
      summary: "一次写入经过的模块",
      steps: [
        { node: "a", title: "提交", text: "用户提交内容。" },
        { node: "b", title: "处理", text: "服务校验输入。" },
        { node: "c", title: "保存", text: "写入存储。" },
        { node: "b", title: "确认", text: "返回结果。" },
      ],
    },
  ],
  stages: [
    {
      id: "calm",
      label: "13:50 正常",
      nodes: { a: { state: "ok" } },
    },
    {
      id: "slow",
      label: "14:02 变慢",
      summary: "存储变慢拖住处理。",
      nodes: {
        b: { state: "bad", note: "排队 600+" },
        c: { state: "warn", note: "约 120 ms" },
      },
      edges: { cb: { state: "bad", label: "超时" } },
    },
  ],
  initialStage: "slow",
};
const mutate = (patch: (flow: typeof route) => void) => {
  const copy = structuredClone(route);
  patch(copy);
  return () => validateFlowchartData({ flows: [copy] });
};

test("flowchart accepts journeys and stages and rejects broken references with a field path", () => {
  expect(validateFlowchartData({ flows: [route] })).toEqual({ flows: [route] });
  expect(
    mutate((flow) => (flow.journeys[0].steps[1].node = "missing")),
  ).toThrow(
    "flowchart.flows[0].journeys[0].steps[1].node references a missing node",
  );
  expect(
    mutate((flow) =>
      Object.assign(flow.journeys[0].steps[1], { edge: "nope" }),
    ),
  ).toThrow("steps[1].edge references a missing edge");
  expect(
    mutate((flow) => Object.assign(flow.journeys[0].steps[0], { edge: "cb" })),
  ).toThrow("steps[0].edge must connect to node a");
  expect(mutate((flow) => (flow.journeys[0].steps = []))).toThrow(
    "1 to 60 steps",
  );
  expect(
    mutate(
      (flow) => (flow.stages[1].nodes = { ghost: { state: "ok" } } as never),
    ),
  ).toThrow(
    "flowchart.flows[0].stages[1].nodes.ghost references a missing node",
  );
  expect(
    mutate(
      (flow) => (flow.stages[1].edges = { ab: { state: "down" } } as never),
    ),
  ).toThrow(
    "stages[1].edges.ab.state must be one of ok, warn, bad, idle, active",
  );
  expect(
    mutate((flow) => Object.assign(flow, { initialJourney: "elsewhere" })),
  ).toThrow("initialJourney references a missing journey");
  expect(
    mutate((flow) => {
      delete (flow as { stages?: unknown }).stages;
    }),
  ).toThrow("initialStage requires stages");
  expect(mutate((flow) => flow.stages.push({ ...flow.stages[0] }))).toThrow(
    "unique",
  );
});

test("journey playback lights the walked route, numbers revisits and dims the rest", () => {
  expect(journeyStepEdges(route, route.journeys[0])).toEqual([
    undefined,
    "ab",
    "cb",
    "cb",
  ]);
  const view = playbackView(route as never, {
    kind: "journey",
    id: "write",
    step: 3,
  });
  expect(view.current).toBe("b");
  expect(view.nodes.get("b")).toEqual({
    dim: false,
    badges: [2, 4],
    current: true,
  });
  expect(view.nodes.get("a")).toEqual({ dim: false, badges: [1] });
  expect(view.edges.get("cb")).toMatchObject({
    traversed: true,
    current: true,
  });
  const first = playbackView(route as never, {
    kind: "journey",
    id: "write",
    step: 0,
  });
  expect(first.nodes.get("c")?.dim).toBe(true);
  expect(first.edges.get("ab")).toEqual({ dim: true });
});

test("stage playback recolours nodes and edges and starts at the initial stage", () => {
  const mode = initialPlayback(route as never);
  expect(mode).toEqual({ kind: "stage", index: 1 });
  const view = playbackView(route as never, mode);
  expect(view.nodes.get("b")).toEqual({ state: "bad", note: "排队 600+" });
  expect(view.nodes.has("a")).toBe(false);
  expect(view.edges.get("cb")).toEqual({
    state: "bad",
    label: "超时",
    flowing: true,
  });
  // An edited flow that lost its stages falls back instead of failing.
  expect(
    playbackView({ ...route, stages: undefined } as never, mode).nodes.size,
  ).toBe(0);
});

test("playback renders controls, current step text and a printable list of every step", () => {
  let changed = 0;
  const html = renderToStaticMarkup(
    createElement(FlowchartBlock, {
      onChange: () => changed++,
      data: { flows: [{ ...route, initialJourney: "write" }] },
    }),
  );
  expect(html).toContain('aria-label="选择路线"');
  expect(html).toContain('aria-label="选择阶段"');
  expect(html).toContain("步骤 1/4");
  expect(html).toContain("用户提交内容。");
  expect(html).toContain('aria-label="下一步"');
  expect(html).toContain("播放");
  expect(html).toContain("从头开始");
  // Every step and stage is present as text for print and export.
  for (const text of ["返回结果。", "14:02 变慢", "排队 600+", "超时"])
    expect(html).toContain(text);
  expect(changed).toBe(0);
  const plain = renderToStaticMarkup(
    createElement(FlowchartBlock, { readOnly: true, data: { flows: [flow] } }),
  );
  expect(plain).not.toContain("sf-player");
  expect(plain).not.toContain("sf-outline");
});
