import { expect, test } from "vitest";
import { validateFlowchartData } from "./flowchart-contract.mjs";
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
