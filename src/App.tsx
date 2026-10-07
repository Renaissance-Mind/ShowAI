import { useLayoutEffect } from "react";
import { installIconTooltips } from "./ui/icon-tooltip.mjs";
import CanvasApp from "./CanvasApp";
import Studio from "./studio/Studio";
import ComponentPreviewPage from "./studio/ComponentPreviewPage";

export default function App() {
  useLayoutEffect(() => installIconTooltips(document), []);
  if (new URLSearchParams(location.search).has("componentPreview"))
    return <ComponentPreviewPage />;
  return window.showai ? <Studio /> : <CanvasApp />;
}
