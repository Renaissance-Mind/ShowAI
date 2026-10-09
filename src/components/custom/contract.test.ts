import { describe, expect, it } from "vitest";
import {
  COMPONENT_DATA_MARKER,
  componentWidgetData,
  injectComponentBootstrap,
} from "./contract";

const component = {
  id: "value-slider",
  version: "1.0.0",
  integrity: "sha256-" + "a".repeat(64),
  defaultData: { value: 0, labels: ["a"] },
};
describe("browser component references", () => {
  it("preserves formula and replacement-token text when injecting sandbox props", () => {
    const props = {
      content:
        "Markdown supports `$…$` and `$$…$$`; literal $& and $' stay text.",
      source: '<script data-value="quoted">$` $& $$ $\'</script>',
    };
    const json = JSON.stringify({ props }).replace(/</g, "\\u003c");
    const bootstrap = `<script id="showai-component-data" type="application/json">${json}</script>`;
    const html = injectComponentBootstrap(
      `<html><body>${COMPONENT_DATA_MARKER}<main>Reader</main></body></html>`,
      bootstrap,
    );
    const payload = html.match(
      /<script id="showai-component-data" type="application\/json">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(JSON.parse(payload!)).toEqual({ props });
    expect(html).toBe(
      `<html><body>${bootstrap}<main>Reader</main></body></html>`,
    );
  });
  it("rejects packages missing the bootstrap marker", () => {
    expect(() =>
      injectComponentBootstrap("<main>Reader</main>", "data"),
    ).toThrow("组件缺少运行入口");
  });
  it("produces independent serializable props without copying executable packages", () => {
    const data = componentWidgetData(component);
    expect(data).toEqual({
      componentId: component.id,
      version: component.version,
      integrity: component.integrity,
      props: component.defaultData,
    });
    (data.props as typeof component.defaultData).labels.push("b");
    expect(component.defaultData.labels).toEqual(["a"]);
    expect(data).not.toHaveProperty("html");
  });
  it("rejects unsupported executable and non-JSON values before crossing the browser bridge", () => {
    expect(() => componentWidgetData(component, { value: () => 1 })).toThrow(
      "JSON",
    );
    expect(() => componentWidgetData(component, { value: Infinity })).toThrow(
      "JSON",
    );
    expect(() =>
      componentWidgetData(component, JSON.parse('{"__proto__":1}')),
    ).toThrow("reserved");
  });
});
