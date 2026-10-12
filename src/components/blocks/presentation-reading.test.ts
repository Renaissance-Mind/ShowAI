import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import catalog from "../../../resources/catalog/components.json";
import { MechanismStepsBlock, EvidenceExplorerBlock } from "./Presentation";
import {
  evidenceTimeBuckets,
  selectEvidence,
  validatePresentationData,
} from "./presentation-contract.mjs";

const sample = (kind: string): any =>
  structuredClone(catalog.find((c) => c.kind === kind)!.examples[0].data);
describe("presentation reading contracts", () => {
  it("rejects states that lose object identity between frames", () => {
    const data = sample("mechanism-steps");
    data.frames[1].states[1].id = "absent";
    expect(() => validatePresentationData("mechanism-steps", data)).toThrow(
      /stable part/,
    );
  });
  it("rejects arrows to missing objects and duplicate ids", () => {
    const data = sample("mechanism-steps");
    data.frames[0].links[0].to = "absent";
    expect(() => validatePresentationData("mechanism-steps", data)).toThrow(
      /existing parts/,
    );
    data.parts.push(data.parts[0]);
    expect(() => validatePresentationData("mechanism-steps", data)).toThrow(
      /duplicate/,
    );
  });
  it("does not accept invented comparison dimensions or executable sources", () => {
    const data = sample("evidence-explorer");
    data.items[0].values.unknown = "value";
    expect(() => validatePresentationData("evidence-explorer", data)).toThrow(
      /dimension/,
    );
    delete data.items[0].values.unknown;
    data.items[0].sources = [{ label: "source", url: "javascript:alert(1)" }];
    expect(() => validatePresentationData("evidence-explorer", data)).toThrow(
      /http/,
    );
  });
  it("requires date meaning and keeps missing measurements visible", () => {
    const data = sample("evidence-explorer");
    data.items[0].date = "2026-10";
    expect(() => validatePresentationData("evidence-explorer", data)).toThrow(
      /dateLabel/,
    );
    data.items[0].dateLabel = "发布";
    delete data.items[0].values.angle;
    validatePresentationData("evidence-explorer", data);
    expect(
      renderToStaticMarkup(
        createElement(EvidenceExplorerBlock, { data, readOnly: true }),
      ),
    ).toContain("资料未提供");
  });
  it("searches conditions as well as titles without changing source order or values", () => {
    const data = sample("evidence-explorer");
    const before = structuredClone(data);
    expect(
      selectEvidence(data.items, "四边形", "反向命题").map((i) => i.id),
    ).toEqual(["square"]);
    expect(selectEvidence(data.items, "missing", "")).toEqual([]);
    expect(data).toEqual(before);
  });
  it("ships the complete static mechanism and evidence even when one step is selected", () => {
    const mechanism = sample("mechanism-steps");
    const evidence = sample("evidence-explorer");
    const first = renderToStaticMarkup(
      createElement(MechanismStepsBlock, { data: mechanism, readOnly: true }),
    );
    expect(first).toContain('class="sp-print"');
    expect(first).toContain(mechanism.frames[1].explanation);
    const second = renderToStaticMarkup(
      createElement(EvidenceExplorerBlock, { data: evidence, readOnly: true }),
    );
    expect(second).toContain(evidence.items[1].boundary);
  });
  it("accepts real templates with empty visual regions and validates their populated variants", () => {
    for (const kind of ["mechanism-steps", "evidence-explorer"]) {
      validatePresentationData(
        kind,
        catalog.find((c) => c.kind === kind)!.defaultData,
      );
      validatePresentationData(kind, sample(kind));
    }
  });
});

it("groups evidence by explicit time scale without inventing missing periods", () => {
  const items = [
    { date: "2026-10-12" },
    { date: "2026-06" },
    { date: "2025-03-01" },
    {},
  ];
  expect(evidenceTimeBuckets(items, "month")).toEqual([
    "2025-03",
    "2026-06",
    "2026-10",
  ]);
  expect(evidenceTimeBuckets(items, "year")).toEqual(["2025", "2026"]);
});
it("rejects impossible calendar dates before placing events on an axis", () => {
  const data = sample("evidence-explorer");
  data.items[0].date = "2026-02-30";
  data.items[0].dateLabel = "发布";
  expect(() => validatePresentationData("evidence-explorer", data)).toThrow(
    /calendar date/,
  );
});
