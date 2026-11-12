import { useMemo } from "react";
import type { CompiledComponent } from "../../contract/types";
import type {
  CatalogComponent,
  CatalogCustomComponent,
} from "../../core/component-categories";
import { desktop } from "../../host/bridge";
import { useCatalogManager } from "../CatalogManagement";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { CatalogState } from "./useCatalogState";
import type { DialogControl } from "./useDialogState";
import type { StudioRouter } from "./useStudioRouter";
import type { DialogState, LoadedTemplate, PageState } from "./types";

/** Opening components and templates in their dialogs, and managing them. */
export function useCatalogActions({
  library: { capabilities, projects },
  route: { view, selectedProject },
  catalog: { componentProject, componentProjectRef, loadCatalog },
  dialogs: { setDialog, dialogRef, closeDialog },
  router: { saveOpenPage, openPage },
  page,
}: {
  library: Pick<LibraryState, "capabilities" | "projects">;
  route: Pick<RouteState, "view" | "selectedProject">;
  catalog: Pick<
    CatalogState,
    "componentProject" | "componentProjectRef" | "loadCatalog"
  >;
  dialogs: Pick<DialogControl, "setDialog" | "dialogRef" | "closeDialog">;
  router: Pick<StudioRouter, "saveOpenPage" | "openPage">;
  page: PageState;
}) {
  async function viewComponent(
    item: CatalogComponent,
    expectedDialog?: Exclude<DialogState, null>,
  ) {
    const owner =
      !("kind" in item) && item.projectId
        ? item.projectId
        : componentProjectRef.current !== "all"
          ? componentProjectRef.current
          : undefined;
    if ("kind" in item) {
      setDialog({ type: "component", builtin: item, projectId: owner });
      return;
    }
    const custom = await desktop.invoke<CompiledComponent>("components:get", {
      id: item.id,
      version: item.version,
      scope: item.scope,
      integrity: item.integrity,
      ...(owner ? { projectId: owner } : {}),
    });
    if (!expectedDialog || dialogRef.current === expectedDialog)
      setDialog({ type: "component", custom, projectId: owner });
  }

  const catalogManager = useCatalogManager(capabilities.manageLibrary, {
    projects,
    projectId:
      (view === "components"
        ? componentProject !== "all"
          ? componentProject
          : null
        : selectedProject) ?? undefined,
    openPage:
      page.draft && page.projectId
        ? { projectId: page.projectId, pageId: page.draft.id }
        : undefined,
    flushPage: saveOpenPage,
    changed: loadCatalog,
    async openRevision(kind, item) {
      if (kind === "component") {
        await viewComponent(item as CatalogCustomComponent);
        return;
      }
      const projectId = item.projectId ?? selectedProject ?? undefined;
      const record = await desktop.invoke<LoadedTemplate>("templates:get", {
        id: item.id,
        version: item.version,
        scope: item.scope,
        integrity: item.integrity,
        ...(projectId ? { projectId } : {}),
      });
      setDialog({ type: "template", record, projectId });
    },
    async showPage(projectId, pageId) {
      setDialog(null);
      await openPage(pageId, projectId);
    },
    closeDetail: closeDialog,
  });
  const pickerLibrary = useMemo(
    () => ({
      list: () =>
        desktop.invoke<CatalogComponent[]>("components:list", {
          projectId: selectedProject ?? undefined,
          scope: "all",
        }),
      read: (item: CatalogCustomComponent) =>
        desktop.invoke<CompiledComponent>("components:get", {
          id: item.id,
          version: item.version,
          integrity: item.integrity,
          scope: item.scope,
          projectId: selectedProject ?? undefined,
        }),
    }),
    [selectedProject],
  );
  return { viewComponent, catalogManager, pickerLibrary };
}

export type CatalogActions = ReturnType<typeof useCatalogActions>;
