import { useSyncExternalStore, type CSSProperties } from "react";

export const sidebarTones = ["sage", "rose", "blue", "oat", "mauve", "teal"];
export const sidebarSchemes = [
  "original",
  "morandi",
  "coast",
  "forest",
  "clay",
  "solid",
] as const;
export type SidebarScheme = (typeof sidebarSchemes)[number];
export type SidebarPalette = { scheme: SidebarScheme; solidColor: string };

const colors = {
  original: [
    "var(--paper)",
    "var(--surface)",
    "var(--line)",
    "var(--surface)",
    "var(--selected)",
    "var(--paper)",
  ],
  morandi: ["#809679", "#bd8791", "#7894b1", "#b89b66", "#9884aa", "#699e9b"],
  coast: ["#3777a1", "#64a9b5", "#566faf", "#83b6a3", "#a89569", "#568cbd"],
  forest: ["#54775b", "#8b924d", "#668f84", "#ae884e", "#748967", "#96765c"],
  clay: ["#ae684f", "#c28f63", "#ab757f", "#b7a266", "#936c66", "#c08d83"],
};
const defaultPalette: SidebarPalette = {
  scheme: "morandi",
  solidColor: "#8193a5",
};
const key = "showai:sidebar-palette:v1";
let unsaved: string | undefined;

export function paletteColors({
  scheme,
  solidColor,
}: SidebarPalette): string[] {
  return scheme === "solid" ? [solidColor] : colors[scheme];
}

export function sidebarRootProps(palette: SidebarPalette, tone?: string) {
  if (!tone || palette.scheme === "original") return {};
  const index = sidebarTones.indexOf(tone);
  if (index < 0) return {};
  return {
    "data-root-tone": tone,
    style: {
      "--root-pigment":
        palette.scheme === "solid"
          ? palette.solidColor
          : colors[palette.scheme][index],
    } as CSSProperties,
  };
}

function read() {
  if (unsaved !== undefined) return unsaved;
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      unsaved = undefined;
      notify();
    }
  };
  window.addEventListener(key, notify);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(key, notify);
    window.removeEventListener("storage", storage);
  };
}
export function parseSidebarPalette(raw: string): SidebarPalette {
  const [name, color] = raw.split(":");
  return {
    scheme:
      sidebarSchemes.find((scheme) => scheme === name) ?? defaultPalette.scheme,
    solidColor: /^#[0-9a-f]{6}$/i.test(color ?? "")
      ? color
      : defaultPalette.solidColor,
  };
}
export function useSidebarPalette(): SidebarPalette {
  return parseSidebarPalette(useSyncExternalStore(subscribe, read, () => ""));
}
export function setSidebarPalette(palette: SidebarPalette) {
  const value = `${palette.scheme}:${palette.solidColor}`;
  try {
    window.localStorage.setItem(key, value);
    unsaved = undefined;
  } catch (error) {
    unsaved = value;
    console.warn("Could not save the sidebar palette", error);
  }
  window.dispatchEvent(new Event(key));
}
