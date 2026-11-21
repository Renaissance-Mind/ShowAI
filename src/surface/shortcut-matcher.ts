import { boardTools } from "./board-tools";

export type KeyChord = string;

export interface KeyEventInput {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export const CUSTOM_SHORTCUTS_KEY = "showai:custom-shortcuts";
export const SHORTCUTS_CHANGE_EVENT = "showai:shortcuts-change";

const IGNORED_KEYS = new Set([
  "Meta",
  "Control",
  "Shift",
  "Alt",
  "AltGraph",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Dead",
  "Process",
  "Unidentified",
]);

export const detectMacPlatform = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function getCustomShortcutsSnapshot(): string {
  try {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(CUSTOM_SHORTCUTS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function readCustomShortcuts(): Record<string, KeyChord> {
  const raw = getCustomShortcutsSnapshot();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, KeyChord> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeCustomShortcuts(next: Record<string, KeyChord>) {
  try {
    if (typeof localStorage === "undefined") return;
    if (!Object.keys(next).length) localStorage.removeItem(CUSTOM_SHORTCUTS_KEY);
    else localStorage.setItem(CUSTOM_SHORTCUTS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures cleanly
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(SHORTCUTS_CHANGE_EVENT));
}

export function shortcutSlotKey(entryId: string, slotIndex: number): string {
  return `${entryId}:${slotIndex}`;
}

export function resolvedSlotChord(
  entryId: string,
  slotIndex: number,
  defaultChord: KeyChord,
  overrides: Record<string, KeyChord> = readCustomShortcuts(),
): KeyChord {
  return overrides[shortcutSlotKey(entryId, slotIndex)] ?? defaultChord;
}

export function hasSlotOverride(
  entryId: string,
  slotIndex: number,
  overrides: Record<string, KeyChord> = readCustomShortcuts(),
): boolean {
  return shortcutSlotKey(entryId, slotIndex) in overrides;
}

function normalizeKeyFromEvent(event: KeyEventInput): string | null {
  if (IGNORED_KEYS.has(event.key)) return null;
  if (event.key === "Escape") return "Escape";
  if (event.key === "Tab") return "Tab";
  if (event.key === "Backspace") return "Backspace";
  if (event.key === "Delete") return "Delete";
  if (event.key === "ContextMenu") return "Menu";
  if (event.key === "ArrowLeft") return "Left";
  if (event.key === "ArrowRight") return "Right";
  if (event.key === "ArrowUp") return "Up";
  if (event.key === "ArrowDown") return "Down";
  if (event.key === " " || event.code === "Space") return "Space";
  if (event.key === "+" || (event.code === "Equal" && event.shiftKey)) return "+";
  if (event.key === "-" || (event.code === "Minus" && !event.shiftKey)) return "-";
  if (event.key === "[" || event.code === "BracketLeft") return "[";
  if (event.key === "]" || event.code === "BracketRight") return "]";
  if (event.key === "\\" || event.code === "Backslash") return "\\";
  if (event.key === "/" || event.code === "Slash") return "/";
  if (event.key === "=" || event.code === "Equal") return "=";
  if (event.key === "," || event.code === "Comma") return ",";
  if (event.key === "." || event.code === "Period") return ".";
  if (event.code?.startsWith("Key")) return event.code.slice(3).toUpperCase();
  if (event.code?.startsWith("Digit") && !event.shiftKey)
    return event.code.slice(5);
  if (/^F([1-9]|1[0-2])$/i.test(event.key)) return event.key.toUpperCase();
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  if (/^[0-9]$/.test(event.key)) return event.key;
  if (event.key.length === 1) return event.key.toUpperCase();
  return null;
}

export function eventToChord(
  event: KeyEventInput,
  mac = detectMacPlatform(),
): KeyChord | null {
  const key = normalizeKeyFromEvent(event);
  if (!key) return null;
  const parts: string[] = [];
  if (mac) {
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Mod");
  } else {
    if (event.ctrlKey) parts.push("Mod");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
  }
  parts.push(key);
  return parts.join("+");
}

function parseChord(
  chord: KeyChord,
  mac: boolean,
): {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
} {
  const parts = chord.split(/\+(?!$)/);
  const key = parts[parts.length - 1] ?? "";
  let metaKey = false;
  let ctrlKey = false;
  let altKey = false;
  let shiftKey = false;
  for (const mod of parts.slice(0, -1)) {
    if (mod === "Mod") {
      if (mac) metaKey = true;
      else ctrlKey = true;
    } else if (mod === "Ctrl") ctrlKey = true;
    else if (mod === "Alt") altKey = true;
    else if (mod === "Shift") shiftKey = true;
    else if (mod === "Meta") metaKey = true;
  }
  return { key, metaKey, ctrlKey, altKey, shiftKey };
}

export function matchesChord(
  event: KeyEventInput,
  chord: KeyChord,
  mac = detectMacPlatform(),
): boolean {
  if (!chord) return false;
  const spec = parseChord(chord, mac);
  const eventKey = normalizeKeyFromEvent(event);
  if (!eventKey) return false;
  if (
    event.metaKey !== spec.metaKey ||
    event.ctrlKey !== spec.ctrlKey ||
    event.altKey !== spec.altKey ||
    event.shiftKey !== spec.shiftKey
  ) {
    return false;
  }
  return eventKey.toUpperCase() === spec.key.toUpperCase();
}

export function entryKeyMatches(
  event: KeyEventInput,
  entryId: string,
  slotIndex: number,
  defaultChord: KeyChord,
  mac = detectMacPlatform(),
): boolean {
  const active = resolvedSlotChord(entryId, slotIndex, defaultChord);
  return matchesChord(event, active, mac);
}

export function matchCustomizedBoardTool(
  event: KeyEventInput,
  mac = detectMacPlatform(),
) {
  const overrides = readCustomShortcuts();
  for (const tool of boardTools) {
    const id = `board.tool.${tool.tool ?? "select"}`;
    const defaultKeys = [
      tool.key,
      ...tool.aliases.map((alias) => alias.toUpperCase()),
    ].filter((key, index, all) => all.indexOf(key) === index);
    for (let i = 0; i < defaultKeys.length; i++) {
      const active = resolvedSlotChord(id, i, defaultKeys[i], overrides);
      if (matchesChord(event, active, mac)) return tool;
    }
  }
  return null;
}
