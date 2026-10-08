import { installIconTooltips } from "./ui/icon-tooltip.mjs";
import { lazy, Suspense, useLayoutEffect } from "react";
import { appIconForTheme } from "./design/app-icon";
import { useAppearanceTheme } from "./design/useAppearanceTheme";
const CanvasApp = lazy(() => import("./CanvasApp"));
const Studio = lazy(() => import("./studio/Studio"));
const ComponentPreviewPage = lazy(
  () => import("./studio/ComponentPreviewPage"),
);
export default function App() {
  const theme = useAppearanceTheme();
  useLayoutEffect(() => installIconTooltips(document), []);
  useLayoutEffect(() => {
    const favicon = document.querySelector<HTMLLinkElement>("#showai-favicon");
    if (favicon) favicon.href = appIconForTheme(theme);
    void window.showai?.setAppearance?.(theme).catch((error) => {
      console.error("无法更新桌面图标", error);
    });
  }, [theme]);
  const preview = new URLSearchParams(location.search).has("componentPreview");
  return (
    <Suspense
      fallback={
        <div role="status" className="showai-loading">
          正在打开…
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
