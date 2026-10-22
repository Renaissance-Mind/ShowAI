import { boardTools } from "../surface/board-tools";
import type { MessageKey } from "../i18n";
import type navigationMessages from "../i18n/messages/navigation";
import type surfaceMessages from "../i18n/messages/surface";

/**
 * Key chords use `Mod` for Command on macOS and Ctrl elsewhere. A chord is a
 * `+`-separated list; named keys are translated where they have no glyph.
 */
export type KeyChord = string;

export interface ShortcutEntry {
  /** Alternatives that do the same thing, such as `Mod+Z` or `Shift+Mod+Z`. */
  keys: KeyChord[];
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
  Backspace: ["⌫", "Backspace"],
  Escape: ["Esc", "Esc"],
  Tab: ["Tab", "Tab"],
};

/** The keyboard in front of the person, which may differ from the server's OS in browser mode. */
export const clientIsMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** Formats a chord the way the platform writes it: `⇧⌘Z` or `Ctrl+Shift+Z`. */
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
    // Windows and Linux list Ctrl before Shift and Alt.
    const order = ["Ctrl", "Shift", "Alt"];
    const modifiers = parts
      .filter((part) => order.includes(part))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const keys = parts.filter((part) => !order.includes(part));
    return [...modifiers, ...keys].join("+");
  }
  // macOS lists ⌃ ⌥ ⇧ ⌘ in that order and joins without separators.
  const order = ["⌃", "⌥", "⇧", "⌘"];
  const modifiers = parts
    .filter((part) => order.includes(part))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const keys = parts.filter((part) => !order.includes(part));
  return modifiers.join("") + keys.join(mac && modifiers.length ? "" : "+");
}

/** Deleting from the sidebar: Delete, or ⌘⌫ where the key is labelled delete. */
export function isDeleteShortcut(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  mac: boolean,
) {
  if (event.altKey) return false;
  return (
    (event.key === "Delete" && !event.metaKey && !event.ctrlKey) ||
    (mac && event.metaKey && event.key === "Backspace")
  );
}

export function isSidebarToggleShortcut(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "\\" || event.code === "Backslash")
  );
}

/** Every shortcut the workbench handles, grouped as the overview lists them. */
export function shortcutGroups(options: {
  mac: boolean;
  tabs: boolean;
  windows: boolean;
}): ShortcutGroup[] {
  const n = (key: MessageKey<typeof navigationMessages>) => ({
    navigation: key,
  });
  return [
    {
      id: "general",
      entries: [
        { keys: ["Mod+K"], label: n("shortcut.search") },
        { keys: ["Mod+N"], label: n("shortcut.newPage") },
        { keys: ["Mod+\\"], label: n("shortcut.sidebar") },
        { keys: ["Mod+R"], label: n("shortcut.reload") },
        { keys: ["Escape"], label: n("shortcut.escape") },
      ],
    },
    ...(options.tabs
      ? [
          {
            id: "tabs" as const,
            entries: [
              { keys: ["Mod+T"], label: n("shortcut.newTab") },
              { keys: ["Mod+W"], label: n("shortcut.closeTab") },
              {
                keys: ["Ctrl+Tab", "Ctrl+Shift+Tab"],
                label: n("shortcut.switchTab"),
              },
              {
                keys: ["Alt+Shift+Left", "Alt+Shift+Right"],
                label: n("shortcut.moveTab"),
              },
              { keys: ["Mod+Click"], label: n("shortcut.openTab") },
              ...(options.windows
                ? [{ keys: ["Shift+Click"], label: n("shortcut.openWindow") }]
                : []),
            ],
          },
        ]
      : []),
    {
      id: "library",
      entries: [
        { keys: ["F2"], label: n("shortcut.rename") },
        {
          keys: options.mac ? ["Mod+Backspace", "Delete"] : ["Delete"],
          label: n("shortcut.delete"),
        },
        { keys: ["Shift+F10", "Menu"], label: n("shortcut.menu") },
        {
          keys: ["Mod+Z", "Shift+Mod+Z"],
          label: n("shortcut.libraryUndo"),
        },
        { keys: ["Mod+A"], label: n("shortcut.selectAll") },
      ],
    },
    {
      id: "page",
      entries: [
        { keys: ["/"], label: n("shortcut.insert") },
        { keys: ["Mod+Z", "Shift+Mod+Z"], label: n("shortcut.editUndo") },
      ],
    },
    {
      id: "board",
      entries: [
        ...boardTools.map((tool) => ({
          keys: [tool.key, ...tool.aliases.map((alias) => alias.toUpperCase())]
            .filter((key, index, all) => all.indexOf(key) === index),
          label: { surface: tool.label },
        })),
        { keys: ["Space"], label: n("shortcut.pan") },
        { keys: ["+", "-"], label: n("shortcut.zoom") },
        { keys: ["0"], label: n("shortcut.fit") },
        { keys: ["Arrows"], label: n("shortcut.nudge") },
        { keys: ["Mod+D"], label: n("shortcut.duplicate") },
        { keys: ["Mod+C", "Mod+X"], label: n("shortcut.copyCut") },
        { keys: ["Mod+V"], label: n("shortcut.paste") },
        { keys: ["]", "["], label: n("shortcut.order") },
        { keys: ["Shift+]", "Shift+["], label: n("shortcut.orderEdge") },
        { keys: ["Shift+Mod+G"], label: n("shortcut.ungroup") },
        { keys: ["Shift+Mod+L"], label: n("shortcut.lock") },
      ],
    },
  ];
}
