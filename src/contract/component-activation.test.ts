import { expect, it } from "vitest";
import { componentActivationIssue } from "./component-activation.mjs";
it("accepts bounded stable identities and rejects malformed activation messages", () => {
  expect(
    componentActivationIssue({ type: "item", scope: "cards", id: "open" }),
  ).toBeUndefined();
  expect(
    componentActivationIssue({
      type: "item",
      scope: "cards",
      id: "🧭".repeat(150),
    }),
  ).toBeUndefined();
  for (const value of [
    null,
    [],
    "open",
    {},
    { type: "item", scope: "cards", id: 42 },
    { type: "item", scope: "cards", id: "" },
    { type: "item", scope: "cards", id: "x".repeat(201) },
    { type: "item", scope: "cards", id: "open", extra: true },
  ])
    expect(componentActivationIssue(value)).toBeTypeOf("string");
});
