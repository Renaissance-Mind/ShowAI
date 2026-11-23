import { useLayoutEffect, useRef, useState } from "react";
import { sidebarTones as palette } from "../design/sidebar-palette";

type RootTones = Record<string, string>;

export function assignSidebarRootTones(
  ids: string[],
  saved: RootTones,
): RootTones {
  const uses = new Map(palette.map((tone) => [tone, 0]));
  for (const id of ids) {
    const tone = saved[id];
    if (uses.has(tone)) uses.set(tone, uses.get(tone)! + 1);
  }
  let tones = saved;
  for (const [index, id] of ids.entries()) {
    if (uses.has(tones[id])) continue;
    const candidates = palette.filter(
      (tone) =>
        tone !== tones[ids[index - 1]] && tone !== tones[ids[index + 1]],
    );
    const minimum = Math.min(...candidates.map((tone) => uses.get(tone)!));
    const available = candidates.filter((tone) => uses.get(tone) === minimum);
    const choice = available[Math.floor(Math.random() * available.length)];
    if (tones === saved) tones = { ...saved };
    tones[id] = choice;
    uses.set(choice, uses.get(choice)! + 1);
  }
  return tones;
}

function readRootTones(key: string, fallback: RootTones): RootTones {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (value && typeof value === "object" && !Array.isArray(value))
      return value;
  } catch (error) {
    console.warn("Could not read sidebar folder colors", error);
  }
  return fallback;
}

export function useSidebarRootTones(scope: string | undefined, ids: string[]) {
  const [tones, setTones] = useState<RootTones>({});
  const last = useRef<{ scope: string; tones: RootTones } | null>(null);
  useLayoutEffect(() => {
    if (!scope) return;
    const key = `showai:sidebar-root-tones:v1:${scope}`;
    const refresh = () => {
      const saved = readRootTones(
        key,
        last.current?.scope === scope ? last.current.tones : {},
      );
      const next = assignSidebarRootTones(ids, saved);
      if (next !== saved) {
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch (error) {
          console.warn("Could not save sidebar folder colors", error);
        }
      }
      last.current = { scope, tones: next };
      setTones(next);
    };
    refresh();
    const sync = (event: StorageEvent) => {
      if (event.key === key) refresh();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [scope, ids]);
  return tones;
}
