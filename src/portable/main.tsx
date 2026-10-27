import { mountReader } from "./reader-app";

// The inline exporter rewrites these element lookups and the theme target to
// the fragment's own ids, so keep them as literal expressions in this entry.
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
