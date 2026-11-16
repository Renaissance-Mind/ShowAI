import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { encodeBinaryText, decodeBinaryText } from "./binary-text.mjs";
test("script-safe binary transport round-trips tails and compressed-sized buffers", () => {
  for (const size of [0, 1, 2, 3, 7, 8, 13, 14, 31, 256, 32769, 100000]) {
    const bytes = randomBytes(size),
      encoded = encodeBinaryText(bytes);
    expect(encoded).not.toMatch(/["<\\]/);
    expect(Buffer.from(decodeBinaryText(encoded))).toEqual(bytes);
    if (size > 256)
      expect(encoded.length).toBeLessThan(bytes.toString("base64").length);
  }
  expect(() => decodeBinaryText("<")).toThrow(/Invalid/);
});
