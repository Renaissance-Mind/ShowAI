import CanvasApp from "./CanvasApp";
import Studio from "./studio/Studio";
import ComponentPreviewPage from "./studio/ComponentPreviewPage";

export default function App() {
  if (new URLSearchParams(location.search).has("componentPreview"))
    return <ComponentPreviewPage />;
  return window.showai ? <Studio /> : <CanvasApp />;
}
