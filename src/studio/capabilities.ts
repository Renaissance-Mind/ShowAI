import { antigravityWorkbench, isSinglePageWorkbench } from "../browser/codex-workbench";

export function workbenchCapabilities(platform?: string, forceSinglePage = false) {
  const ios =
    platform === "ios" ||
    (typeof document !== "undefined" &&
      document.documentElement.dataset.native === "ios");
  const singlePage = forceSinglePage || isSinglePageWorkbench();
  const workspaceWindows = !ios && !singlePage;
  const embedded =
    typeof window !== "undefined" &&
    (!!window.__SHOWAI_LOCAL__?.dshWorkbench || !!antigravityWorkbench());
  return {
    singlePage,
    tabs: workspaceWindows,
    windows: workspaceWindows,
    revealFiles: !ios,
    exportSite: !ios,
    advancedPageExport: !ios,
    manageLibrary: !ios && !embedded,
    localPlugins: !ios && !embedded,
    externalChanges: !ios,
    componentSource: !ios,
    componentThumbnails: !ios,
    remoteApprovals: !ios && !embedded,
  };
}
