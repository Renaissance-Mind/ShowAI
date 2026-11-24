export const defaultFolderColor = "#a8b0bd";

export const folderColors = [
  { value: "", name: "defaultColor" },
  { value: "#7c8492", name: "preset.graphite" },
  { value: "#5b8def", name: "preset.blue" },
  { value: "#4fae9c", name: "preset.teal" },
  { value: "#75965e", name: "preset.olive" },
  { value: "#d5a541", name: "preset.yellow" },
  { value: "#d47f50", name: "preset.orange" },
  { value: "#cf6464", name: "preset.red" },
  { value: "#9274c0", name: "preset.violet" },
] as const;

export const folderSymbols = [
  "briefcase",
  "code",
  "chart",
  "book",
  "flask",
  "camera",
  "star",
  "heart",
  "bookmark",
  "flag",
  "bolt",
  "globe",
] as const;

export type FolderSymbol = (typeof folderSymbols)[number];
export type FolderBadge =
  { kind: "symbol"; value: FolderSymbol } | { kind: "emoji"; value: string };

export const folderBadgeBackgrounds = [
  "transparent",
  "white",
  "adaptive",
] as const;
export type FolderBadgeBackground = (typeof folderBadgeBackgrounds)[number];

export type FolderIconStyle = {
  mode: "folder" | "standalone";
  color: string;
  badge: FolderBadge | null;
  badgeBackground?: FolderBadgeBackground;
};

const legacyColors: Record<string, string> = {
  "color-graphite": "#7c8492",
  "color-blue": "#5b8def",
  "color-teal": "#4fae9c",
  "color-yellow": "#d5a541",
  "color-orange": "#d47f50",
  "color-red": "#cf6464",
  "work-briefcase": "#6686c9",
  "work-code": "#64748b",
  "work-chart": "#4f9a83",
  "work-book": "#b18455",
  "work-flask": "#7683bd",
  "work-camera": "#a2729f",
  "mark-star": "#d3a341",
  "mark-heart": "#ce6c76",
  "mark-bookmark": "#7286c5",
  "mark-flag": "#d17e54",
  "mark-bolt": "#b4933f",
  "mark-globe": "#539a9c",
};

const pngPrefix = "data:image/png;base64,";
const styleTag = "ShowAI Folder Style\0";
const legacyTag = "ShowAI Folder Preset\0";
// The PNG signature and IHDR chunk are 33 bytes, or 44 base64 characters.
const pngMetadataStart = pngPrefix.length + 44;

function isFolderSymbol(value: unknown): value is FolderSymbol {
  return folderSymbols.some((symbol) => symbol === value);
}

function isBadge(value: unknown): value is FolderBadge {
  if (!value || typeof value !== "object") return false;
  const badge = value as Partial<FolderBadge>;
  return badge.kind === "symbol"
    ? isFolderSymbol(badge.value)
    : badge.kind === "emoji" &&
        typeof badge.value === "string" &&
        badge.value.length >= 1 &&
        badge.value.length <= 64 &&
        !/[\u0000-\u001f]/.test(badge.value);
}

function isFolderStyle(value: unknown): value is FolderIconStyle {
  if (!value || typeof value !== "object") return false;
  const style = value as Partial<FolderIconStyle>;
  return (
    (style.mode === "folder" || style.mode === "standalone") &&
    typeof style.color === "string" &&
    (style.color === "" || /^#[\da-f]{6}$/i.test(style.color)) &&
    (style.badgeBackground === undefined ||
      folderBadgeBackgrounds.some(
        (background) => background === style.badgeBackground,
      )) &&
    (style.badge === null || isBadge(style.badge))
  );
}

function pngTextChunk(text: string): string {
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

export function readFolderIconStyle(
  value?: string,
): FolderIconStyle | undefined {
  if (!value?.startsWith(pngPrefix + "iVBORw0KGgo")) return undefined;
  try {
    const start = pngMetadataStart;
    const header = atob(value.slice(start, start + 12));
    if (header.slice(4, 8) !== "tEXt") return undefined;
    const length = new DataView(
      Uint8Array.from(header, (byte) => byte.charCodeAt(0)).buffer,
    ).getUint32(0);
    if (length === 0 || length > 1024) return undefined;
    const end = start + Math.ceil((length + 12) / 3) * 4;
    if (value.length < end) return undefined;
    const text = atob(value.slice(start, end))
      .slice(8, 8 + length)
      .trimEnd();
    if (text.startsWith(legacyTag)) {
      const id = text.slice(legacyTag.length);
      if (!Object.hasOwn(legacyColors, id)) return undefined;
      const symbol = id.slice(id.indexOf("-") + 1);
      return {
        mode: "folder",
        color: legacyColors[id],
        badge: isFolderSymbol(symbol)
          ? { kind: "symbol", value: symbol }
          : null,
      };
    }
    if (!text.startsWith(styleTag)) return undefined;
    const style: unknown = JSON.parse(
      decodeURIComponent(text.slice(styleTag.length)),
    );
    return isFolderStyle(style) ? style : undefined;
  } catch {
    return undefined;
  }
}

export function tagFolderIcon(value: string, style: FolderIconStyle): string {
  if (!isFolderStyle(style)) throw new TypeError("Invalid folder icon style.");
  const chunk = pngTextChunk(
    styleTag + encodeURIComponent(JSON.stringify(style)),
  );
  return (
    value.slice(0, pngMetadataStart) + chunk + value.slice(pngMetadataStart)
  );
}

export async function rasterizeFolderIcon(
  style: FolderIconStyle,
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
  return tagFolderIcon(canvas.toDataURL("image/png"), style);
}
