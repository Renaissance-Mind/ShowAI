import { antigravityWorkbench, codexWorkbench, isSinglePageWorkbench } from "../browser/codex-workbench";

export function workbenchCapabilities(platform?: string, forceSinglePage = false) {
  const ios =
    platform === "ios" ||
    (typeof document !== "undefined" &&
      document.documentElement.dataset.native === "ios");
  const singlePage = forceSinglePage || isSinglePageWorkbench();
  const workspaceWindows = !ios && !singlePage;
  const remote = typeof window !== "undefined" && codexWorkbench()?.remote === true;
  const embedded =
    typeof window !== "undefined" &&
    (!!window.__SHOWAI_LOCAL__?.dshWorkbench || !!antigravityWorkbench());
  return {
    remote,
    singlePage,
    tabs: workspaceWindows,
    windows: workspaceWindows,
    revealFiles: !ios && !remote,
    exportSite: !ios && !remote,
    advancedPageExport: !ios && !remote,
    manageLibrary: !ios && !embedded && !remote,
    localPlugins: !ios && !embedded && !remote,
    externalChanges: !ios && !remote,
    componentSource: !ios && !remote,
    componentThumbnails: !ios && !remote,
    remoteApprovals: !ios && !embedded && !remote,
  };
}
