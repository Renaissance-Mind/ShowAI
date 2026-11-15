import { mountReader } from "./reader-app";

const root = window.document.getElementById("root")!;
mountReader(root, {
  inlineHost: root.closest<HTMLElement>("[data-showai-inline-root]"),
  readArtifact: () =>
    window.document.getElementById("showai-data")?.textContent,
  readOptions: () =>
    window.document.getElementById("showai-read-options")?.textContent,
  readSite: () => window.document.getElementById("showai-site")?.textContent,
  setTheme: (theme) => {
    window.document.documentElement.dataset.theme = theme;
  },
});
