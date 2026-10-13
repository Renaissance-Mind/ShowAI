import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import catalog from "../../../resources/catalog/components.json";
import { ComparisonMatrixBlock } from "./ComparisonMatrix";
import { StatusTreeBlock } from "./StatusTree";
import { ExperimentTrackerBlock } from "./ExperimentTracker";
import {
  differingRows,
  experimentFrontier,
  statusCounts,
  validateAnalysisData,
} from "./analysis-contract.mjs";

const sample = (kind: string): any =>
  structuredClone(catalog.find((c) => c.kind === kind)!.examples[0].data);

describe("comparison matrix", () => {
  it("accepts its example and rejects cells that point nowhere", () => {
    const data = sample("comparison-matrix");
    expect(() => validateAnalysisData("comparison-matrix", data)).not.toThrow();
    data.cells.push({ row: "absent", column: "ppo", tone: "yes" });
    expect(() => validateAnalysisData("comparison-matrix", data)).toThrow(
      /row/,
    );
  });
  it("rejects duplicate cells, unknown tones and two highlighted columns", () => {
    const duplicate = sample("comparison-matrix");
    duplicate.cells.push({ ...duplicate.cells[0] });
    expect(() => validateAnalysisData("comparison-matrix", duplicate)).toThrow(
      /Duplicate cell/,
    );
    const tone = sample("comparison-matrix");
    tone.cells[0].tone = "maybe";
    expect(() => validateAnalysisData("comparison-matrix", tone)).toThrow(
      /tone/,
    );
    const highlight = sample("comparison-matrix");
    highlight.columns[0].highlight = true;
    highlight.columns[1].highlight = true;
    expect(() => validateAnalysisData("comparison-matrix", highlight)).toThrow(
      /highlighted/,
    );
  });
  it("finds rows that differ and treats missing cells as not covered", () => {
    const data = {
      rows: [
        { id: "same", label: "Same" },
        { id: "diff", label: "Different" },
        { id: "gap", label: "Gap" },
      ],
      columns: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      cells: [
        { row: "same", column: "a", tone: "yes", text: "x" },
        { row: "same", column: "b", tone: "yes", text: "x" },
        { row: "diff", column: "a", tone: "yes" },
        { row: "diff", column: "b", tone: "no" },
        { row: "gap", column: "a", tone: "yes" },
      ],
    };
    expect(differingRows(data)).toEqual(["diff", "gap"]);
  });
  it("renders every column and the highlighted one", () => {
    const data = sample("comparison-matrix");
    data.columns[3].highlight = true;
    const html = renderToStaticMarkup(
      createElement(ComparisonMatrixBlock, { data, readOnly: true }),
    );
    for (const column of data.columns) expect(html).toContain(column.label);
    expect(html).toContain("is-highlight");
    expect(html).toContain("只看差异");
  });
});

describe("status tree", () => {
  it("accepts default statuses and rejects items with undefined statuses", () => {
    const data = sample("status-tree");
    expect(() => validateAnalysisData("status-tree", data)).not.toThrow();
    data.groups[0].items[0].status = "unknown";
    expect(() => validateAnalysisData("status-tree", data)).toThrow(/status/);
  });
  it("uses custom statuses and keeps item ids unique across groups", () => {
    const data = sample("status-tree");
    data.statuses = [
      { id: "ok", label: "Shipped", tone: "done" },
      { id: "no", label: "Dropped", tone: "failed", color: "#aa3344" },
    ];
    expect(() => validateAnalysisData("status-tree", data)).toThrow(/status/);
    for (const group of data.groups)
      for (const item of group.items) item.status = "ok";
    expect(() => validateAnalysisData("status-tree", data)).not.toThrow();
    data.groups[1].items[0].id = data.groups[0].items[0].id;
    expect(() => validateAnalysisData("status-tree", data)).toThrow(
      /duplicate/,
    );
  });
  it("counts items per status and renders a static reading of every item", () => {
    const data = sample("status-tree");
    expect(statusCounts(data)).toEqual({
      done: 2,
      failed: 2,
      active: 1,
      todo: 1,
      paused: 1,
    });
    const html = renderToStaticMarkup(
      createElement(StatusTreeBlock, { data, readOnly: true }),
    );
    for (const group of data.groups)
      for (const item of group.items) expect(html).toContain(item.label);
    expect(html).toContain("走通 2");
  });
});

describe("experiment tracker", () => {
  const base = (direction: "higher" | "lower") => ({
    metric: { label: "score", direction },
    groups: [
      { id: "short", label: "Short" },
      { id: "long", label: "Long", frontier: false, shape: "diamond" },
    ],
    experiments: [
      {
        id: "a",
        name: "a",
        group: "short",
        status: "kept",
        start: "2026-01-01T01:00",
        score: 5,
      },
      {
        id: "b",
        name: "b",
        group: "short",
        status: "discarded",
        start: "2026-01-01T02:00",
        score: 3,
      },
      {
        id: "c",
        name: "c",
        group: "short",
        status: "kept",
        start: "2026-01-01T03:00",
        score: 7,
      },
      {
        id: "d",
        name: "d",
        group: "short",
        status: "failed",
        start: "2026-01-01T04:00",
        score: null,
      },
      {
        id: "e",
        name: "e",
        group: "long",
        status: "running",
        start: "2026-01-01T05:00",
        score: 99,
      },
    ],
  });
  it("builds the frontier inside eligible groups for either direction", () => {
    expect(experimentFrontier(base("higher"))).toEqual(["a", "c"]);
    expect(experimentFrontier(base("lower"))).toEqual(["a", "b"]);
  });
  it("rejects curves whose series do not match their steps and unknown groups", () => {
    const data = sample("experiment-tracker");
    expect(() =>
      validateAnalysisData("experiment-tracker", data),
    ).not.toThrow();
    data.runs[0].series.loss.pop();
    expect(() => validateAnalysisData("experiment-tracker", data)).toThrow(
      /match its steps/,
    );
    const group = sample("experiment-tracker");
    group.experiments[0].group = "absent";
    expect(() => validateAnalysisData("experiment-tracker", group)).toThrow(
      /group/,
    );
    const direction = sample("experiment-tracker");
    direction.metric.direction = "up";
    expect(() => validateAnalysisData("experiment-tracker", direction)).toThrow(
      /direction/,
    );
  });
  it("renders the metric direction, the static table and cost", () => {
    const data = sample("experiment-tracker");
    const html = renderToStaticMarkup(
      createElement(ExperimentTrackerBlock, { data, readOnly: true }),
    );
    expect(html).toContain("越低越好");
    expect(html).toContain(`以表格阅读全部实验（${data.experiments.length}）`);
    expect(html).toContain("估算成本");
    // A lower-is-better metric that beats its baseline reads as a positive gain.
    expect(html).toContain("比基线改善");
    expect(html).toMatch(/比基线改善<\/small><div class="an-stat-value">\+/);
    for (const experiment of data.experiments)
      expect(html).toContain(experiment.name);
  });
});
