import { expect, it } from "vitest";
import { ThumbnailRetention } from "./thumbnail-retention";

it("keeps recently viewed previews for a return scroll and evicts only old offscreen renders", () => {
  const retention = new ThumbnailRetention(2);
  const a = Symbol(),
    b = Symbol(),
    c = Symbol();
  const released: string[] = [];
  retention.update(a, true, () => released.push("a"));
  retention.update(a, false, () => released.push("a"));
  retention.update(b, true, () => released.push("b"));
  expect(released).toEqual([]);
  retention.update(a, true, () => released.push("a"));
  retention.update(a, false, () => released.push("a"));
  retention.update(b, false, () => released.push("b"));
  retention.update(c, true, () => released.push("c"));
  expect(released).toEqual(["b"]);
});

it("keeps every visible preview even when the viewport exceeds the limit", () => {
  const retention = new ThumbnailRetention(1);
  const a = Symbol(),
    b = Symbol();
  const released: string[] = [];
  retention.update(a, true, () => released.push("a"));
  retention.update(b, true, () => released.push("b"));
  expect(released).toEqual([]);
  retention.update(b, false, () => released.push("b"));
  expect(released).toEqual(["b"]);
});

it("releases references to unmounted previews without evicting their replacements", () => {
  const retention = new ThumbnailRetention(1);
  const a = Symbol(),
    b = Symbol();
  const released: string[] = [];
  retention.update(a, true, () => released.push("a"));
  retention.remove(a);
  retention.update(a, false, () => released.push("a"));
  retention.update(b, true, () => released.push("b"));
  expect(released).toEqual([]);
});
