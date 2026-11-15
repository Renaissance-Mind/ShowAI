import { useCallback, useEffect, useRef, useState } from "react";
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
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  const key = /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : event.code?.startsWith("Key")
      ? event.code.slice(3).toLowerCase()
      : "";
  if (key === "f" && !event.shiftKey) return event.altKey ? "replace" : "open";
  if (key === "g" && !event.altKey) return event.shiftKey ? "previous" : "next";
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
