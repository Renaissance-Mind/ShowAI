import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import catalog from "../../../resources/catalog/components.json";
import { MechanismStepsBlock, EvidenceExplorerBlock } from "./Presentation";
import { readBuiltinComponentSource, saveComponent } from "../../core/catalog";
import { FileStore } from "../../core/store";
import {
  evidenceTimeBuckets,
  selectEvidence,
  validatePresentationData,
} from "./presentation-contract.mjs";

const sample = (kind: string): any =>
  structuredClone(catalog.find((c) => c.kind === kind)!.examples[0].data);
const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});
describe("presentation reading contracts", () => {
  it("renders explicit input and output while keeping the original content unchanged", () => {
    const data = sample("mechanism-steps");
    data.initialStates[0].value = "原始输入";
    data.frames[0].headline = "本步讲解标题";
    data.frames[0].states[0].tokens = ["甲", "乙"];
    const before = structuredClone(data);
    const html = renderToStaticMarkup(
      createElement(MechanismStepsBlock, { data, readOnly: true }),
    );
    expect(html).toContain("进入本步前");
    expect(html).toContain("完成本步后");
    expect(html).toContain("原始输入");
    expect(html).toContain("本步讲解标题");
    expect(html).toContain("<li>甲</li><li>乙</li>");
    expect(data).toEqual(before);
  });
  it("keeps legacy frames readable without inventing initial values", () => {
    const data = sample("mechanism-steps");
    delete data.initialStates;
    for (const frame of data.frames) {
      delete frame.inputSummary;
      delete frame.outputSummary;
      delete frame.actionLabel;
    }
    validatePresentationData("mechanism-steps", data);
    const html = renderToStaticMarkup(
      createElement(MechanismStepsBlock, { data, readOnly: true }),
    );
    const input = html
      .split('aria-label="进入本步前"')[1]
      .split("</section>")[0];
    expect(input).toContain("从这些对象开始");
    expect(input).toContain("分子");
    expect(input).not.toContain('class="ms-tokens"');
    expect(html).toContain(data.frames[1].explanation);
  });
  it("validates the first input and bounded token labels just like frame states", () => {
    const data = sample("mechanism-steps");
    data.initialStates.pop();
    expect(() => validatePresentationData("mechanism-steps", data)).toThrow(
      /stable part/,
    );
    delete data.initialStates;
    data.frames[0].states[0].tokens = ["valid", ""];
    expect(() => validatePresentationData("mechanism-steps", data)).toThrow(
      /tokens/,
    );
    data.frames[0].states[0].tokens = Array(13).fill("label");
    expect(() => validatePresentationData("mechanism-steps", data)).toThrow(
      /12/,
    );
    delete data.frames[0].states[0].tokens;
    data.frames[0].inputSummary = "x".repeat(241);
    expect(() => validatePresentationData("mechanism-steps", data)).toThrow(
      /240/,
    );
  });
  it("compiles the redesigned mechanism as a reusable SDK component", async () => {
    const home = await mkdtemp(join(tmpdir(), "mechanism-sdk-"));
    temporary.push(home);
    const project = await new FileStore(home).createProject({
      name: "Mechanism SDK",
    });
    const compiled = await saveComponent(
      home,
      readBuiltinComponentSource("mechanism-steps"),
      project.id,
    );
    expect(compiled.inline!.script).toContain("ms-transition");
    expect(compiled.version).toBe("1.1.0");
  }, 60000);
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
