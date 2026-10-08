import mask from "./apple-icon-mask.json";

export const framePath =
  mask.points
    .map(
      ([x, y], index) =>
        `${index ? "L" : "M"}${Math.round((2 + (x * 508) / 512) * 1000) / 1000} ${Math.round((2 + (y * 508) / 512) * 1000) / 1000}`,
    )
    .join(" ") + " Z";

export type IconData = {
  blue: string;
  cornerDiameter: number;
  spacing: number;
  gap: number;
};

export type InterfaceMode = "light" | "dark";

export const initialData: IconData = {
  blue: "#06A5FA",
  cornerDiameter: 74,
  spacing: 125,
  gap: 16,
};

const round = (value: number) => Math.round(value * 100) / 100;

export function geometry(data: IconData) {
  const dx = round((60 * data.spacing) / 100);
  const dy = round((48 * data.spacing) / 100);
  return {
    cornerRadius: data.cornerDiameter / 2,
    framePath,
    strokeWidth: data.gap * 2,
    offsetX: dx,
    offsetY: dy,
    cards: [
      { id: "back", x: round(166 + dx), y: round(136 - dy) },
      { id: "middle", x: 166, y: 136 },
      { id: "front", x: round(166 - dx), y: round(136 + dy) },
    ],
  };
}

export function colors(mode: InterfaceMode) {
  return mode === "light"
    ? { background: "#000000", foreground: "#FFFFFF", border: "#3F3F46" }
    : { background: "#FFFFFF", foreground: "#000000", border: "#D3D6DE" };
}

export function makeSvg(data: IconData, mode: InterfaceMode) {
  const shape = geometry(data);
  const palette = colors(mode);
  const cards = shape.cards.map((card, index) => {
    const fill = card.id === "middle" ? data.blue : palette.foreground;
    const stroke = index
      ? ` stroke="${palette.background}" stroke-width="${shape.strokeWidth}" paint-order="stroke fill"`
      : "";
    return `  <rect id="${card.id}" x="${card.x}" y="${card.y}" width="180" height="240" rx="${shape.cornerRadius}" fill="${fill}"${stroke}/>`;
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title">',
    `  <title id="title">ShowAI · ${mode === "light" ? "亮色界面" : "暗色界面"}</title>`,
    `  <path d="${framePath}" fill="${palette.background}"/>`,
    ...cards,
    `  <path d="${framePath}" fill="none" stroke="${palette.border}" stroke-width="3"/>`,
    "</svg>",
  ].join("\n");
}

export function readData(data: IconData) {
  return {
    parameters: data,
    derived: true,
    geometry: geometry(data),
    appearances: [
      {
        id: "light-interface",
        colors: colors("light"),
        svg: makeSvg(data, "light"),
      },
      {
        id: "dark-interface",
        colors: colors("dark"),
        svg: makeSvg(data, "dark"),
      },
    ],
  };
}
