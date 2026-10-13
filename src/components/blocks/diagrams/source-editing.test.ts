import { expect, test } from "vitest";
import { namespacedSvg, svgSource } from "./source-editing";

test("extracts a complete authored diagram while preserving nested SVG and literal text", () => {
  const diagram =
    '<SVG xmlns="http://www.w3.org/2000/svg"><!-- </svg> --><svg viewBox="0 0 10 10"><text>A &amp; B</text></svg><text>完成</text></SVG>';
  const html = `<html><body><svg id="toolbar"></svg><div class="diagram-container">${diagram}</div></body></html>`;
  expect(svgSource(html)).toBe(diagram);
  expect(svgSource('<svg xmlns="http://www.w3.org/2000/svg"/>')).toContain(
    "/>",
  );
  expect(() => svgSource("<svg><svg></svg>")).toThrow("完整");
  expect(namespacedSvg("<svg/>")).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  expect(namespacedSvg('<svg aria-label="a > b"></svg>')).toContain(
    'aria-label="a > b" xmlns=',
  );
});
