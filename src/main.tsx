import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { installBrowserBridge } from "./browser/bridge";
import { initLanguagePreference } from "./i18n";
import "./styles.css";
import "./design/desktop.css";

initLanguagePreference();
installBrowserBridge();

const startUiLab =
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("uiLabSession")
    ? await (await import("./ui-lab/bootstrap")).prepareUiLab()
    : undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
void startUiLab?.();
