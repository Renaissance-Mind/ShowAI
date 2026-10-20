/** Portable brush v1. This module has no DOM, platform or storage dependencies. */
export const PORTABLE_INK_FORMAT = "showai-ink-v1";
export function portableInkColor(color, dark = false) {
  const c = /^#[0-9a-f]{6}$/i.test(color) ? parseInt(color.slice(1), 16) : 0;
  return dark && Math.max(c >>> 16, (c >>> 8) & 255, c & 255) < 64
    ? "#f2f2f2"
    : color;
}
const caches = new WeakMap();
const finite = (x, min, max) =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
export const isPortableInk = (ink) => ink?.format === PORTABLE_INK_FORMAT;
export function createPortableInk(
  points,
  width,
  extent,
  brush = "pen",
  pressure = true,
) {
  return {
    format: PORTABLE_INK_FORMAT,
    brushVersion: 1,
    brush,
    strokeCount: 1,
    width,
    opacity: brush === "marker" ? 0.35 : 1,
    extent,
    transform: [1, 0, 0, 1, 0, 0],
    samples: points.map((p, i) => {
      const size =
        width *
        (pressure && p.pressure !== undefined
          ? 0.2 + 0.8 * Math.max(0, Math.min(1, p.pressure))
          : 1);
      return [
        p.x,
        p.y,
        i / 120,
        size,
        size,
        1,
        p.pressure ?? 1,
        0,
        Math.PI / 2,
      ];
    }),
  };
}
export function isInkNode(node) {
  return (
    !!(
      node.attrs?.ink ||
      node.attrs?.nativeInk ||
      node.attrs?.data?.nativeInk
    ) ||
    (node.type === "drawing" &&
      ["pen", "highlighter"].includes(node.attrs?.tool))
  );
}
export function portableNodeInk(node) {
  return (
    node.attrs.ink ??
    createPortableInk(
      node.attrs.points,
      node.attrs.strokeWidth,
      node.attrs.extent,
      node.attrs.tool === "highlighter" ? "marker" : "pen",
      node.attrs.pressure,
    )
  );
}
export function validatePortableInk(ink) {
  if (!isPortableInk(ink) || ink.brushVersion !== 1 || ink.strokeCount !== 1)
    throw new Error("Unsupported portable ink brush/version.");
  if (
    Object.keys(ink).some(
      (k) =>
        ![
          "format",
          "brushVersion",
          "brush",
          "strokeCount",
          "width",
          "opacity",
          "extent",
          "samples",
          "transform",
          "mask",
          "sourceDrawing",
          "seed",
          "createdAt",
        ].includes(k),
    )
  )
    throw new Error("Unsupported portable ink field.");
  if (
    !["pen", "marker", "pencil", "monoline"].includes(ink.brush) ||
    !finite(ink.width, 0.5, 40) ||
    !finite(ink.opacity, 0, 1)
  )
    throw new Error("Invalid portable ink brush.");
  if (
    !Array.isArray(ink.extent) ||
    ink.extent.length !== 2 ||
    ink.extent.some((x) => !finite(x, 1, 1e6))
  )
    throw new Error("Invalid portable ink extent.");
  if (
    !Array.isArray(ink.transform) ||
    ink.transform.length !== 6 ||
    ink.transform.some((x) => !finite(x, -1e6, 1e6)) ||
    Math.abs(
      ink.transform[0] * ink.transform[3] - ink.transform[1] * ink.transform[2],
    ) < 1e-12
  )
    throw new Error("Invalid portable ink transform.");
  // x, y, time, nib width, nib height, opacity, force, azimuth, altitude.
  if (
    !Array.isArray(ink.samples) ||
    !ink.samples.length ||
    ink.samples.length > 20000
  )
    throw new Error("Portable ink requires 1–20000 samples.");
  let time = -Infinity;
  for (const p of ink.samples) {
    if (
      !Array.isArray(p) ||
      p.length !== 9 ||
      !finite(p[0], -1e6, 1e6) ||
      !finite(p[1], -1e6, 1e6) ||
      !finite(p[2], 0, 1e6) ||
      p[2] < time ||
      !finite(p[3], 0, 1e4) ||
      !finite(p[4], 0, 1e4) ||
      !finite(p[5], 0, 1) ||
      !finite(p[6], 0, 100) ||
      !finite(p[7], -100, 100) ||
      !finite(p[8], -100, 100)
    )
      throw new Error("Invalid portable ink sample.");
    time = p[2];
  }
  if (ink.mask !== undefined) {
    if (!Array.isArray(ink.mask) || ink.mask.length > 100000)
      throw new Error("Invalid ink mask.");
    for (const c of ink.mask)
      if (
        !Array.isArray(c) ||
        c.length !== { M: 3, L: 3, Q: 5, C: 7, Z: 1 }[c[0]] ||
        c.slice(1).some((x) => !finite(x, -1e6, 1e6))
      )
        throw new Error("Invalid ink mask command.");
  }
  if (
    (ink.seed !== undefined &&
      (!Number.isInteger(ink.seed) || !finite(ink.seed, 0, 4294967295))) ||
    (ink.createdAt !== undefined && !finite(ink.createdAt, -1e12, 1e12))
  )
    throw new Error("Invalid ink identity metadata.");
  if (
    ink.sourceDrawing !== undefined &&
    (typeof ink.sourceDrawing !== "string" ||
      !ink.sourceDrawing.startsWith(
        "data:application/vnd.showai.pencilkit;base64,",
      ) ||
      ink.sourceDrawing.length > 90e6)
  )
    throw new Error("Invalid original ink archive.");
  return ink;
}
const n = (x) => String(Math.round(x * 10000) / 10000);
const map = (m, p) => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export function portableInkBounds(ink, strokeWidth = ink.width) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const sample of ink.samples)
    for (const point of ellipse(sample, strokeWidth / ink.width)) {
      const p = map(ink.transform, point);
      left = Math.min(left, p.x);
      top = Math.min(top, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}
function ellipse(p, width) {
  const a = p[7],
    c = Math.cos(a),
    s = Math.sin(a),
    rx = (p[3] * width) / 2,
    ry = (p[4] * width) / 2;
  return Array.from({ length: 16 }, (_, i) => {
    const t = (i * Math.PI) / 8,
      x = rx * Math.cos(t),
      y = ry * Math.sin(t);
    return { x: p[0] + x * c - y * s, y: p[1] + x * s + y * c };
  });
}
function support(p, width, nx, ny) {
  const a = p[7],
    c = Math.cos(a),
    s = Math.sin(a),
    x = nx * c + ny * s,
    y = -nx * s + ny * c,
    rx = (p[3] * width) / 2,
    ry = (p[4] * width) / 2;
  const d = Math.hypot(rx * x, ry * y) || 1,
    ex = (rx * rx * x) / d,
    ey = (ry * ry * y) / d;
  return { x: ex * c - ey * s, y: ex * s + ey * c };
}
/** One filled contour prevents translucent marker segments darkening at joins. */
export function portableInkGeometry(ink, strokeWidth = ink.width) {
  let widths = caches.get(ink);
  if (!widths) caches.set(ink, (widths = new Map()));
  if (widths.has(strokeWidth)) return widths.get(strokeWidth);
  const width = strokeWidth / ink.width,
    polygons = [];
  for (let i = 0; i < ink.samples.length; i++) {
    const p = ink.samples[i];
    polygons.push(ellipse(p, width));
    if (!i) continue;
    const q = ink.samples[i - 1],
      dx = p[0] - q[0],
      dy = p[1] - q[1],
      l = Math.hypot(dx, dy);
    if (!l) continue;
    const a = support(q, width, -dy / l, dx / l),
      b = support(p, width, -dy / l, dx / l);
    polygons.push([
      { x: q[0] + a.x, y: q[1] + a.y },
      { x: q[0] - a.x, y: q[1] - a.y },
      { x: p[0] - b.x, y: p[1] - b.y },
      { x: p[0] + b.x, y: p[1] + b.y },
    ]);
  }
  const world = polygons.map((poly) => poly.map((p) => map(ink.transform, p)));
  const result = {
    polygons: world,
    path: world
      .map(
        (poly) =>
          "M " + poly.map((p) => n(p.x) + " " + n(p.y)).join(" L ") + " Z",
      )
      .join(" "),
    mask: ink.mask
      ?.map((c) => c[0] + " " + c.slice(1).map(n).join(" "))
      .join(" "),
  };
  // Do not accumulate every width visited by a slider.
  widths.clear();
  widths.set(strokeWidth, result);
  return result;
}
function contains(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function maskContours(ink) {
  const contours = [];
  let points = [],
    last = { x: 0, y: 0 };
  for (const c of ink.mask ?? []) {
    if (c[0] === "M") {
      if (points.length) contours.push(points);
      points = [];
      last = { x: c[1], y: c[2] };
      points.push(map(ink.transform, last));
    } else if (c[0] === "L") {
      last = { x: c[1], y: c[2] };
      points.push(map(ink.transform, last));
    } else if (c[0] === "Q" || c[0] === "C") {
      const a = last,
        cubic = c[0] === "C",
        end = { x: c[c.length - 2], y: c[c.length - 1] };
      for (let i = 1; i <= 32; i++) {
        const t = i / 32,
          u = 1 - t;
        const p = cubic
          ? {
              x:
                u * u * u * a.x +
                3 * u * u * t * c[1] +
                3 * u * t * t * c[3] +
                t * t * t * end.x,
              y:
                u * u * u * a.y +
                3 * u * u * t * c[2] +
                3 * u * t * t * c[4] +
                t * t * t * end.y,
            }
          : {
              x: u * u * a.x + 2 * u * t * c[1] + t * t * end.x,
              y: u * u * a.y + 2 * u * t * c[2] + t * t * end.y,
            };
        points.push(map(ink.transform, p));
      }
      last = end;
    } else if (c[0] === "Z" && points.length) {
      contours.push(points);
      points = [];
    }
  }
  if (points.length) contours.push(points);
  return contours;
}
function maskContains(contours, p) {
  let winding = 0;
  for (const poly of contours)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y && b.y > p.y && cross > 0) winding++;
      else if (a.y > p.y && b.y <= p.y && cross < 0) winding--;
    }
  return winding !== 0;
}
export function portableInkHit(ink, point, strokeWidth = ink.width) {
  if (ink.mask !== undefined && !maskContains(maskContours(ink), point))
    return {
      inside: false,
      distance: Infinity,
      solid: true,
      area: ink.extent[0] * ink.extent[1],
    };
  let distance = Infinity,
    inside = false;
  for (const poly of portableInkGeometry(ink, strokeWidth).polygons) {
    inside ||= contains(poly, point);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * dx + (point.y - a.y) * dy) /
            (dx * dx + dy * dy || 1),
        ),
      );
      distance = Math.min(
        distance,
        Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy),
      );
    }
  }
  return {
    inside,
    distance: inside ? 0 : distance,
    solid: true,
    area: ink.extent[0] * ink.extent[1],
  };
}
