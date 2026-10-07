import { relative, sep } from "node:path";
import type { DesktopChange } from "../desktop/bridge";

/** Preserve resource identity through the file watcher debounce. */
export function changedResources(
  home: string,
  paths: Iterable<string>,
): DesktopChange {
  const projectIds = new Set<string>(),
    pageIds = new Set<string>();
  let allPages = false;
  let catalog = false,
    projects = false,
    sidebar = false,
    unknown = false;
  for (const path of paths) {
    const local = relative(home, path)
      .split(sep)
      .join("/")
      .replace(/^workspace\//, "");
    const project = local.match(/^projects\/([^/]+)(?:\/|$)/);
    if (project) {
      projectIds.add(project[1]);
      projects = true;
    }
    const page = local.match(/^projects\/[^/]+\/pages\/([^/.]+)(?:\.json$|\/)/);
    if (page) pageIds.add(page[1]);
    else if (/^projects\/[^/]+\/pages(?:\/|$)/.test(local)) allPages = true;
    if (/(?:^|\/)packages\//.test(local)) catalog = true;
    if (local === "sidebar.json") sidebar = true;
    if (!project && !catalog && !sidebar) unknown = true;
  }
  return {
    type: "files",
    home,
    projectIds: [...projectIds],
    pageIds: [...pageIds],
    catalog,
    allPages,
    projects,
    sidebar,
    ...(unknown ? { all: true } : {}),
  };
}
