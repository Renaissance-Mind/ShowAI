import { describe, expect, it } from "vitest";
import {
  componentContextIssue,
  componentContextLimits,
} from "./component-context.mjs";

describe("component context snapshots", () => {
  it("accepts a JSON model with an optional private part and label", () => {
    expect(
      componentContextIssue({
        model: { gamma: 0.3, regime: "under" },
        private: { slider: [0.3, 2] },
        label: "γ=0.3",
      }),
    ).toBe("");
    expect(componentContextIssue({ model: "plain text" })).toBe("");
  });

  it("rejects missing models, unknown fields and values that are not JSON", () => {
    expect(componentContextIssue(null)).toMatch(/object/);
    expect(componentContextIssue({ private: 1 })).toMatch(/model is required/);
    expect(componentContextIssue({ model: 1, extra: 1 })).toMatch(/Unknown/);
    expect(componentContextIssue({ model: Number.NaN })).toMatch(/JSON/);
    expect(componentContextIssue({ model: { at: new Date() } })).toMatch(
      /JSON/,
    );
    expect(componentContextIssue({ model: 1, private: () => 1 })).toMatch(
      /private/,
    );
    expect(componentContextIssue({ model: 1, label: " " })).toMatch(/label/);
    expect(
      componentContextIssue({
        model: 1,
        label: "x".repeat(componentContextLimits.labelChars + 1),
      }),
    ).toMatch(/label/);
  });

  it("bounds the model and the whole snapshot by UTF-8 size", () => {
    expect(componentContextIssue({ model: "字".repeat(3000) })).toMatch(
      /model exceeds/,
    );
    expect(
      componentContextIssue({ model: 1, private: "x".repeat(17000) }),
    ).toMatch(/snapshot exceeds/);
  });

  it("stays self-contained so the component runtime can embed its source", () => {
    const embedded = new Function(
      `return ${componentContextIssue.toString()}`,
    )() as typeof componentContextIssue;
    expect(embedded({ model: { ok: true } })).toBe("");
    expect(embedded({ model: 1, other: 2 })).toMatch(/Unknown/);
  });
});
