import { installIconTooltips } from "./ui/icon-tooltip.mjs";
import { lazy, Suspense, useLayoutEffect } from "react";
import { appIconForTheme } from "./design/app-icon";
import { useAppearanceTheme } from "./design/useAppearanceTheme";
import { useLocale, useTranslator } from "./i18n/react";
import messages from "./i18n/messages/common";
import { registerBuiltinDisplayText } from "./components/component-display";
import { builtinEnglish } from "./components/builtin-display-text";
// Editing hosts show built-in component names in English; readers never need them.
registerBuiltinDisplayText(builtinEnglish);
const CanvasApp = lazy(() => import("./CanvasApp"));
const Studio = lazy(() => import("./studio/Studio"));
const ComponentPreviewPage = lazy(
  () => import("./studio/ComponentPreviewPage"),
);
export default function App() {
  const theme = useAppearanceTheme();
  const locale = useLocale();
  const t = useTranslator(messages);
  useLayoutEffect(() => installIconTooltips(document), []);
  useLayoutEffect(() => {
    const favicon = document.querySelector<HTMLLinkElement>("#showai-favicon");
    if (favicon) favicon.href = appIconForTheme(theme);
    void window.showai?.setAppearance?.(theme).catch((error) => {
      console.error("Couldn't update the desktop icon", error);
    });
  }, [theme]);
  useLayoutEffect(() => {
    void window.showai?.setLocale?.(locale).catch((error) => {
      console.error("Couldn't update the desktop language", error);
    });
  }, [locale]);
  const preview = new URLSearchParams(location.search).has("componentPreview");
  return (
    <Suspense
      fallback={
        <div role="status" className="showai-loading">
          {t("opening")}
        </div>
      }
    >
      {preview ? (
        <ComponentPreviewPage />
      ) : window.showai ? (
        <Studio />
      ) : (
        <CanvasApp />
      )}
    </Suspense>
  );
}
