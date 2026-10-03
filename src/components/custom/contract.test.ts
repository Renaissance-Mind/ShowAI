import { describe, expect, it } from "vitest";
import { componentWidgetData } from "./contract";

const component = {
  id: "value-slider",
  version: "1.0.0",
  integrity: "sha256-" + "a".repeat(64),
  defaultData: { value: 0, labels: ["a"] },
};
describe("browser component references", () => {
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
