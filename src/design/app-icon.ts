import darkIcon from "../desktop/assets/icon.svg";
import lightIcon from "../desktop/assets/icon-light.svg";
import type { AppearanceTheme } from "./useAppearanceTheme";

// The icon background contrasts with the interface appearance.
export function appIconForTheme(theme: AppearanceTheme) {
  return theme === "dark" ? lightIcon : darkIcon;
}
