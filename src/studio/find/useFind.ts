import { useCallback, useEffect, useRef, useState } from "react";
import {
  matchesChord,
  readCustomShortcuts,
  shortcutSlotKey,
} from "../../surface/shortcut-matcher";
import type { FindCommand, FindRequest } from "./FindBar";

export function findShortcut(
  event: {
    key: string;
    code?: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
  mac: boolean,
): FindCommand | null {
  const overrides = readCustomShortcuts();
  const customSlots: [string, FindCommand][] = [
    [shortcutSlotKey("page.find", 0), "open"],
    [shortcutSlotKey("page.findReplace", 0), "replace"],
    [shortcutSlotKey("page.findStep", 0), "next"],
    [shortcutSlotKey("page.findStep", 1), "previous"],
  ];
  for (const [slot, cmd] of customSlots) {
    const chord = overrides[slot];
    if (chord && matchesChord(event, chord, mac)) return cmd;
  }
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  const key = /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : event.code?.startsWith("Key")
      ? event.code.slice(3).toLowerCase()
      : "";
  if (key === "f" && !event.shiftKey) {
    const cmd: FindCommand = event.altKey ? "replace" : "open";
    const slot = shortcutSlotKey(
      cmd === "replace" ? "page.findReplace" : "page.find",
      0,
    );
    return slot in overrides ? null : cmd;
  }
  if (key === "g" && !event.altKey) {
    const cmd: FindCommand = event.shiftKey ? "previous" : "next";
    const slot = shortcutSlotKey("page.findStep", cmd === "previous" ? 1 : 0);
    return slot in overrides ? null : cmd;
  }
  return null;
}

export function useFind(options: {
  available: () => boolean;
  mac: boolean;
}) {
  const [request, setRequest] = useState<FindRequest | null>(null);
  const counter = useRef(0);
  const latest = useRef(options);
  latest.current = options;
  const run = useCallback((command: FindCommand) => {
    if (!latest.current.available()) return false;
    setRequest((current) => ({
      command: current || command === "open" || command === "replace" ? command : "open",
      id: ++counter.current,
    }));
    return true;
  }, []);
  const close = useCallback(() => setRequest(null), []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const command = findShortcut(event, latest.current.mac);
      if (command && run(command)) event.preventDefault();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [run]);
  return { request, run, close };
}
