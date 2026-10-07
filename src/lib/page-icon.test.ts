import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PageIcon from "../components/PageIcon";
import { isImageIcon, validatePageIcon } from "./page-icon.mjs";
import { validateDocument } from "../portable/validation.mjs";
import { upgradeResource, createSurface } from "../surface/containers.mjs";

const raster = "data:image/png;base64," + "a".repeat(20000);
describe("Page icons", () => {
  it("accepts legacy text, Emoji, web images and embedded images beyond the old text limit", () => {
    for (const icon of [
      "",
      "✦",
      "🧪",
      "Note",
      "https://example.com/icon.png",
      raster,
    ]) {
      expect(validatePageIcon(icon)).toBe(icon);
      expect(
        validateDocument({
          id: "test",
          title: "Test",
          icon,
          content: { type: "doc", content: [] },
        }).icon,
      ).toBe(icon);
    }
    expect(isImageIcon("🧪")).toBe(false);
    expect(
      renderToStaticMarkup(createElement(PageIcon, { value: raster })),
    ).toContain("<img");
    expect(
      renderToStaticMarkup(createElement(PageIcon, { value: "🧪" })),
    ).toContain("🧪");
  });
  it("rejects unsupported image schemes, types and oversized text at both root and nested Pages", () => {
    const base = upgradeResource(
      validateDocument({
        id: "test",
        title: "Test",
        content: { type: "doc", content: [] },
      }),
    );
    const child = createSurface("page", "Child");
    base.content.content = [child];
    for (const icon of [
      "javascript:alert(1)",
      "file:///private/image.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "x".repeat(65),
      null,
    ]) {
      expect(() => validatePageIcon(icon)).toThrow();
      expect(() => validateDocument({ ...base, icon })).toThrow();
      child.attrs!.icon = icon;
      expect(() => validateDocument(base)).toThrow();
    }
    child.attrs!.icon = raster;
    expect(validateDocument(base).content.content?.[0].attrs?.icon).toBe(
      raster,
    );
  });
});
