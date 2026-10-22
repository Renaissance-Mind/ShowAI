import { expect, test } from "vitest";
import { previewColumns, previewFit, previewZoom } from "./preview-geometry";
test("a long template fits both dimensions without clipping its final section", () => {
  const scale = previewFit(1190, 850, 960, 2400);
  expect(960 * scale).toBeLessThanOrEqual(1190 - 48);
  expect(2400 * scale).toBe(850 - 48);
});
test("compact examples retain natural size, and a hidden tab never produces invalid scale", () => {
  expect(previewFit(1200, 900, 800, 320)).toBe(1);
  expect(previewFit(0, 0, 800, 320)).toBe(1);
});
test("manual zoom supports reading detail without losing a valid finite scale", () => {
  expect(previewZoom(0)).toBe(0.05);
  expect(previewZoom(20)).toBe(3);
  expect(previewZoom(0.8)).toBe(0.8);
});
test("a long document splits into more columns the taller it is, up to four", () => {
  // A 300×150 card; pages are 960 wide with a 64 gap between columns.
  expect(previewColumns(300, 150, 960, 500, 64)).toBe(1);
  expect(previewColumns(300, 150, 960, 1400, 64)).toBe(2);
  expect(previewColumns(300, 150, 960, 4000, 64)).toBe(3);
  expect(previewColumns(300, 150, 960, 9000, 64)).toBe(4);
  expect(previewColumns(300, 150, 960, 60000, 64)).toBe(4);
});
test("a narrow or hidden preview keeps one column", () => {
  expect(previewColumns(120, 400, 960, 3000, 64)).toBe(1);
  expect(previewColumns(0, 0, 960, 3000, 64)).toBe(1);
});
