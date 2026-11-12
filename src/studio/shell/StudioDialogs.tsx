import {
  ArrowUpRight,
  FileText,
  LayoutTemplate,
  Presentation,
} from "../../ui/icons";
import type {
  FolderMetadata,
  ProjectSummary,
  SidebarOrganization,
} from "../../core/model";
import type { DesktopInfo } from "../../host/protocol";
import type { CompiledComponent, ComponentSource } from "../../contract/types";
import { desktop } from "../../host/bridge";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import navigationMessages from "../../i18n/messages/navigation";
import studioMessages from "../../i18n/messages/studio";
import Dialog from "../../ui/Dialog";
import PageIconDialog from "../../components/PageIconDialog";
import MergeDialog from "../MergeDialog";
import ImportDialog from "../ImportDialog";
import { PackagingDialog } from "../PackagingDialog";
import { BatchPagesDialog } from "../DirectoryPageSelection";
import {
  DeletedItemsDialog,
  HiddenProjectsDialog,
  ShortcutsDialog,
} from "../LibraryNavigationDialogs";
import { DiscardDraftDialog } from "../SaveProblem";
import {
  ExternalConflictDialog,
  WorkspaceConflictsDialog,
} from "../RecoveryDialogs";
import LibraryMigrationDialog from "../LibraryMigrationDialog";
import QuickJump from "../quick-jump/QuickJump";
import { TemplateDialog, ComponentDialog } from "../CatalogDialogs";
import {
  latestTemplateVersions,
  templateHasPage,
} from "../template-catalog-model";
import { withCreatedFolder, withLibraryEntry } from "../navigation-refresh";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { CatalogState } from "./useCatalogState";
import type { CatalogActions } from "./useCatalogActions";
import type { DialogControl } from "./useDialogState";
import type { StudioRouter } from "./useStudioRouter";
import type { PageActions } from "./usePageActions";
import type { LibraryEdits } from "./useLibraryEdits";
import type { LibraryMoves } from "./useLibraryMoves";
import type { StudioCommands } from "./commands";
import {
  DeleteDialog,
  FolderDialog,
  MoveProjectDialog,
  NameDialog,
  ProjectDialog,
} from "./LibraryDialogs";
import { operation, type LoadedTemplate, type PageState } from "./types";

/** The open workbench dialog, with the import and export dialogs that run beside it. */
export function StudioDialogs({
  feedback: { setNotice, report },
  library: {
    info,
    setInfo,
    capabilities,
    projects,
    organization,
    contents,
    setContents,
    setExpandedFolders,
    refresh,
    refreshProjects,
    projectTarget,
  },
  route: { view, selectedProject, selectedFolder, editorControls },
  catalog: { componentProject, loadCatalog },
  catalogActions: { catalogManager },
  dialogs: { dialog, setDialog, closeDialog },
  router: { settleOpenPage, openProject, openPage },
  pageActions: {
    importPlan,
    setImportPlan,
    importFinished,
    packagingDecision,
    busy,
    createPage,
    runCreation,
    addBlock,
  },
  edits: { moveProject, updateTarget, deleteTarget },
  moves: { applyBatchPages },
  commands: { quickJumpCommands },
  page,
  deferConflict,
  contentCreationDisabled,
}: {
  feedback: StudioFeedback;
  library: LibraryState;
  route: RouteState;
  catalog: CatalogState;
  catalogActions: CatalogActions;
  dialogs: DialogControl;
  router: StudioRouter;
  pageActions: PageActions;
  edits: LibraryEdits;
  moves: LibraryMoves;
  commands: StudioCommands;
  page: PageState;
  deferConflict: () => void;
  contentCreationDisabled: boolean;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const tn = useTranslator(navigationMessages);
  /** Page templates create a page here; workflow templates hand a prompt to an agent. */
  function templateDialogActions(record: LoadedTemplate, owner?: string) {
    const projectId =
      owner ??
      selectedProject ??
      (componentProject !== "all" ? componentProject : null);
    return {
      ...(templateHasPage(record)
        ? {
            createUnavailable: !projectId || contentCreationDisabled,
            onCreatePage: async () => {
              if (!projectId) return;
              await createPage(record.id, record, undefined, {
                projectId,
                parentId: projectId === selectedProject ? selectedFolder : null,
              });
            },
          }
        : {}),
      onCopyPrompt: (prompt: string) =>
        desktop.invoke<void>("clipboard:write", { text: prompt }),
    };
  }
  return (
    <>
      {importPlan && (
        <ImportDialog
          plan={importPlan.plan}
          destination={importPlan.destination}
          onFinished={importFinished}
          onOpen={(pageId) => {
            const target = importPlan.plan.target.projectId;
            setImportPlan(null);
            void openPage(pageId, target).catch(report);
          }}
          onClose={() => setImportPlan(null)}
        />
      )}
      {packagingDecision && (
        <PackagingDialog
          plan={packagingDecision.plan}
          purpose="export"
          onDecide={packagingDecision.decide}
        />
      )}
      {dialog?.type === "pageIcon" && (
        <PageIconDialog
          value={dialog.value}
          onClose={closeDialog}
          onSave={async (icon) => {
            const retained = page.sessions.sessionFor(
              dialog.target.projectId,
              dialog.target.id,
            );
            if (retained) {
              retained.edit({ icon });
              if (!(await retained.flush()))
                throw new Error(t("iconKeptInDraft"));
            } else {
              const { target } = dialog;
              const before = target.icon ?? "";
              setContents((current) =>
                withLibraryEntry(
                  current,
                  { ...target, kind: "page" },
                  { icon },
                ),
              );
              closeDialog();
              try {
                await desktop.invoke("pages:save", {
                  projectId: target.projectId,
                  pageId: target.id,
                  baseHash: dialog.record.hash,
                  baseRevision: dialog.record.revision,
                  document: { ...dialog.record.document, icon },
                });
              } catch (reason) {
                setContents((current) =>
                  withLibraryEntry(
                    current,
                    { ...target, kind: "page" },
                    { icon: before },
                  ),
                );
                report(reason, {
                  action: operation("op.setIcon"),
                  object: target.title,
                });
                return;
              }
            }
            await refreshProjects([dialog.target.projectId]);
          }}
        />
      )}
      {dialog?.type === "migration" && info && (
        <LibraryMigrationDialog
          home={info.home}
          beforePrepare={page.flush}
          onClose={closeDialog}
          onActivated={async () => {
            setInfo(await desktop.invoke<DesktopInfo>("app:info"));
            await page.reload();
            await refresh();
            await loadCatalog();
            setNotice(t("libraryUpgraded"));
          }}
        />
      )}
      {dialog?.type === "merge" && (
        <MergeDialog
          {...dialog}
          pageId={dialog.document.id}
          onClose={closeDialog}
          onDismiss={deferConflict}
          onEdit={page.prepareResolution}
          onDiscard={page.acceptResolution}
          onMerged={async () => {
            await page.acceptResolution();
            await refreshProjects([dialog.projectId]);
            setNotice(t("mergeSaved"));
          }}
        />
      )}
      {dialog?.type === "externalConflict" && (
        <ExternalConflictDialog
          id={dialog.id}
          saveFailure={dialog.saveFailure}
          draftDocument={
            dialog.saveFailure ? (page.draft ?? undefined) : undefined
          }
          onEdit={(document) =>
            page.prepareExternalResolution(document, dialog.id)
          }
          projectId={selectedProject ?? undefined}
          onPackageRecovered={async (result) => {
            await refresh();
            const ref = result.package,
              target = result.draft.projectId;
            if (ref.kind === "component") {
              const custom = await desktop.invoke<CompiledComponent>(
                "components:get",
                {
                  id: ref.id,
                  version: ref.version,
                  scope: ref.scope,
                  projectId: ref.projectId,
                },
              );
              setDialog({ type: "component", custom, projectId: target });
            } else {
              const record = await desktop.invoke<LoadedTemplate>(
                "templates:get",
                {
                  id: ref.id,
                  version: ref.version,
                  scope: ref.scope,
                  projectId: ref.projectId,
                },
              );
              setDialog({ type: "template", record, projectId: target });
            }
            setNotice(t("externalKeptAsDraft"), { kind: "warning" });
          }}
          onClose={closeDialog}
          onDismiss={deferConflict}
          onResolved={async () => {
            await page.acceptResolution();
            await refresh();
            setNotice(t("externalResolved"));
          }}
        />
      )}
      {capabilities.externalChanges &&
        dialog?.type === "workspaceConflicts" && (
          <WorkspaceConflictsDialog
            projectId={selectedProject}
            onClose={closeDialog}
            onSelect={(id) => setDialog({ type: "externalConflict", id })}
          />
        )}
      {dialog?.type === "group" && (
        <NameDialog
          title={dialog.group ? t("renameGroup") : t("newGroup")}
          inputLabel={t("groupName")}
          initialValue={dialog.group?.name}
          onClose={closeDialog}
          onSave={async (name) => {
            const sidebar = await desktop.invoke<SidebarOrganization>(
              dialog.group ? "groups:rename" : "groups:create",
              {
                name,
                ...(dialog.group ? { groupId: dialog.group.id } : {}),
              },
            );
            if (dialog.projectId)
              await moveProject(dialog.projectId, sidebar.groups.at(-1)!.id);
            await refreshProjects([], { sidebar: true });
            setDialog(null);
          }}
        />
      )}
      {dialog?.type === "moveProject" && (
        <MoveProjectDialog
          groups={organization.groups}
          currentGroup={organization.projectGroups[dialog.projectId] ?? ""}
          onClose={closeDialog}
          onCreate={() =>
            setDialog({ type: "group", projectId: dialog.projectId })
          }
          onSave={async (groupId) => {
            await moveProject(dialog.projectId, groupId);
            setDialog(null);
          }}
        />
      )}
      {dialog?.type === "folder" && (
        <FolderDialog
          folder={dialog.target}
          onClose={closeDialog}
          onSave={async (name, icon) => {
            if (dialog.target) {
              await updateTarget(
                dialog.target,
                { name, icon },
                { close: closeDialog },
              );
              return;
            }
            await settleOpenPage();
            const folder = await desktop.invoke<FolderMetadata>(
              "folders:create",
              {
                projectId: dialog.projectId,
                parentId: dialog.parentId,
                name,
                ...(icon ? { icon } : {}),
              },
            );
            setContents((current) =>
              withCreatedFolder(current, dialog.projectId, folder),
            );
            setExpandedFolders((current) => ({
              ...current,
              ...(dialog.parentId ? { [dialog.parentId]: true } : {}),
            }));
            setDialog(null);
            await openProject(dialog.projectId, folder.id);
            await refreshProjects([dialog.projectId]);
          }}
        />
      )}
      {dialog?.type === "rename" && (
        <NameDialog
          title={tc("rename")}
          inputLabel={t("name")}
          initialValue={dialog.target.title}
          onClose={closeDialog}
          onSave={async (name) => {
            await updateTarget(dialog.target, { name }, { close: closeDialog });
          }}
        />
      )}
      {dialog?.type === "batchPages" && (
        <BatchPagesDialog
          operation={dialog.operation}
          targets={dialog.targets}
          projects={projects}
          onClose={closeDialog}
          onApply={applyBatchPages}
        />
      )}
      {dialog?.type === "deletedItems" && (
        <DeletedItemsDialog
          onClose={closeDialog}
          onRestored={async (target) => {
            await refreshProjects([target.projectId], { sidebar: true });
            setNotice(tn("restoredNamed", { title: target.title }));
          }}
          onPurged={async (targets) => {
            await refreshProjects(
              [...new Set(targets.map((target) => target.projectId))],
              { sidebar: true },
            );
            setNotice(
              targets.length === 1
                ? tn("purgedNamed", { title: targets[0].title })
                : tn("purgedCount", { count: targets.length }),
            );
          }}
        />
      )}
      {dialog?.type === "hiddenProjects" && (
        <HiddenProjectsDialog
          onClose={closeDialog}
          onShown={async (shown) => {
            await refresh();
            setNotice(tn("shownNamed", { name: shown.name }));
          }}
        />
      )}
      {dialog?.type === "quickJump" && (
        <QuickJump
          projects={projects}
          pages={contents}
          commands={quickJumpCommands()}
          editor={
            view === "page" &&
            page.draft &&
            editorControls?.documentId === page.draft.id
              ? editorControls
              : undefined
          }
          openDirectory={openProject}
          onClose={closeDialog}
          onError={report}
        />
      )}
      {dialog?.type === "shortcuts" && (
        <ShortcutsDialog
          browser={info?.mode === "browser"}
          tabs={capabilities.tabs}
          windows={capabilities.windows}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === "discardDraft" && (
        <DiscardDraftDialog
          editedAt={page.draft?.updatedAt}
          onClose={closeDialog}
          onConfirm={page.acceptResolution}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteDialog
          target={dialog.target}
          onClose={closeDialog}
          onDelete={async () => {
            await deleteTarget(dialog.target, { close: closeDialog });
          }}
        />
      )}
      {dialog?.type === "project" && (
        <ProjectDialog
          project={dialog.project}
          onClose={closeDialog}
          onSave={async (name, icon) => {
            if (dialog.project) {
              await updateTarget(
                projectTarget(dialog.project),
                { name, icon },
                { close: closeDialog },
              );
              return;
            }
            const result = await desktop.invoke<ProjectSummary>(
              "projects:create",
              { name, icon },
            );
            setDialog(null);
            if (dialog.groupId) await moveProject(result.id, dialog.groupId);
            // The creation receipt is not a navigation summary (no dates or
            // pages), so the sidebar gets the project from a scoped refresh.
            await refreshProjects([result.id], { sidebar: true });
            await openProject(result.id);
            if (dialog.then)
              await runCreation(dialog.then, {
                projectId: result.id,
                parentId: null,
              });
          }}
        />
      )}
      {dialog?.type === "newPage" && (
        <Dialog title={t("newPage")} onClose={closeDialog}>
          <div className="studio-template-picker">
            <button
              disabled={busy}
              aria-label={t("newPageAria")}
              onClick={() =>
                void createPage("blank", undefined, "page", undefined, true)
              }
            >
              <span>
                <FileText size={21} />
              </span>
              <div>
                <strong>{t("blankPage")}</strong>
              </div>
              <ArrowUpRight size={16} />
            </button>
            <button
              aria-label={t("newBoardAria")}
              disabled={busy}
              onClick={() =>
                void createPage("blank", undefined, "board", undefined, true)
              }
            >
              <span>
                <Presentation size={21} />
              </span>
              <div>
                <strong>{t("blankBoard")}</strong>
              </div>
              <ArrowUpRight size={16} />
            </button>
            {latestTemplateVersions(dialog.templates)
              .filter((item) => item.id !== "blank" && templateHasPage(item))
              .map((item) => (
                <button
                  key={`${item.scope}:${item.id}:${item.version}:${item.integrity}`}
                  disabled={busy}
                  onClick={() => void createPage(item.id, item)}
                >
                  <span>
                    {item.id === "blank" ? (
                      <FileText size={21} />
                    ) : (
                      <LayoutTemplate size={21} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {item.id === "blank" ? t("blankPage") : item.name}
                    </strong>
                    <p>{item.description}</p>
                  </div>
                  <ArrowUpRight size={16} />
                </button>
              ))}
          </div>
        </Dialog>
      )}
      {dialog?.type === "template" && (
        <TemplateDialog
          key={`${dialog.record.id}:${dialog.record.version}:${dialog.record.scope}:${dialog.record.integrity}`}
          record={dialog.record}
          components={dialog.record.components ?? []}
          onClose={closeDialog}
          {...templateDialogActions(dialog.record, dialog.projectId)}
          manager={catalogManager}
          owner={dialog.projectId ?? selectedProject ?? undefined}
        />
      )}
      {dialog?.type === "component" && (
        <ComponentDialog
          key={
            dialog.custom
              ? `${dialog.custom.id}@${dialog.custom.version}:${dialog.custom.scope}:${dialog.custom.integrity}`
              : dialog.builtin?.kind
          }
          builtin={dialog.builtin}
          custom={dialog.custom}
          loadSource={
            capabilities.componentSource
              ? () =>
                  desktop.invoke<ComponentSource>(
                    "components:source",
                    dialog.builtin
                      ? { scope: "builtin", id: dialog.builtin.kind }
                      : {
                          id: dialog.custom!.id,
                          version: dialog.custom!.version,
                          scope: dialog.custom!.scope,
                          integrity: dialog.custom!.integrity,
                          projectId: dialog.projectId,
                        },
                  )
              : undefined
          }
          canInsert={
            dialog.custom?.role !== "page-outline" &&
            !!page.draft &&
            page.projectId === selectedProject &&
            (dialog.custom?.scope !== "project" ||
              page.projectId === dialog.projectId)
          }
          insertPageTitle={page.draft?.title || tc("untitled")}
          insertUnavailable={dialog.custom?.role !== "page-outline"}
          onInsert={addBlock}
          onClose={closeDialog}
          manager={catalogManager}
          owner={dialog.projectId}
        />
      )}
    </>
  );
}
