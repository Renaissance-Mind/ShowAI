import { readFile } from "node:fs/promises";

export const design = JSON.parse(
  await readFile(new URL("./icon-design.json", import.meta.url), "utf8"),
);
const mask = JSON.parse(
  await readFile(new URL("./apple-icon-mask.json", import.meta.url), "utf8"),
);
const number = (value) => Math.round(value * 1000) / 1000;
const frame =
  mask.points
    .map(
      ([x, y], index) =>
        `${index ? "L" : "M"}${number(2 + (x * 508) / 512)} ${number(2 + (y * 508) / 512)}`,
    )
    .join(" ") + " Z";

export function iconSvg(mode, { masked = true } = {}) {
  const colors = design.appearances[mode];
  if (!colors) throw new Error(`Unknown icon appearance: ${mode}`);
  const x = (design.canvasSize - design.cardWidth) / 2;
  const y = (design.canvasSize - design.cardHeight) / 2;
  const cards = [
    ["back", x + design.offsetX, y - design.offsetY],
    ["middle", x, y],
    ["front", x - design.offsetX, y + design.offsetY],
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${design.canvasSize}" height="${design.canvasSize}" viewBox="0 0 ${design.canvasSize} ${design.canvasSize}" role="img" aria-labelledby="title">`,
    `  <title id="title">ShowAI · ${mode === "dark" ? "亮色界面" : "暗色界面"}${masked ? "" : " · 无遮罩母版"}</title>`,
    masked
      ? `  <path d="${frame}" fill="${colors.background}"/>`
      : `  <rect width="${design.canvasSize}" height="${design.canvasSize}" fill="${colors.background}"/>`,
    ...cards.map(
      ([id, left, top], index) =>
        `  <rect id="${id}" x="${left}" y="${top}" width="${design.cardWidth}" height="${design.cardHeight}" rx="${design.cornerRadius}" fill="${id === "middle" ? design.blue : colors.foreground}"${index ? ` stroke="${colors.background}" stroke-width="${design.gap * 2}" paint-order="stroke fill"` : ""}/>`,
    ),
    ...(masked
      ? [
          `  <path d="${frame}" fill="none" stroke="${colors.border}" stroke-width="3"/>`,
        ]
      : []),
    "</svg>\n",
  ].join("\n");
}
