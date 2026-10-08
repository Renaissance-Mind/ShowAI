import type { LibraryTarget } from "./LibraryNavigation";
import type { WorkspaceEntry } from "./workspace-tabs";

export type OpenDisposition = "current" | "tab" | "foreground-tab" | "window";

export function clickDisposition(
  input: {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  mac: boolean,
): OpenDisposition {
  if (input.altKey) return "current";
  if (input.button === 1 || (mac ? input.metaKey : input.ctrlKey))
    return input.shiftKey ? "foreground-tab" : "tab";
  return input.shiftKey ? "window" : "current";
}

export function libraryEntry(target: LibraryTarget): WorkspaceEntry {
  return {
    location: {
      view: target.kind === "page" ? "page" : "project",
      projectId: target.projectId,
      folderId: target.kind === "folder" ? target.id : target.parentId,
      pageId: target.kind === "page" ? target.id : null,
    },
    title: target.title,
    icon: target.icon,
    scrollTop: 0,
  };
}
