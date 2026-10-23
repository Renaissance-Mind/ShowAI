import { describe, expect, it } from "vitest";
import {
  formatShortcut,
  isDeleteShortcut,
  isSidebarToggleShortcut,
  shortcutGroups,
} from "./keyboard-shortcuts";
import { boardTools } from "../surface/board-tools";

const key = (
  value: string,
  modifiers: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("keyboard shortcuts", () => {
  it("writes chords the way each platform does", () => {
    expect(formatShortcut("Shift+Mod+Z", true)).toBe("⇧⌘Z");
    expect(formatShortcut("Shift+Mod+Z", false)).toBe("Ctrl+Shift+Z");
    expect(formatShortcut("Mod+\\", true)).toBe("⌘\\");
    expect(formatShortcut("Mod+\\", false)).toBe("Ctrl+\\");
    expect(formatShortcut("Alt+Shift+Left", true)).toBe("⌥⇧←");
    expect(formatShortcut("+", true)).toBe("+");
    expect(formatShortcut("Mod+Click", false, { Click: "Click" })).toBe(
      "Ctrl+Click",
    );
    expect(formatShortcut("F2", true)).toBe("F2");
  });

  it("deletes with Delete everywhere and ⌘⌫ on macOS only", () => {
    expect(isDeleteShortcut(key("Delete"), false)).toBe(true);
    expect(isDeleteShortcut(key("Backspace", { metaKey: true }), true)).toBe(
      true,
    );
    expect(isDeleteShortcut(key("Backspace"), true)).toBe(false);
    expect(isDeleteShortcut(key("Backspace", { ctrlKey: true }), false)).toBe(
      false,
    );
  });

  it("toggles the sidebar with Command or Ctrl and backslash", () => {
    expect(isSidebarToggleShortcut(key("\\", { metaKey: true }))).toBe(true);
    expect(isSidebarToggleShortcut(key("\\", { ctrlKey: true }))).toBe(true);
    expect(
      isSidebarToggleShortcut(key("\\", { ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    expect(isSidebarToggleShortcut(key("\\"))).toBe(false);
  });

  it("lists every board tool and omits tabs where the host has none", () => {
    const groups = shortcutGroups({ mac: true, tabs: false, windows: false });
    expect(groups.map((group) => group.id)).toEqual([
      "general",
      "library",
      "page",
      "board",
    ]);
    const board = groups.find((group) => group.id === "board")!;
    for (const tool of boardTools)
      expect(
        board.entries.some(
          (entry) =>
            "surface" in entry.label &&
            entry.label.surface === tool.label &&
            entry.keys.includes(tool.key),
        ),
      ).toBe(true);
    expect(
      shortcutGroups({ mac: false, tabs: true, windows: true }).map(
        (group) => group.id,
      ),
    ).toContain("tabs");
  });

  it("leaves out shortcuts the browser keeps for itself", () => {
    const keys = shortcutGroups({
      mac: true,
      tabs: true,
      windows: true,
      browser: true,
    }).flatMap((group) => group.entries.flatMap((entry) => entry.keys));
    for (const key of ["Mod+N", "Mod+T", "Mod+W", "Ctrl+Tab"])
      expect(keys).not.toContain(key);
    expect(keys).toContain("Mod+K");
    expect(keys).toContain("Alt+Shift+Left");
  });
});
