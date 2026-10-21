import { expect, it } from "vitest";
import {
  captureOwnedJSON,
  freezeOwnedJSON,
  parseOwnedJSON,
  isOwnedJSON,
} from "./owned-json.mjs";

it("parse/share/capture seals actual JSON and reuses only completely matching owned data", () => {
  const first = parseOwnedJSON(
    '{"node":{"points":[[1,2],[3,4]],"é":"NFC","é":"NFD"},"value":1}',
  ) as any;
  const next = parseOwnedJSON(
    '{"node":{"points":[[1,2],[3,4]],"é":"NFC","é":"NFD"},"value":2}',
    first,
  ) as any;
  expect(next).not.toBe(first);
  expect(next.node).toBe(first.node);
  expect(Object.isFrozen(next.node.points[0])).toBe(true);
  expect(isOwnedJSON(next)).toBe(true);
  const changed = parseOwnedJSON(
    '{"node":{"points":[[1,2],[3,5]],"é":"NFC","é":"NFD"},"value":2}',
    next,
  ) as any;
  expect(changed.node).not.toBe(first.node);
  expect(changed.node.points[0]).toBe(first.node.points[0]);
  expect(changed.node.points[1]).not.toBe(first.node.points[1]);
});
it("caller freezing and mutable candidate identity cannot substitute for actual plain data capture", () => {
  let value = { sample: [1, 2] };
  const caller = Object.freeze({
    get branch() {
      return value;
    },
  });
  freezeOwnedJSON(caller);
  const held = captureOwnedJSON(caller);
  value = { sample: [3, 4] };
  expect(held.branch.sample).toEqual([1, 2]);
  expect(held).not.toBe(caller);
  const parsed = parseOwnedJSON('{"branch":{"sample":[3,4]}}', caller) as any;
  expect(parsed.branch).not.toBe(value);
  expect(parsed.branch.sample).toEqual([3, 4]);
  value.sample[0] = 9;
  expect(parsed.branch.sample).toEqual([3, 4]);
});
it("capture rejects non-JSON and cyclic graphs and preserves literal safe keys independently", () => {
  const cycle: any = {};
  cycle.self = cycle;
  for (const value of [
    cycle,
    [, 1],
    { x: Infinity },
    { x: undefined },
    new Date(),
  ])
    expect(() => captureOwnedJSON(value)).toThrow();
  const original = JSON.parse(
    '{"__proto__":{"safe":true},"constructor":1,"0":"object-key"}',
  );
  const held = captureOwnedJSON(original);
  expect(Object.getPrototypeOf(held)).toBe(Object.prototype);
  expect(Object.hasOwn(held, "__proto__")).toBe(true);
  expect(held).toEqual(original);
  expect(held.__proto__).not.toBe(original.__proto__);
  expect(() => parseOwnedJSON('{"number":1e999}')).toThrow(/non-JSON/);
});
it("bounds defensive capture before allocating or reading the rest of an oversized aliased graph", () => {
  const oneMiB = captureOwnedJSON({ text: "x".repeat(1024 * 1024) });
  let laterReads = 0;
  const input = {
    many: Array(513).fill(oneMiB),
    get later() {
      laterReads++;
      return 1;
    },
  };
  expect(() => captureOwnedJSON(input)).toThrow(/Source JSON capture/);
  expect(laterReads).toBe(0);
});
