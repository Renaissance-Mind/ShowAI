import type { MessageKey } from "../i18n";
import type folderIconMessages from "../i18n/messages/folderIcons";

type FolderIconMessageKey = MessageKey<typeof folderIconMessages>;

export interface FolderIconPreset {
  id: string;
  nameKey: FolderIconMessageKey;
  color: string;
  symbol?:
    | "briefcase"
    | "code"
    | "chart"
    | "book"
    | "flask"
    | "camera"
    | "star"
    | "heart"
    | "bookmark"
    | "flag"
    | "bolt"
    | "globe";
}

export const folderIconGroups: {
  id: "color" | "work" | "mark";
  nameKey: FolderIconMessageKey;
  presets: FolderIconPreset[];
}[] = [
  {
    id: "color",
    nameKey: "group.color",
    presets: [
      {
        id: "color-graphite",
        nameKey: "preset.graphite",
        color: "#7c8492",
      },
      { id: "color-blue", nameKey: "preset.blue", color: "#5b8def" },
      { id: "color-teal", nameKey: "preset.teal", color: "#4fae9c" },
      { id: "color-yellow", nameKey: "preset.yellow", color: "#d5a541" },
      { id: "color-orange", nameKey: "preset.orange", color: "#d47f50" },
      { id: "color-red", nameKey: "preset.red", color: "#cf6464" },
    ],
  },
  {
    id: "work",
    nameKey: "group.work",
    presets: [
      {
        id: "work-briefcase",
        nameKey: "preset.briefcase",
        color: "#6686c9",
        symbol: "briefcase",
      },
      {
        id: "work-code",
        nameKey: "preset.code",
        color: "#64748b",
        symbol: "code",
      },
      {
        id: "work-chart",
        nameKey: "preset.chart",
        color: "#4f9a83",
        symbol: "chart",
      },
      {
        id: "work-book",
        nameKey: "preset.book",
        color: "#b18455",
        symbol: "book",
      },
      {
        id: "work-flask",
        nameKey: "preset.flask",
        color: "#7683bd",
        symbol: "flask",
      },
      {
        id: "work-camera",
        nameKey: "preset.camera",
        color: "#a2729f",
        symbol: "camera",
      },
    ],
  },
  {
    id: "mark",
    nameKey: "group.mark",
    presets: [
      {
        id: "mark-star",
        nameKey: "preset.star",
        color: "#d3a341",
        symbol: "star",
      },
      {
        id: "mark-heart",
        nameKey: "preset.heart",
        color: "#ce6c76",
        symbol: "heart",
      },
      {
        id: "mark-bookmark",
        nameKey: "preset.bookmark",
        color: "#7286c5",
        symbol: "bookmark",
      },
      {
        id: "mark-flag",
        nameKey: "preset.flag",
        color: "#d17e54",
        symbol: "flag",
      },
      {
        id: "mark-bolt",
        nameKey: "preset.bolt",
        color: "#b4933f",
        symbol: "bolt",
      },
      {
        id: "mark-globe",
        nameKey: "preset.globe",
        color: "#539a9c",
        symbol: "globe",
      },
    ],
  },
];

const pngPrefix = "data:image/png;base64,";
// The PNG signature and IHDR chunk are 33 bytes, or 44 base64 characters.
const pngMetadataStart = pngPrefix.length + 44;

function presetPngChunk(id: string): string {
  const text = `ShowAI Folder Preset\0${id}`;
  // Keep the chunk on a base64 boundary when inserting it after IHDR.
  const data = text.padEnd(Math.ceil(text.length / 3) * 3);
  const body = new TextEncoder().encode("tEXt" + data);
  let checksum = 0xffffffff;
  for (const byte of body) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++)
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  const chunk = new Uint8Array(body.length + 8);
  const header = new DataView(chunk.buffer);
  header.setUint32(0, data.length);
  chunk.set(body, 4);
  header.setUint32(chunk.length - 4, checksum ^ 0xffffffff);
  return btoa(String.fromCharCode(...chunk));
}

const taggedPresets = folderIconGroups.flatMap((group) =>
  group.presets.map((preset) => ({ preset, chunk: presetPngChunk(preset.id) })),
);

export function folderPresetFromIcon(
  value?: string,
): FolderIconPreset | undefined {
  if (!value?.startsWith(pngPrefix + "iVBORw0KGgo")) return undefined;
  return taggedPresets.find(({ chunk }) =>
    value.startsWith(chunk, pngMetadataStart),
  )?.preset;
}

export function tagFolderPresetIcon(
  value: string,
  preset: FolderIconPreset,
): string {
  const chunk = presetPngChunk(preset.id);
  return (
    value.slice(0, pngMetadataStart) + chunk + value.slice(pngMetadataStart)
  );
}

export async function rasterizeFolderPreset(
  preset: FolderIconPreset,
  glyph: SVGSVGElement,
): Promise<string> {
  const image = new Image();
  const markup = new XMLSerializer().serializeToString(glyph);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  canvas.getContext("2d")!.drawImage(image, 0, 0, 128, 128);
  return tagFolderPresetIcon(canvas.toDataURL("image/png"), preset);
}
