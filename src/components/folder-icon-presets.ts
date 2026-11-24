import type { MessageKey } from "../i18n";
import type folderIconMessages from "../i18n/messages/folderIcons";

type FolderIconMessageKey = MessageKey<typeof folderIconMessages>;

export type FolderIconGroupId = "color" | "work" | "mark";
export type FolderIconGroupPreferences = Record<FolderIconGroupId, boolean>;

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
  id: FolderIconGroupId;
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

export function defaultFolderIconGroups(): FolderIconGroupPreferences {
  return { color: true, work: true, mark: true };
}

export function parseFolderIconGroups(
  source: string | null,
): FolderIconGroupPreferences {
  const preferences = defaultFolderIconGroups();
  if (!source) return preferences;
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    for (const group of folderIconGroups) {
      const visible = value[group.id];
      if (typeof visible === "boolean") preferences[group.id] = visible;
    }
  } catch {
    return preferences;
  }
  return preferences;
}

function symbolMarkup(symbol: FolderIconPreset["symbol"]): string {
  const common =
    'fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"';
  switch (symbol) {
    case "briefcase":
      return `<rect x="32" y="43" width="32" height="27" rx="4" ${common}/><path d="M40 43v-6h16v6M32 53c9 5 23 5 32 0M48 52v5" ${common}/>`;
    case "code":
      return `<path d="m42 44-9 11 9 11M54 44l9 11-9 11M51 40l-6 30" ${common}/>`;
    case "chart":
      return `<path d="M31 70h36M35 66V55M48 66V43M61 66V51" ${common}/>`;
    case "book":
      return `<path d="M28 42c8-3 15-1 20 4v27c-5-5-12-7-20-4V42Zm40 0c-8-3-15-1-20 4v27c5-5 12-7 20-4V42Z" ${common}/>`;
    case "flask":
      return `<path d="M41 39h14M44 39v13L33 67c-2 4 1 7 5 7h20c4 0 7-3 5-7L52 52V39M39 61h18" ${common}/>`;
    case "camera":
      return `<path d="M29 48h9l4-7h13l4 7h9v25H29V48Z" ${common}/><circle cx="48" cy="59" r="8" ${common}/>`;
    case "star":
      return '<path d="m48 35 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2 7-14Z" fill="white"/>';
    case "heart":
      return '<path d="M48 75S27 63 27 49c0-12 15-16 21-6 6-10 21-6 21 6 0 14-21 26-21 26Z" fill="white"/>';
    case "bookmark":
      return `<path d="M37 36h22v39L48 66l-11 9V36Z" ${common}/>`;
    case "flag":
      return `<path d="M34 76V36M37 39h28l-7 11 7 11H37" ${common}/>`;
    case "bolt":
      return '<path d="m53 33-21 28h14l-3 19 22-31H51l2-16Z" fill="white"/>';
    case "globe":
      return `<circle cx="48" cy="56" r="21" ${common}/><path d="M27 56h42M48 35c8 8 11 15 11 21s-3 13-11 21c-8-8-11-15-11-21s3-13 11-21Z" ${common}/>`;
    default:
      return "";
  }
}

export function folderPresetSvg(preset: FolderIconPreset): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="folder" x1="18" y1="18" x2="78" y2="82" gradientUnits="userSpaceOnUse"><stop stop-color="${preset.color}"/><stop offset="1" stop-color="${preset.color}" stop-opacity=".78"/></linearGradient></defs><path d="M10 28a10 10 0 0 1 10-10h21l10 11h25a10 10 0 0 1 10 10v35a10 10 0 0 1-10 10H20A10 10 0 0 1 10 74V28Z" fill="url(#folder)"/><path d="M11 40h74" stroke="white" stroke-opacity=".22" stroke-width="2"/>${symbolMarkup(preset.symbol)}</svg>`;
}

export function folderPresetSource(preset: FolderIconPreset): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(folderPresetSvg(preset))}`;
}

export async function rasterizeFolderPreset(
  preset: FolderIconPreset,
): Promise<string> {
  const image = new Image();
  image.src = folderPresetSource(preset);
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  canvas.getContext("2d")!.drawImage(image, 0, 0, 128, 128);
  return canvas.toDataURL("image/png");
}
