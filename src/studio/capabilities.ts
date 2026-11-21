export function workbenchCapabilities(platform?: string, singlePage = false) {
  const ios =
    platform === "ios" ||
    (typeof document !== "undefined" &&
      document.documentElement.dataset.native === "ios");
  const workspaceWindows = !ios && !singlePage;
  const harness = typeof window !== "undefined" && !!window.__SHOWAI_LOCAL__?.dshWorkbench;
  return {
    tabs: workspaceWindows,
    windows: workspaceWindows,
    revealFiles: !ios,
    exportSite: !ios,
    advancedPageExport: !ios,
    manageLibrary: !ios && !harness,
    localPlugins: !ios && !harness,
    externalChanges: !ios,
    componentSource: !ios,
    componentThumbnails: !ios,
    remoteApprovals: !ios && !harness,
  };
}
