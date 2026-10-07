import { expect, test } from "vitest";
import { hasG2ViewportInteraction } from "./g2/engine.js";

test("reading locks distinguish hover and click from gestures that change the view", () => {
  expect(
    hasG2ViewportInteraction({
      interaction: {
        tooltip: true,
        legendFilter: true,
        elementHighlight: { background: true },
        elementSelect: true,
      },
    }),
  ).toBe(false);
  expect(hasG2ViewportInteraction({ interaction: { brushFilter: true } })).toBe(
    true,
  );
  expect(
    hasG2ViewportInteraction({ interaction: { brushFilter: false } }),
  ).toBe(false);
  expect(
    hasG2ViewportInteraction({
      interaction: [{ type: "brushHighlight", reverse: true }],
    }),
  ).toBe(true);
});

test("slider and scrollbar filtering need an active guide", () => {
  expect(
    hasG2ViewportInteraction({ interaction: { sliderFilter: true } }),
  ).toBe(false);
  expect(hasG2ViewportInteraction({ slider: { x: {} } })).toBe(true);
  expect(hasG2ViewportInteraction({ scrollbar: { y: {} } })).toBe(true);
  expect(hasG2ViewportInteraction({ slider: { x: false, y: false } })).toBe(
    false,
  );
  expect(
    hasG2ViewportInteraction({
      slider: { x: {} },
      interaction: { sliderFilter: false },
    }),
  ).toBe(false);
});
