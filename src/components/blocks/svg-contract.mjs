// Contract for the svg built-in: a hand-drawn vector figure stored as SVG source.
// It runs in the workbench, the CLI and the portable reader, so it stays
// dependency-free and checks the source as text. The renderer sanitizes again
// with the browser's parser before the figure is shown.

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Tones of the shared drawing palette; classes such as fill-blue use them. */
export const DRAWING_TONES = [
  "blue",
  "gray",
  "violet",
  "teal",
  "green",
  "red",
  "orange",
];
export const SVG_LIMITS = { sourceLength: 2_000_000, textLength: 2000 };

/** Elements a figure may use; anything else is rejected or removed. */
export const SVG_ELEMENTS = [
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "textPath",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "clipPath",
  "mask",
  "use",
  "symbol",
  "image",
];

const RASTER = /^data:image\/(png|jpe?g|gif|webp);base64,/i;
/** Whether an href may stay: same-figure references or embedded raster images. */
export function safeSvgHref(value) {
  const href = String(value).trim();
  return href.startsWith("#") || RASTER.test(href);
}
/** Whether a style or attribute value only uses url(#id) references. */
export function safeSvgUrls(value) {
  return [...String(value).matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)].every(
    ([, , target]) => target.trim().startsWith("#"),
  );
}

const FORBIDDEN = [
  [/<!DOCTYPE|<!ENTITY/i, "must not declare a DOCTYPE or entities"],
  [/<script[\s>]/i, "must not contain <script>"],
  [
    /<style[\s>]/i,
    "must not contain <style>; use the palette classes or style attributes",
  ],
  [/<foreignObject[\s>]/i, "must not contain <foreignObject>"],
  [/<(iframe|object|embed|audio|video|canvas)[\s>]/i, "must not embed media"],
  [/<(animate|animateMotion|animateTransform|set)[\s>]/i, "must not animate"],
  [/\son[a-z]+\s*=/i, "must not contain event attributes such as onclick"],
  [/javascript:/i, "must not contain javascript: URLs"],
];

function checkSource(source) {
  if (typeof source !== "string" || !source.trim())
    fail("source must be non-empty SVG text.");
  if (source.length > SVG_LIMITS.sourceLength)
    fail(`source must be at most ${SVG_LIMITS.sourceLength} characters.`);
  const body = source.trim().replace(/^<\?xml[^>]*\?>\s*/i, "");
  if (!/^<svg[\s>]/i.test(body))
    fail("source must start with an <svg> element.");
  const root = body.slice(0, body.indexOf(">") + 1);
  if (!/\sviewBox\s*=\s*["'][^"']+["']/.test(root))
    fail("source <svg> needs a viewBox so the figure can scale.");
  for (const [pattern, message] of FORBIDDEN)
    if (pattern.test(body)) fail(`source ${message}.`);
  for (const [, name] of body.matchAll(/<([a-zA-Z][\w:-]*)/g))
    if (!SVG_ELEMENTS.includes(name))
      fail(`source uses <${name}>, which figures may not contain.`);
  for (const [, , value] of body.matchAll(
    /\s(xlink:href|href)\s*=\s*["']([^"']*)["']/g,
  ))
    if (!safeSvgHref(value))
      fail(
        `source href "${value.slice(0, 60)}" must point inside the figure (#id) or be an embedded PNG, JPEG, GIF or WebP.`,
      );
  if (!safeSvgUrls(body))
    fail(
      "source url(...) may only reference ids inside the figure (url(#id)).",
    );
}
function optionalText(value, label) {
  if (value === undefined) return;
  if (typeof value !== "string") fail(`${label} must be text.`);
  if (value.length > SVG_LIMITS.textLength)
    fail(`${label} must be at most ${SVG_LIMITS.textLength} characters.`);
}

export function validateSvgData(data) {
  if (!isObject(data)) fail("svg data must be an object.");
  checkSource(data.source);
  if (typeof data.alt !== "string" || !data.alt.trim())
    fail("alt must describe the figure for readers who cannot see it.");
  optionalText(data.alt, "alt");
  optionalText(data.title, "title");
  optionalText(data.caption, "caption");
  if (
    data.maxWidth !== undefined &&
    (typeof data.maxWidth !== "number" ||
      !Number.isFinite(data.maxWidth) ||
      data.maxWidth < 120 ||
      data.maxWidth > 2400)
  )
    fail("maxWidth must be a number of CSS pixels from 120 to 2400.");
  return data;
}
