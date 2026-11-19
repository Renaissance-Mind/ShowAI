export function workbenchCapabilities(platform?: string, singlePage = false) {
  const ios =
    platform === "ios" ||
    (typeof document !== "undefined" &&
      document.documentElement.dataset.native === "ios");
  const workspaceWindows = !ios && !singlePage;
  return {
    tabs: workspaceWindows,
    windows: workspaceWindows,
    revealFiles: !ios,
    exportSite: !ios,
    advancedPageExport: !ios,
    manageLibrary: !ios,
    localPlugins: !ios,
    externalChanges: !ios,
    componentSource: !ios,
    componentThumbnails: !ios,
    remoteApprovals: !ios,
  };
}
