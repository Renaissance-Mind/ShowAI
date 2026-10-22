import { useEffect, useState } from "react";
import type { AppearanceTheme } from "./useAppearanceTheme";

export type AppearancePreference = "system" | AppearanceTheme;
export const APPEARANCE_KEY = "showai:appearance";

/** A missing or unknown saved value follows the system, like a first launch. */
export function readAppearancePreference(
  saved: string | null,
): AppearancePreference {
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemDark: boolean,
): AppearanceTheme {
  return preference === "system"
    ? systemDark
      ? "dark"
      : "light"
    : preference;
}

/** The workbench preference and the theme it resolves to as the system changes. */
export function useAppearancePreference() {
  const [preference, setPreference] = useState<AppearancePreference>(() =>
    readAppearancePreference(localStorage.getItem(APPEARANCE_KEY)),
  );
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const theme = resolveAppearance(preference, systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(APPEARANCE_KEY, preference);
  }, [theme, preference]);
  return { preference, setPreference, theme };
}
