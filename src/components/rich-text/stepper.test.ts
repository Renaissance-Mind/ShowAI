import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import Ajv from "ajv";
import type { JSONContent } from "@tiptap/core";
import { validatePrimitiveData } from "../blocks/primitive-contract.mjs";
import { Widget } from "../blocks/Widget";
import { blankDocument } from "../../core/catalog";
import { insertComponent } from "../../surface/component-insertion";
import { findSurfaceNode } from "../../surface/document.mjs";
import { validateDocument } from "../../portable/validation.mjs";
import { structuredContent } from "../../agent/page-structured";
import { builtinComponent } from "../catalog";
import { RichTextNode } from "./RichTextView";

const data = {
  steps: [
    { title: "初始安排", content: "展览定在**周六 15:00**。" },
    { title: "正式改期", content: "改到周日 16:00。" },
    { content: "没有标题的一步。" },
  ],
};

function insertStepper() {
  const inserted = insertComponent(blankDocument(), null, "stepper", data);
  const document = validateDocument(inserted.document);
  const stepper = findSurfaceNode(document, inserted.nodeId)!.node;
  return { document, stepper };
}

test("stepper data passes its schema and builds one step node per step", () => {
  expect(() => validatePrimitiveData("stepper", data)).not.toThrow();
  const validate = new Ajv({ strict: false }).compile(
    builtinComponent("stepper")!.propsSchema,
  );
  expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  const { stepper } = insertStepper();
  expect(stepper.type).toBe("stepper");
  expect(stepper.content!.map((step: JSONContent) => step.type)).toEqual([
    "step",
    "step",
    "step",
  ]);
  expect(stepper.content![0].attrs!.title).toBe("初始安排");
});

test("rejects empty steppers, too many steps and foreign children", () => {
  expect(() => validatePrimitiveData("stepper", { steps: [] })).toThrow();
  expect(() =>
    validatePrimitiveData("stepper", {
      steps: Array.from({ length: 13 }, () => ({ content: "x" })),
    }),
  ).toThrow();
  const { document, stepper } = insertStepper();
  stepper.content!.push({ type: "paragraph" });
  expect(() => validateDocument(document)).toThrow(/invalid child/);
});

test("puts another component inside a step and keeps it there", () => {
  const { document, stepper } = insertStepper();
  const stepId = stepper.content![1].attrs!.id;
  const inserted = insertComponent(document, stepId, "metrics", {
    title: "命中",
    items: [{ label: "命中", value: "71,168" }],
  });
  const saved = validateDocument(inserted.document);
  const step = findSurfaceNode(saved, stepId)!.node;
  expect(step.content!.at(-1)).toMatchObject({
    type: "widget",
    attrs: { kind: "metrics" },
  });
  expect(saved.layout?.[inserted.nodeId]).toBeUndefined();
  expect(() => insertComponent(saved, stepId, "page", {})).toThrow(/step/);
});

test("the reader shows the first step and keeps every step for print", () => {
  const { stepper } = insertStepper();
  const html = renderToStaticMarkup(
    createElement(RichTextNode, { node: stepper }),
  );
  expect(html.match(/role="tab"/g)).toHaveLength(3);
  expect(html.match(/class="stepper-step"/g)).toHaveLength(3);
  expect(html.match(/data-active=""/g)).toHaveLength(1);
  expect(html).toContain("第 3 步");
  expect(html).toContain("<strong>周六 15:00</strong>");
  const widget = renderToStaticMarkup(
    createElement(Widget, { kind: "stepper", data, readOnly: true }),
  );
  expect(widget).toContain("正式改期");
});

test("structured reading lists steps in order with their ids", () => {
  const { document, stepper } = insertStepper();
  const { markdown, outline } = structuredContent(document);
  const [first, second] = stepper.content!.map(
    (step: JSONContent) => step.attrs!.id,
  );
  expect(markdown).toContain(`### 1. 初始安排 [${first}]`);
  expect(markdown).toContain(`### 2. 正式改期 [${second}]`);
  expect(markdown.indexOf("周六")).toBeLessThan(markdown.indexOf("周日"));
  expect(outline.find((item) => item.id === second)).toMatchObject({
    type: "step",
    title: "正式改期",
  });
});
