import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installBrowserBridge } from "./browser/bridge";
import { initLanguagePreference } from "./i18n";
import "./styles.css";
import "./design/desktop.css";

initLanguagePreference();
installBrowserBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
