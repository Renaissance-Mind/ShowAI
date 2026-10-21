import { CompiledInkInput } from "./ink-kernel/compiled-ink-input.mjs";
import { cubicInkFromInput } from "./cubic-ink.mjs";
/** Actual coalesced input, including replaced predictions and every exported
 * pressure knot. No synthetic outline or legacy samples are substituted. */
export function longCubicInputFixture(count = 20001, varyingPressure = false) {
  const input = new CompiledInkInput({
    width: 4,
    mode: 1,
    positionWindow: 0,
    jitterWindow: 0,
  });
  for (let start = 0; start < count; start += 32) {
    const actual = Array.from(
      { length: Math.min(32, count - start) },
      (_, offset) => {
        const index = start + offset;
        return {
          id: index + 1,
          x: index * 2,
          y: 100 + Math.sin(index / 80) * 20,
          time: index / 240,
          force: varyingPressure ? 1.2 + 0.1 * Math.sin(index / 12) : 1.5,
          azimuth: 0.4,
          altitude: 1.2,
        };
      },
    );
    const index = start + actual.length;
    input.push(
      actual,
      index < count
        ? [
            {
              id: index + 1,
              x: index * 2,
              y: 100 + Math.sin(index / 80) * 20,
              time: index / 240,
              force: varyingPressure ? 1.2 + 0.1 * Math.sin(index / 12) : 1.5,
              azimuth: 0.4,
              altitude: 1.2,
            },
          ]
        : [],
    );
  }
  input.finish();
  return cubicInkFromInput(input, {
    sourceID: "actual-long-coalesced",
    extent: [Math.max(1, count * 2 + 20), 160],
    capture: true,
  });
}
