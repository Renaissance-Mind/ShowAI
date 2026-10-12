import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { validatePrimitiveData } from "./primitive-contract.mjs";
import { Widget } from "./Widget";
import { blankDocument } from "../../core/catalog";
import { insertComponent } from "../../surface/component-insertion";
import { validateDocument } from "../../portable/validation.mjs";
import { builtinComponent } from "../catalog";
import Ajv from "ajv";

const content = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Saved explanation", marks: [{ type: "bold" }] },
      ],
    },
  ],
};

test("editable toggle/callout retain the rich-text tree through insertion, validation and reading", () => {
  for (const kind of ["toggle", "callout"]) {
    const data = {
      ...(kind === "toggle" ? { summary: "Details" } : { title: "Details" }),
      content,
    };
    expect(() => validatePrimitiveData(kind, data)).not.toThrow();
    const validate = new Ajv({ strict: false }).compile(
      builtinComponent(kind)!.propsSchema,
    );
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    const inserted = insertComponent(blankDocument(), null, kind, data);
    const document = validateDocument(inserted.document);
    expect(JSON.stringify(document)).toContain("Saved explanation");
    const html = renderToStaticMarkup(
      createElement(Widget, { kind, data, readOnly: true }),
    );
    expect(html).toContain("<strong>Saved explanation</strong>");
    expect(() =>
      validatePrimitiveData(kind, { content: "**Legacy explanation**" }),
    ).not.toThrow();
    expect(() =>
      validatePrimitiveData(kind, {
        content: { type: "doc", content: [{ type: "invalid" }] },
      }),
    ).toThrow();
  }
  expect(() => validatePrimitiveData("code", { content })).toThrow("文字内容");
});
