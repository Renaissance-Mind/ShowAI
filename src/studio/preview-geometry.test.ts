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
test("a four-column document fills the card width even when its full height cannot fit", () => {
  const width = 4 * 960 + 3 * 64;
  const scale = previewFit(640, 440, width, 15000, 8, "width");
  expect(width * scale).toBe(624);
  expect(15000 * scale).toBeGreaterThan(440);
});
test("board and catalog previews still fit their complete height by default", () => {
  const scale = previewFit(640, 440, 960, 4000, 8);
  expect(4000 * scale).toBe(424);
  expect(960 * scale).toBeLessThan(624);
});
