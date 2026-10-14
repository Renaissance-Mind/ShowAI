import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import components from "../../../resources/catalog/components.json";
import {
  boundValue,
  sceneLabels,
  validateScene3dData,
} from "./scene3d-contract.mjs";
import { Scene3DBlock } from "./Scene3D";

const entry = components.find((item) => item.kind === "scene-3d")!;
const base = () => ({
  objects: [{ type: "box", id: "cube", label: "Cube" }],
});

describe("scene-3d contract", () => {
  it("accepts the default data and every catalog example", () => {
    expect(() => validateScene3dData(entry.defaultData)).not.toThrow();
    for (const example of entry.examples)
      expect(
        () => validateScene3dData(example.data),
        example.name,
      ).not.toThrow();
  });

  it.each([
    ["no objects", { objects: [] }, /objects must be a non-empty array/],
    ["unknown shape", { objects: [{ type: "teapot" }] }, /type must be one of/],
    [
      "duplicate ids",
      {
        objects: [
          { type: "box", id: "a" },
          { type: "sphere", id: "a" },
        ],
      },
      /duplicate id a/,
    ],
    [
      "unknown parameter",
      {
        objects: [
          {
            type: "group",
            bindings: [{ parameter: "missing", property: "rotation.y" }],
          },
        ],
      },
      /unknown parameter missing/,
    ],
    [
      "unsupported property",
      {
        parameters: [{ id: "p", label: "P", min: 0, max: 1, value: 0 }],
        objects: [
          {
            type: "group",
            bindings: [{ parameter: "p", property: "color" }],
          },
        ],
      },
      /property must be one of/,
    ],
    [
      "value outside range",
      {
        parameters: [{ id: "p", label: "P", min: 0, max: 1, value: 2 }],
        objects: [{ type: "box" }],
      },
      /value must be a finite number from 0 to 1/,
    ],
    [
      "children on a shape",
      { objects: [{ type: "box", children: [{ type: "sphere" }] }] },
      /children requires type group/,
    ],
    [
      "zero-length arrow",
      { objects: [{ type: "arrow", from: [1, 1, 1], to: [1, 1, 1] }] },
      /different from and to points/,
    ],
    [
      "short line",
      { objects: [{ type: "line", points: [[0, 0, 0]] }] },
      /points must contain 2 to 500 points/,
    ],
    [
      "camera on its target",
      { camera: { position: [1, 1, 1], target: [1, 1, 1] }, ...base() },
      /camera.position must differ/,
    ],
    ["bad color", { objects: [{ type: "box", color: "red" }] }, /hex color/],
  ])("rejects %s", (_name, data, message) => {
    expect(() => validateScene3dData(data)).toThrow(message);
  });

  it("limits nesting depth", () => {
    let object: Record<string, unknown> = { type: "box" };
    for (let level = 0; level < 9; level++)
      object = { type: "group", children: [object] };
    expect(() => validateScene3dData({ objects: [object] })).toThrow(
      /nested deeper/,
    );
  });

  it("maps parameters linearly onto a property", () => {
    const binding = { parameter: "p", property: "rotation.y", factor: -0.5 };
    expect(boundValue(10, binding as never, { p: 40 })).toBe(-10);
    expect(boundValue(10, binding as never, {})).toBe(10);
  });

  it("lists labels in document order, including label objects", () => {
    expect(
      sceneLabels({
        objects: [
          {
            type: "group",
            label: "Body",
            children: [
              { type: "box", label: "Wing" },
              { type: "label", text: "Note" },
            ],
          },
          { type: "arrow", to: [1, 0, 0], label: "X" },
        ],
      } as never),
    ).toEqual(["Body", "Wing", "Note", "X"]);
  });
});

describe("scene-3d renderer", () => {
  it("renders readable controls without touching WebGL on the server", () => {
    const html = renderToStaticMarkup(
      createElement(Scene3DBlock, {
        data: entry.examples[0].data,
        readOnly: true,
      }),
    );
    expect(html).toContain("sb-block s3-block");
    expect(html).toContain('type="range"');
    expect(html).toContain("俯仰 Pitch");
    expect(html).toContain('aria-busy="true"');
  });
});
