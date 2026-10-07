import { installIconTooltips } from "./ui/icon-tooltip.mjs";
import { lazy, Suspense, useLayoutEffect } from "react";
const CanvasApp = lazy(() => import("./CanvasApp"));
const Studio = lazy(() => import("./studio/Studio"));
const ComponentPreviewPage = lazy(
  () => import("./studio/ComponentPreviewPage"),
);
export default function App() {
  useLayoutEffect(() => installIconTooltips(document), []);
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
