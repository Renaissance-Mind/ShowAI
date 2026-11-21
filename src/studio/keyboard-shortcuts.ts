import { boardTools } from "../surface/board-tools";
import {
  CUSTOM_SHORTCUTS_KEY,
  SHORTCUTS_CHANGE_EVENT,
  detectMacPlatform,
  entryKeyMatches,
  eventToChord,
  getCustomShortcutsSnapshot,
  hasSlotOverride,
  matchCustomizedBoardTool,
  matchesChord,
  readCustomShortcuts,
  resolvedSlotChord,
  shortcutSlotKey,
  writeCustomShortcuts,
  type KeyChord,
  type KeyEventInput,
} from "../surface/shortcut-matcher";
import type { MessageKey } from "../i18n";
import type navigationMessages from "../i18n/messages/navigation";
import type surfaceMessages from "../i18n/messages/surface";

export {
  SHORTCUTS_CHANGE_EVENT,
  entryKeyMatches,
  eventToChord,
  getCustomShortcutsSnapshot,
  hasSlotOverride,
  matchCustomizedBoardTool,
  matchesChord,
  readCustomShortcuts,
  resolvedSlotChord,
  shortcutSlotKey,
  type KeyChord,
  type KeyEventInput,
};

export interface ShortcutEntry {
  id: string;
  keys: KeyChord[];
  defaultKeys?: KeyChord[];
  editable?: boolean;
  label:
    | { navigation: MessageKey<typeof navigationMessages> }
    | { surface: MessageKey<typeof surfaceMessages> };
}

export interface ShortcutGroup {
  id: "general" | "tabs" | "library" | "page" | "board";
  entries: ShortcutEntry[];
}

const glyphs: Record<string, [mac: string, other: string]> = {
  Mod: ["⌘", "Ctrl"],
  Ctrl: ["⌃", "Ctrl"],
  Shift: ["⇧", "Shift"],
  Alt: ["⌥", "Alt"],
  Left: ["←", "←"],
  Right: ["→", "→"],
  Up: ["↑", "↑"],
  Down: ["↓", "↓"],
  Backspace: ["⌫", "Backspace"],
  Escape: ["Esc", "Esc"],
  Tab: ["Tab", "Tab"],
};

export const clientIsMac = detectMacPlatform;

export function setCustomShortcut(
  entryId: string,
  slotIndex: number,
  chord: KeyChord | null,
) {
  const next = readCustomShortcuts();
  const key = shortcutSlotKey(entryId, slotIndex);
  if (chord && chord.trim()) next[key] = chord.trim();
  else delete next[key];
  writeCustomShortcuts(next);
}

export function resetAllCustomShortcuts() {
  writeCustomShortcuts({});
}

export function hasCustomShortcuts(): boolean {
  return Object.keys(readCustomShortcuts()).length > 0;
}

export function subscribeShortcuts(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === CUSTOM_SHORTCUTS_KEY) listener();
  };
  window.addEventListener(SHORTCUTS_CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SHORTCUTS_CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function resolveEntryKeys(
  entryId: string,
  defaults: KeyChord[],
  overrides: Record<string, KeyChord> = readCustomShortcuts(),
): KeyChord[] {
  return defaults.map(
    (chord, index) => overrides[shortcutSlotKey(entryId, index)] ?? chord,
  );
}

export function formatShortcut(
  chord: KeyChord,
  mac: boolean,
  names: Partial<Record<string, string>> = {},
): string {
  const parts = chord.split(/\+(?!$)/).map((part) => {
    const glyph = glyphs[part];
    if (glyph) return mac ? glyph[0] : glyph[1];
    return names[part] ?? (part.length === 1 ? part.toUpperCase() : part);
  });
  if (!mac) {
    const order = ["Ctrl", "Shift", "Alt"];
    const modifiers = parts
      .filter((part) => order.includes(part))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const keys = parts.filter((part) => !order.includes(part));
    return [...modifiers, ...keys].join("+");
  }
  const order = ["⌃", "⌥", "⇧", "⌘"];
  const modifiers = parts
    .filter((part) => order.includes(part))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const keys = parts.filter((part) => !order.includes(part));
  return modifiers.join("") + keys.join(mac && modifiers.length ? "" : "+");
}

export function isDeleteShortcut(event: KeyEventInput, mac: boolean) {
  const overrides = readCustomShortcuts();
  if (mac) {
    const first =
      overrides[shortcutSlotKey("library.delete", 0)] ?? "Mod+Backspace";
    const second = overrides[shortcutSlotKey("library.delete", 1)] ?? "Delete";
    return matchesChord(event, first, mac) || matchesChord(event, second, mac);
  }
  const sole = overrides[shortcutSlotKey("library.delete", 0)] ?? "Delete";
  return matchesChord(event, sole, mac);
}

export function isRenameShortcut(event: KeyEventInput, mac = clientIsMac()) {
  return entryKeyMatches(event, "library.rename", 0, "F2", mac);
}

export function isContextMenuShortcut(
  event: KeyEventInput,
  mac = clientIsMac(),
) {
  return (
    entryKeyMatches(event, "library.menu", 0, "Shift+F10", mac) ||
    entryKeyMatches(event, "library.menu", 1, "Menu", mac)
  );
}

export function isSidebarToggleShortcut(
  event: KeyEventInput,
  mac = clientIsMac(),
) {
  const overrides = readCustomShortcuts();
  const custom = overrides[shortcutSlotKey("general.sidebar", 0)];
  if (custom) return matchesChord(event, custom, mac);
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "\\" || event.code === "Backslash")
  );
}

export function findShortcutConflict(
  candidateChord: KeyChord,
  targetEntryId: string,
  targetSlotIndex: number,
  options: { mac: boolean; tabs: boolean; windows: boolean; browser?: boolean },
): ShortcutEntry | null {
  const normalized = candidateChord.toUpperCase();
  for (const group of shortcutGroups(options)) {
    for (const entry of group.entries) {
      for (let i = 0; i < entry.keys.length; i++) {
        if (entry.id === targetEntryId && i === targetSlotIndex) continue;
        if (entry.keys[i].toUpperCase() === normalized) return entry;
      }
    }
  }
  return null;
}

export function shortcutGroups(options: {
  mac: boolean;
  tabs: boolean;
  windows: boolean;
  browser?: boolean;
}): ShortcutGroup[] {
  const own = (keys: string[]) =>
    !options.browser ||
    !keys.some((key) => ["Mod+N", "Mod+T", "Mod+W", "Ctrl+Tab"].includes(key));
  const n = (key: MessageKey<typeof navigationMessages>) => ({
    navigation: key,
  });
  const overrides = readCustomShortcuts();
  const make = (
    id: string,
    defaults: KeyChord[],
    label: ShortcutEntry["label"],
    editable = true,
  ): ShortcutEntry => ({
    id,
    defaultKeys: defaults,
    keys: editable ? resolveEntryKeys(id, defaults, overrides) : defaults,
    editable,
    label,
  });

  return [
    {
      id: "general",
      entries: [
        make("general.search", ["Mod+K"], n("shortcut.search")),
        ...(own(["Mod+N"])
          ? [make("general.newPage", ["Mod+N"], n("shortcut.newPage"))]
          : []),
        make("general.sidebar", ["Mod+\\"], n("shortcut.sidebar")),
        make("general.reload", ["Mod+R"], n("shortcut.reload")),
        make("general.escape", ["Escape"], n("shortcut.escape"), false),
      ],
    },
    ...(options.tabs
      ? [
          {
            id: "tabs" as const,
            entries: [
              ...(own(["Mod+T", "Mod+W", "Ctrl+Tab"])
                ? [
                    make("tabs.new", ["Mod+T"], n("shortcut.newTab")),
                    make("tabs.close", ["Mod+W"], n("shortcut.closeTab")),
                    make(
                      "tabs.switch",
                      ["Ctrl+Tab", "Ctrl+Shift+Tab"],
                      n("shortcut.switchTab"),
                    ),
                  ]
                : []),
              make(
                "tabs.move",
                ["Alt+Shift+Left", "Alt+Shift+Right"],
                n("shortcut.moveTab"),
              ),
              make("tabs.openTab", ["Mod+Click"], n("shortcut.openTab"), false),
              ...(options.windows
                ? [
                    make(
                      "tabs.openWindow",
                      ["Shift+Click"],
                      n("shortcut.openWindow"),
                      false,
                    ),
                  ]
                : []),
            ],
          },
        ]
      : []),
    {
      id: "library",
      entries: [
        make("library.rename", ["F2"], n("shortcut.rename")),
        make(
          "library.delete",
          options.mac ? ["Mod+Backspace", "Delete"] : ["Delete"],
          n("shortcut.delete"),
        ),
        make("library.menu", ["Shift+F10", "Menu"], n("shortcut.menu")),
        make(
          "library.undo",
          ["Mod+Z", "Shift+Mod+Z"],
          n("shortcut.libraryUndo"),
        ),
        make("library.selectAll", ["Mod+A"], n("shortcut.selectAll")),
      ],
    },
    {
      id: "page",
      entries: [
        make("page.insert", ["/"], n("shortcut.insert"), false),
        make(
          "page.undo",
          ["Mod+Z", "Shift+Mod+Z"],
          n("shortcut.editUndo"),
          false,
        ),
        make("page.find", ["Mod+F"], n("shortcut.find")),
        make("page.findReplace", ["Alt+Mod+F"], n("shortcut.findReplace")),
        make(
          "page.findStep",
          ["Mod+G", "Shift+Mod+G"],
          n("shortcut.findStep"),
        ),
        make("page.comment", ["Shift+Mod+M"], n("shortcut.comment")),
      ],
    },
    {
      id: "board",
      entries: [
        ...boardTools.map((tool) =>
          make(
            `board.tool.${tool.tool ?? "select"}`,
            [tool.key, ...tool.aliases.map((alias) => alias.toUpperCase())].filter(
              (key, index, all) => all.indexOf(key) === index,
            ),
            { surface: tool.label },
          ),
        ),
        make("board.pan", ["Space"], n("shortcut.pan"), false),
        make("board.zoom", ["+", "-"], n("shortcut.zoom"), false),
        make("board.fit", ["0"], n("shortcut.fit")),
        make("board.nudge", ["Arrows"], n("shortcut.nudge"), false),
        make("board.duplicate", ["Mod+D"], n("shortcut.duplicate")),
        make(
          "board.copyCut",
          ["Mod+C", "Mod+X"],
          n("shortcut.copyCut"),
          false,
        ),
        make("board.paste", ["Mod+V"], n("shortcut.paste"), false),
        make("board.order", ["]", "["], n("shortcut.order")),
        make(
          "board.orderEdge",
          ["Shift+]", "Shift+["],
          n("shortcut.orderEdge"),
        ),
        make("board.ungroup", ["Shift+Mod+G"], n("shortcut.ungroup")),
        make("board.lock", ["Shift+Mod+L"], n("shortcut.lock")),
      ],
    },
  ];
}
