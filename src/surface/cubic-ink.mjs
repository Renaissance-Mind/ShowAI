import { CompiledInkStroke } from "./ink-kernel/ink-stroke-kernel.mjs";
import {
  CUBIC_INK_FORMAT,
  DEFAULT_OUTLINE_TOLERANCE,
  validateCubicInk,
} from "./portable-ink-v2.mjs";
let compiled;
const kernel = () => (compiled ??= new CompiledInkStroke());
const immutable = new WeakSet(),
  cache = new WeakMap();
function cacheable(ink) {
  if (immutable.has(ink)) return true;
  if (
    Object.isFrozen(ink) &&
    Object.isFrozen(ink.segments) &&
    Object.isFrozen(ink.transform) &&
    ink.segments.every(
      (s) =>
        Object.isFrozen(s) &&
        Object.isFrozen(s.points) &&
        s.points.every(Object.isFrozen) &&
        Object.isFrozen(s.radius),
    )
  ) {
    immutable.add(ink);
    return true;
  }
  return false;
}
function mapCommand(command, m) {
  const result = [command[0]];
  for (let i = 1; i < command.length; i += 2)
    result.push(
      m[0] * command[i] + m[2] * command[i + 1] + m[4],
      m[1] * command[i] + m[3] * command[i + 1] + m[5],
    );
  return result;
}
export function cubicInkGeometry(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  const key = width + ":" + pressure,
    prior = cache.get(ink);
  if (prior?.key === key) return prior.geometry;
  validateCubicInk(ink);
  const geometry = kernel().build(
    ink.segments,
    { tolerance: ink.outlineTolerance },
    { sourceWidth: ink.width, width, pressure },
  );
  for (const command of geometry.commands) Object.freeze(command);
  Object.freeze(geometry.commands);
  const result = {
    commands: geometry.commands,
    path: geometry.commands
      .map((c) => mapCommand(c, ink.transform).join(" "))
      .join(" "),
    statistics: geometry.result,
  };
  if (cacheable(ink)) cache.set(ink, { key, geometry: result });
  return result;
}
export function cubicInkQueryGeometry(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  const geometry = cubicInkGeometry(ink, width, pressure);
  if (!geometry.query)
    geometry.query = kernel().pathGeometry(
      geometry.commands,
      ink.transform,
      Math.max(1e-9, ink.outlineTolerance * 0.25),
    );
  return geometry.query;
}
export function cubicInkBounds(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  const geometry = cubicInkGeometry(ink, width, pressure);
  return (geometry.bounds ??= kernel().pathBounds(
    geometry.commands,
    ink.transform,
  ));
}
export function cubicInkHit(
  ink,
  point,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  return {
    ...kernel().pathHit(
      cubicInkGeometry(ink, width, pressure).commands,
      point,
      ink.transform,
      Math.max(1e-9, ink.outlineTolerance * 0.25),
    ),
    area: ink.extent[0] * ink.extent[1],
  };
}
/** New source export is explicit. Web's ordinary pen creation remains v1 until
 * all native adapters are integrated. No archived v1 stroke is converted here. */
export function cubicInkFromInput(
  input,
  {
    sourceID,
    extent,
    origin = { x: 0, y: 0 },
    brush = "pen",
    opacity = brush === "marker" ? 0.35 : 1,
    outlineTolerance = DEFAULT_OUTLINE_TOLERANCE,
    capture = true,
  },
) {
  const snapshot = input.snapshot();
  if (!snapshot.finished || snapshot.predictedCount)
    throw new Error("Finish actual input before durable cubic ink export");
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y))
    throw new Error("Invalid cubic ink origin");
  const segments = input.strokeSegments().map((s) => {
    if (s.containsPredictions)
      throw new Error("Predictions cannot be persisted");
    return {
      points: s.points.map((p) => [p[0] - origin.x, p[1] - origin.y]),
      radius: s.radius,
    };
  });
  const ink = {
    format: CUBIC_INK_FORMAT,
    geometryVersion: 1,
    brushVersion: 1,
    brush,
    strokeCount: 1,
    width: input.config.width,
    opacity,
    extent: [...extent],
    transform: [1, 0, 0, 1, 0, 0],
    outlineTolerance,
    segments,
  };
  if (capture)
    ink.capture = {
      format: "showai-input-capture-v1",
      sourceID,
      configuration: { ...input.config },
      raw: input
        .raw()
        .map((p) => [
          p.x - origin.x,
          p.y - origin.y,
          p.time,
          p.force,
          p.azimuth,
          p.altitude,
          p.id,
          p.expectedProperties,
          p.estimationIndex,
          p.updatesTimedOut ? 1 : 0,
        ]),
    };
  return validateCubicInk(ink);
}
