import { expect, test } from "vitest";
import { CapacityError } from "../portable/capacity.mjs";
import { errorResult, failedOperation } from "./service";

const tooLarge = () =>
  new CapacityError("Compressed chat preview", 1_200_000, 1_000_000);

test("a capacity failure's user message names the step that failed", async () => {
  expect(errorResult(tooLarge(), "save").userMessage).toBe(
    "The content is larger than ShowAI allows for one save. Nothing was saved.",
  );
  for (const operation of ["export", "present"] as const) {
    const message = errorResult(tooLarge(), operation).userMessage!;
    expect(message, operation).not.toMatch(/save/i);
  }
  expect(errorResult(tooLarge(), "export").userMessage).toMatch(
    /No file was written/,
  );
  expect(errorResult(tooLarge()).userMessage).not.toMatch(/save/i);
  await failedOperation.run("export", async () => {
    await Promise.resolve();
    expect(errorResult(tooLarge()).userMessage).toMatch(/export/);
  });
  expect(
    errorResult(Object.assign(new Error("x"), {}), "export").userMessage,
  ).toBe("ShowAI could not complete this step.");
});
