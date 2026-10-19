import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import catalog from "../../../resources/catalog/components.json";
import { StepWalkthroughBlock } from "./StepWalkthrough";
import {
  summarizeWalkthrough,
  validateWalkthroughData,
} from "./walkthrough-contract.mjs";
import { readBuiltinComponentSource, saveComponent } from "../../core/catalog";
import { FileStore } from "../../core/store";

const entry = catalog.find((c) => c.kind === "step-walkthrough")!;
const example = (index = 0): any => structuredClone(entry.examples[index].data);
const render = (data: unknown) =>
  renderToStaticMarkup(
    createElement(StepWalkthroughBlock, {
      data: data as never,
      readOnly: true,
    }),
  );
const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});

describe("step walkthrough", () => {
  it("accepts the default data and every catalog example", () => {
    validateWalkthroughData(entry.defaultData);
    for (const item of entry.examples) validateWalkthroughData(item.data);
  });

  it("shows the takeaway, the concrete actions and each part's entries without changing the data", () => {
    const data = example();
    const before = structuredClone(data);
    const html = render(data);
    expect(html).toContain(data.steps[0].takeaway);
    expect(html).toContain("本步的输入与操作");
    expect(html).toContain("此时的状态");
    expect(html).toContain('data-status="new"');
    expect(html).toContain("新增");
    expect(data).toEqual(before);
  });

  it("marks diff lines and custom status labels", () => {
    const data = example();
    data.steps[0].actions[0].code = "- old()\n+ next()";
    data.steps[0].entries[0].statusLabel = "已写入";
    const html = render(data);
    expect(html).toContain('data-diff="del"');
    expect(html).toContain('data-diff="add"');
    expect(html).toContain("已写入");
  });

  it("opens on the initial step and lays out every step for print", () => {
    const data = example();
    data.initialStep = "evict";
    const html = render(data);
    const live = html.split('class="wk-print"')[0];
    expect(live).toContain(data.steps[2].takeaway);
    expect(live).not.toContain(data.steps[0].takeaway);
    const print = html.split('class="wk-print"')[1];
    for (const step of data.steps) expect(print).toContain(step.takeaway);
  });

  it("renders the output step with its blocks and the hide switch", () => {
    const data = example(1);
    data.initialStep = data.steps.at(-1).id;
    const html = render(data);
    const live = html.split('class="wk-print"')[0];
    expect(live).toContain("chain_block");
    expect(live).toContain('type="checkbox"');
    expect(live).toContain(data.steps.at(-1).output.hideLabel);
  });

  it("reports per-step counts by part and status", () => {
    const counts = summarizeWalkthrough(example());
    expect(counts[2].parts[0]).toEqual({
      id: "cache",
      total: 3,
      active: 2,
      new: 1,
      changed: 0,
      retired: 1,
    });
    expect(counts[3].outputBlocks).toEqual(["r"]);
  });

  it("rejects broken references, duplicates and unsafe sources", () => {
    const data = example();
    data.steps[0].entries[0].partId = "missing";
    expect(() => validateWalkthroughData(data)).toThrow(/existing part/);
    data.steps[0].entries[0].partId = "cache";
    data.steps.push(structuredClone(data.steps[0]));
    expect(() => validateWalkthroughData(data)).toThrow(/duplicates id/);
    data.steps.pop();
    data.initialStep = "missing";
    expect(() => validateWalkthroughData(data)).toThrow(/initialStep/);
    delete data.initialStep;
    data.steps[0].entries[0].status = "superseded";
    expect(() => validateWalkthroughData(data)).toThrow(/status/);
    data.steps[0].entries[0].status = "new";
    data.steps[0].sources = [{ label: "x", url: "javascript:alert(1)" }];
    expect(() => validateWalkthroughData(data)).toThrow(/http/);
    delete data.steps[0].sources;
    data.steps[3].output.hidePartId = "order";
    expect(() => validateWalkthroughData(data)).toThrow(/hidePartId/);
  });

  it("shows an explicit empty state", () => {
    const html = render({ title: "空", parts: [], steps: [] });
    expect(html).toContain("尚无步骤");
  });

  it("compiles as a reusable SDK component", async () => {
    const home = await mkdtemp(join(tmpdir(), "walkthrough-sdk-"));
    temporary.push(home);
    const project = await new FileStore(home).createProject({
      name: "Walkthrough SDK",
    });
    const compiled = await saveComponent(
      home,
      readBuiltinComponentSource("step-walkthrough"),
      project.id,
    );
    expect(compiled.inline!.script).toContain("wk-takeaway");
    expect(compiled.version).toBe("1.0.0");
  }, 60000);
});
