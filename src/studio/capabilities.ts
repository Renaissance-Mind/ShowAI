/** Native iOS exposes the shared editor, but not the desktop filesystem/runtime. */
export function workbenchCapabilities(platform?: string) {
  const ios =
    platform === "ios" ||
    (typeof document !== "undefined" &&
      document.documentElement.dataset.native === "ios");
  return {
    tabs: !ios,
    windows: !ios,
    revealFiles: !ios,
    exportSite: !ios,
    advancedPageExport: !ios,
    manageLibrary: !ios,
    localPlugins: !ios,
    externalChanges: !ios,
    componentSource: !ios,
    componentThumbnails: !ios,
  };
}
