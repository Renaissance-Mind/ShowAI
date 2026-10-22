import { installIconTooltips } from "./ui/icon-tooltip.mjs";
import { installKeyboardFocus } from "./ui/keyboard-focus";
import { lazy, Suspense, useLayoutEffect } from "react";
import { appIconForTheme } from "./design/app-icon";
import { useAppearanceTheme } from "./design/useAppearanceTheme";
import { useLocale, useTranslator } from "./i18n/react";
import messages from "./i18n/messages/common";
import { registerBuiltinDisplayText } from "./components/component-display";
import { builtinEnglish } from "./components/builtin-display-text";
import { ConnectionBanner } from "./ConnectionBanner";
// Editing hosts show built-in component names in English; readers never need them.
registerBuiltinDisplayText(builtinEnglish);
const CanvasApp = lazy(() => import("./CanvasApp"));
const Studio = lazy(() => import("./studio/Studio"));
const ComponentPreviewPage = lazy(
  () => import("./studio/ComponentPreviewPage"),
);
const PagePreviewPage = lazy(() => import("./studio/PagePreviewPage"));
export default function App() {
  const params = new URLSearchParams(location.search);
  const capture = params.has("componentPreview") || params.has("pagePreview");
  const theme = useAppearanceTheme();
  const locale = useLocale();
  const t = useTranslator(messages);
  useLayoutEffect(() => installIconTooltips(document), []);
  useLayoutEffect(() => installKeyboardFocus(document), []);
  useLayoutEffect(() => {
    if (capture) return;
    const favicon = document.querySelector<HTMLLinkElement>("#showai-favicon");
    if (favicon) favicon.href = appIconForTheme(theme);
    void window.showai?.setAppearance?.(theme).catch((error) => {
      console.error("Couldn't update the desktop icon", error);
    });
  }, [theme, capture]);
  useLayoutEffect(() => {
    if (capture) return;
    void window.showai?.setLocale?.(locale).catch((error) => {
      console.error("Couldn't update the desktop language", error);
    });
  }, [locale, capture]);
  const preview = new URLSearchParams(location.search).has("componentPreview");
  const pagePreview = new URLSearchParams(location.search).has("pagePreview");
  return (
    <Suspense
      fallback={
        <div role="status" className="showai-loading">
          <span className="showai-text-shimmer">{t("opening")}</span>
        </div>
      }
    >
      {pagePreview ? (
        <PagePreviewPage />
      ) : preview ? (
        <ComponentPreviewPage />
      ) : window.showai ? (
        <>
          {window.__SHOWAI_LOCAL__ && <ConnectionBanner />}
          <Studio />
        </>
      ) : (
        <CanvasApp />
      )}
    </Suspense>
  );
}
