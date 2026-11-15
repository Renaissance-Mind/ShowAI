import { expect, test } from "vitest";
import { applyOperations } from "./diff";
import { blankDocument } from "./catalog";
import { createResource } from "../document/containers.mjs";
import type { PageOperation, ShowDocument } from "./model";


const insert = (i: number): PageOperation => ({
  type: "block.insert",
  node: { type: "paragraph", content: [{ type: "text", text: `Paragraph ${i} `.padEnd(200, "x") }] },
});
const textSet = (i: number): PageOperation => ({
  type: "block.text.set",
  blockId: `p${i}`,
  text: `Changed ${i}`,
});
const page = (blocks: number) => {
  let document = createResource(blankDocument()) as unknown as ShowDocument;
  for (let start = 0; start < blocks; start += 500)
    document = applyOperations(
      document,
      Array.from({ length: Math.min(500, blocks - start) }, (_, k) => ({
        type: "block.insert",
        node: { type: "paragraph", attrs: { id: `p${start + k}` }, content: [{ type: "text", text: `Paragraph ${start + k}` }] },
      }) as PageOperation),
    );
  return document;
};
const fastest = (run: () => unknown) =>
  Math.min(
    ...[0, 1, 2].map(() => {
      const start = performance.now();
      run();
      return performance.now() - start;
    }),
  );

test("inserting four times as many blocks takes about four times as long", () => {
  const base = page(400);
  const small = fastest(() => applyOperations(base, Array.from({ length: 250 }, (_, i) => insert(i))));
  const large = fastest(() => applyOperations(base, Array.from({ length: 1000 }, (_, i) => insert(i))));
  expect(large / Math.max(small, 1)).toBeLessThan(8);
  expect(large).toBeLessThan(2000);
}, 120_000);

test("editing the text of four times as many blocks takes about four times as long", () => {
  const base = page(1200);
  const small = fastest(() => applyOperations(base, Array.from({ length: 250 }, (_, i) => textSet(i))));
  const large = fastest(() => applyOperations(base, Array.from({ length: 1000 }, (_, i) => textSet(i))));
  expect(large / Math.max(small, 1)).toBeLessThan(8);
  expect(large).toBeLessThan(2000);
}, 120_000);
