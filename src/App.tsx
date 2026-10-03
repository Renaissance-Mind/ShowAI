import CanvasApp from "./CanvasApp";
import Studio from "./studio/Studio";

export default function App() {
  return window.showai ? <Studio /> : <CanvasApp />;
}
