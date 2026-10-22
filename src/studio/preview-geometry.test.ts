import { expect, test } from "vitest";
import { previewFit, previewFitWidth, previewZoom } from "./preview-geometry";
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
test("a thumbnail scales a page to the card width in both directions", () => {
  expect(previewFitWidth(480, 960)).toBe(0.5);
  expect(previewFitWidth(1100, 960)).toBeCloseTo(1100 / 960);
  expect(previewFitWidth(0, 960)).toBe(1);
});
