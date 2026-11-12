import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ProjectSummary, FolderMetadata } from "../../core/model";
import type { TemplateMetadata } from "../../contract/types";
import type { ImportReport } from "../../agent/import-service";
import type { AgentTarget } from "../../agent-host/types";
import {
  formatReference,
  referenceVersion,
  type PageReference,
} from "../../core/page-reference";
import { artifactVersion, findSurfaceNode } from "../../document/document.mjs";
import { upgradeResource } from "../../document/containers.mjs";
import { pageLink } from "../../document/page-link.mjs";
import { insertComponent } from "../../surface/component-insertion";
import { desktop } from "../../host/bridge";
import { formatSize } from "../../lib/format-size";
import { useTranslator } from "../../i18n/react";
import assistantMessages from "../../i18n/messages/assistant";
import commonMessages from "../../i18n/messages/common";
import importMessages from "../../i18n/messages/imports";
import studioMessages from "../../i18n/messages/studio";
import syncMessages from "../../i18n/messages/sync";
import type { StagedImportPlan } from "../ImportDialog";
import type { PackagingDecisions, PackagingPlan } from "../PackagingDialog";
import type { LibraryTarget } from "../LibraryNavigation";
import type { CreationChoice } from "../new-menu";
import type { LoadedPage } from "../usePage";
import { IMPORT_DROP_LIMIT, acceptsImport } from "../page-import";
import { referenceHeading } from "../assistant/targets";
import { withCreatedPage } from "../navigation-refresh";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { DialogControl } from "./useDialogState";
import type { MenuState } from "./menus/useMenuState";
import type { DirectoryState } from "./useDirectory";
import type { StudioRouter } from "./useStudioRouter";
import { focusAssistantInput, focusPageTitle } from "./focus";
import {
  DraftHeld,
  operation,
  type PageState,
  type WorkspaceTabs,
} from "./types";

/** Creating, importing, exporting and copying pages, and inserting components into them. */
export function usePageActions({
  feedback: { setNotice, report, resolveProblem, notifyWithUndo, draftHeld },
  library: {
    info,
    projects,
    contents,
    setContents,
    setExpandedProjects,
    refresh,
    refreshProjects,
  },
  route: {
    selectedProject,
    setSelectedProject,
    selectedFolder,
    setSelectedFolder,
    setView,
    setRevealNode,
    selectedRef,
  },
  dialogs: { dialog, setDialog },
  menus: { setContextMenu },
  directory: { project, folders, currentFolder },
  router: { saveOpenPage, settleOpenPage, openPage },
  page,
  workspaceRef,
}: {
  feedback: Pick<
    StudioFeedback,
    "setNotice" | "report" | "resolveProblem" | "notifyWithUndo" | "draftHeld"
  >;
  library: Pick<
    LibraryState,
    | "info"
    | "projects"
    | "contents"
    | "setContents"
    | "setExpandedProjects"
    | "refresh"
    | "refreshProjects"
  >;
  route: Pick<
    RouteState,
    | "selectedProject"
    | "setSelectedProject"
    | "selectedFolder"
    | "setSelectedFolder"
    | "setView"
    | "setRevealNode"
    | "selectedRef"
  >;
  dialogs: Pick<DialogControl, "dialog" | "setDialog">;
  menus: Pick<MenuState, "setContextMenu">;
  directory: Pick<DirectoryState, "project" | "folders" | "currentFolder">;
  router: Pick<StudioRouter, "saveOpenPage" | "settleOpenPage" | "openPage">;
  page: PageState;
  /** The workspace tabs are created after these actions; they read them when they run. */
  workspaceRef: RefObject<WorkspaceTabs>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const ti = useTranslator(importMessages);
  const ta = useTranslator(assistantMessages);
  const ts = useTranslator(syncMessages);
  const [importPlan, setImportPlan] = useState<{
    plan: StagedImportPlan;
    destination: string;
  } | null>(null);
  // Importers this project can use, offered as quick jump commands.
  const [importers, setImporters] = useState<
    { id: string; name: string; extensions: string[] }[]
  >([]);
  const loadImporters = () => {
    if (!selectedProject) return setImporters([]);
    void desktop
      .invoke<{
        importers: { id: string; name: string; extensions: string[] }[];
      }>("imports:importers", { projectId: selectedProject })
      .then((result) => setImporters(result.importers), report);
  };
  useEffect(loadImporters, [selectedProject]);
  const [packagingDecision, setPackagingDecision] = useState<{
    plan: PackagingPlan;
    decide: (decisions: PackagingDecisions | null) => void;
  } | null>(null);
  const creatingPage = useRef(false);
  const [busy, setBusy] = useState(false);
  const activeSurface = useRef<{ pageId: string; surfaceId: string } | null>(
    null,
  );
  const [exportReceipt, setExportReceipt] = useState<{
    message: string;
    path: string;
  } | null>(null);
  const activePageId = page.draft?.id;
  const handleActiveSurfaceChange = useCallback(
    (surfaceId: string) => {
      if (activePageId)
        activeSurface.current = { pageId: activePageId, surfaceId };
    },
    [activePageId],
  );
  useEffect(() => {
    if (!exportReceipt) return;
    const timer = setTimeout(() => setExportReceipt(null), 10000);
    return () => clearTimeout(timer);
  }, [exportReceipt]);
  /** Save the page as shown, then copy a reference pinned to that version. */
  async function copyPageReference(projectId: string, target: AgentTarget) {
    const pageId = target.pageId;
    if (!pageId) return;
    const workspaceState = page.sessions.getSnapshot();
    const session = workspaceState.views
      .map((view) => view.session)
      .find((item) => {
        const state = item.getSnapshot();
        return state.projectId === projectId && state.draft?.id === pageId;
      });
    // An open page saves first; the active one also finishes native ink input.
    const saved = !session
      ? true
      : session === workspaceState.active
        ? await page.flush()
        : await session.flush();
    if (!saved) throw new Error(ta("panel.saveFirst"));
    const record = session?.getSnapshot().record;
    if (session && record?.document.id !== pageId)
      throw new Error(ta("pageReference.pageChanged"));
    const reference = await desktop.invoke<PageReference>("pages:reference", {
      projectId,
      pageId,
      target,
      ...(record ? { expectedHash: record.hash } : {}),
    });
    await desktop.invoke("clipboard:write", {
      text: formatReference(reference, referenceHeading(ta, reference)),
    });
    setNotice(
      ta("pageReference.copied", { version: referenceVersion(reference) }),
    );
  }
  async function copyPageLink(target: {
    projectId: string;
    pageId: string;
    blockIds: string[];
  }) {
    await desktop.invoke("clipboard:write", { text: pageLink(target) });
    setNotice(t("linkCopied"));
  }
  async function beginNewPage(projectId: string, parentId: string | null) {
    const choices = await desktop.invoke<TemplateMetadata[]>("templates:list", {
      projectId,
    });
    setContextMenu(null);
    setDialog({ type: "newPage", projectId, parentId, templates: choices });
  }
  async function createPage(
    templateId = "blank",
    template?: TemplateMetadata,
    kind?: "page" | "board",
    directory?: { projectId: string; parentId: string | null },
    /** A blank page made by the person takes typing in its title at once. */
    focusTitle = false,
  ) {
    const workspace = workspaceRef.current;
    const projectId =
      directory?.projectId ??
      (dialog?.type === "newPage" ? dialog.projectId : selectedProject);
    const parentId = directory
      ? directory.parentId
      : dialog?.type === "newPage"
        ? dialog.parentId
        : selectedFolder;
    // A second click while the open page saves must not create another page.
    if (!projectId || creatingPage.current) return false;
    creatingPage.current = true;
    setBusy(true);
    try {
      if (!(await page.flushOrDefer())) {
        setDialog(null);
        return draftHeld();
      }
      const created = await desktop.invoke<LoadedPage>("pages:create", {
        projectId,
        parentId,
        templateId,
        kind,
        templateVersion: template?.version,
        templateScope: template?.scope,
        templateIntegrity: template?.integrity,
      });
      setContents((current) => withCreatedPage(current, projectId, created));
      if (
        !(await page.open(
          projectId,
          created.document.id,
          workspace.activeId,
          created,
        ))
      ) {
        setDialog(null);
        void refreshProjects([projectId]).catch(report);
        return page.status === "error" ? draftHeld() : false;
      }
      selectedRef.current = projectId;
      setSelectedProject(projectId);
      setSelectedFolder(parentId);
      setExpandedProjects((current) => ({ ...current, [projectId]: true }));
      setDialog(null);
      setView("page");
      if (focusTitle)
        focusPageTitle(
          () =>
            page.sessions.getSnapshot().active?.getSnapshot().draft?.id ===
            created.document.id,
        );
      // The page is listed already; confirm only its project.
      void refreshProjects([projectId]).catch(report);
      return created.document.id;
    } catch (reason) {
      report(reason, { action: operation("op.createPage") });
      return false;
    } finally {
      creatingPage.current = false;
      setBusy(false);
    }
  }
  /**
   * A page a component on another page asked for, such as a database record.
   * It goes into the given folder; a missing folder is made beside the asking page.
   */
  async function createLinkedPage(input: {
    projectId: string;
    hostPageId: string;
    title?: string;
    folderId?: string;
    folderName: string;
  }) {
    const folders = await desktop.invoke<FolderMetadata[]>("folders:list", {
      projectId: input.projectId,
    });
    let folder = folders.find(
      (item) => item.id === input.folderId && !item.archived,
    );
    if (!folder) {
      const host = contents[input.projectId]?.pages.find(
        (item) => item.id === input.hostPageId,
      );
      folder = await desktop.invoke<FolderMetadata>("folders:create", {
        projectId: input.projectId,
        parentId: host?.parentId ?? null,
        name: input.folderName,
      });
    }
    const created = await desktop.invoke<LoadedPage>("pages:create", {
      projectId: input.projectId,
      parentId: folder.id,
      kind: "page",
      ...(input.title ? { title: input.title } : {}),
    });
    await refreshProjects([input.projectId]);
    return { pageId: created.document.id, folderId: folder.id };
  }
  /** Renames a page a component on another page links to, as the sidebar does. */
  async function renameLinkedPage(input: {
    projectId: string;
    pageId: string;
    title: string;
  }) {
    const retained = page.sessions.sessionFor(input.projectId, input.pageId);
    if (retained) {
      retained.edit({ title: input.title });
      if (!(await retained.flush()))
        throw new Error(t("linkedPageRenameBlocked"));
    } else {
      const record = await desktop.invoke<LoadedPage>("pages:get", {
        projectId: input.projectId,
        pageId: input.pageId,
      });
      await desktop.invoke("pages:rename", {
        projectId: input.projectId,
        pageId: input.pageId,
        baseHash: record.hash,
        baseRevision: record.revision,
        title: input.title,
      });
    }
    await refreshProjects([input.projectId]);
  }
  /**
   * Copies the open read-only page into a new project this device owns. The
   * copy stays local even when new projects default to a server account, and
   * a failed import removes the empty project it was going to fill.
   */
  async function saveLocalCopy() {
    const draft = page.draft;
    if (!draft) return;
    const source = { ...draft, parentId: null };
    const name = ts("readOnly.copyName", {
      name: project?.name ?? draft.title,
    });
    const created = await desktop.invoke<ProjectSummary>(
      "sync:createLocalProject",
      { name, icon: project?.icon },
    );
    let imported: LoadedPage;
    try {
      imported = await desktop.invoke<LoadedPage>("pages:import", {
        projectId: created.id,
        parentId: null,
        artifact: {
          format: "showai",
          version: artifactVersion(source),
          document: source,
          components: page.record?.components ?? [],
        },
      });
    } catch (reason) {
      await desktop.invoke("projects:remove", { projectId: created.id });
      await refreshProjects([created.id], { sidebar: true });
      throw reason;
    }
    resolveProblem("saveLocalCopy");
    await refreshProjects([created.id], { sidebar: true });
    await openPage(imported.document.id, created.id);
    setNotice(ts("readOnly.copied", { name }));
  }
  const runSaveLocalCopy = () =>
    void saveLocalCopy().catch((reason: unknown) =>
      report(reason, {
        action: operation("op.saveLocalCopy"),
        key: "saveLocalCopy",
        safety: "saved",
        retry: runSaveLocalCopy,
      }),
    );
  /** The draft becomes a new page beside the original, which stays as saved. */
  async function keepDraftAsCopy() {
    const copy = await page.keepCopy();
    if (!copy) return;
    if (page.projectId) await refreshProjects([page.projectId]);
    else await refresh();
    setNotice(t("draftKeptAsCopy"));
  }
  /** A blank page with the Agent panel open and its input focused. */
  async function createPageForAgent(directory: {
    projectId: string;
    parentId: string | null;
  }) {
    const workspace = workspaceRef.current;
    if (!(await createPage("blank", undefined, "page", directory))) return;
    workspace.setAssistantOpen(true, workspace.activeId);
    focusAssistantInput();
  }
  /**
   * One import path for the toolbar, the 「添加内容」 menu and files dropped on
   * the directory: the importer's plan is shown, and the import writes only
   * after the person confirms it.
   */
  async function importPage(
    directory: {
      projectId: string;
      parentId: string | null;
    } | null = selectedProject
      ? { projectId: selectedProject, parentId: selectedFolder }
      : null,
    dropped?: { name: string; data: string }[],
    importer?: string,
  ) {
    if (!directory) return;
    if (!(await page.flushOrDefer())) return draftHeld();
    const source = dropped
      ? { files: dropped }
      : await desktop.invoke<{ path: string } | null>("dialog:openPage", {
          projectId: directory.projectId,
          ...(importer ? { importer } : {}),
        });
    if (!source) return;
    const plan = await desktop.invoke<StagedImportPlan>("imports:plan", {
      ...directory,
      ...source,
      ...(importer ? { importer } : {}),
    });
    const owner = projects.find((item) => item.id === directory.projectId);
    const folder =
      directory.projectId === selectedProject
        ? folders.find((item) => item.id === directory.parentId)
        : undefined;
    setImportPlan({
      plan,
      destination: [owner?.name, folder?.name].filter(Boolean).join(" / "),
    });
  }
  /** After an import: the new content shows, and the whole import can be undone. */
  async function importFinished(report: ImportReport) {
    const { projectId: target } = report.plan.target;
    await refreshProjects([target]);
    if (!report.created.pages && !report.created.folders) return;
    notifyWithUndo(
      ti(report.cancelled ? "stopped" : "done", {
        pages: report.created.pages,
      }),
      async () => {
        for (const folderId of report.undo.folders)
          await desktop.invoke("folders:remove", {
            projectId: target,
            folderId,
          });
        for (const pageId of report.undo.pages)
          await desktop.invoke("pages:remove", { projectId: target, pageId });
        await refreshProjects([target]);
      },
    );
  }
  /**
   * Files of this device, and data computed from them, leave with an export
   * only as the person chooses after seeing the list with sizes (starting
   * from their last choices): the decisions, undefined when nothing needs
   * choosing, or null when they cancel.
   */
  async function packagingChoice(
    projectId: string,
    pageId?: string,
    format?: "html" | "json" | "inline" | "site",
  ): Promise<PackagingDecisions | undefined | null> {
    const plan = await desktop.invoke<PackagingPlan>("export:analyze", {
      projectId,
      ...(pageId ? { pageId } : {}),
      ...(format ? { format } : {}),
    });
    if (!plan.confirm) return undefined;
    const decisions = await new Promise<PackagingDecisions | null>((decide) =>
      setPackagingDecision({ plan, decide }),
    );
    setPackagingDecision(null);
    return decisions;
  }
  async function exportPage(
    format: "html" | "json" | "inline" | "pdf",
    components: "bundled" | "remote" = "bundled",
    presentation?: "spatial" | "reading",
    reader?: "bundled" | "cdn",
    target: { projectId: string; pageId: string } | null = selectedProject &&
    page.draft
      ? { projectId: selectedProject, pageId: page.draft.id }
      : null,
  ) {
    if (!target) return;
    // The browser saves a PDF from its own print dialog; the tab opens now,
    // while the click still allows it, and shows the page once it is ready.
    const browserPrint = format === "pdf" && info?.mode === "browser";
    let printTab = browserPrint ? window.open("", "_blank") : null;
    setBusy(true);
    setContextMenu(null);
    try {
      if (page.draft?.id === target.pageId) await saveOpenPage();
      const packaging = await packagingChoice(
        target.projectId,
        target.pageId,
        format === "pdf" ? "html" : format,
      );
      if (packaging === null) {
        printTab?.close();
        return;
      }
      if (browserPrint) {
        const { url } = await desktop.invoke<{ url: string }>(
          "export:printable",
          { ...target, ...(packaging ? { packaging } : {}) },
        );
        if (printTab) printTab.location.href = url;
        else printTab = window.open(url, "_blank");
        if (!printTab) throw new Error(t("printTabBlocked"));
        resolveProblem(operation("op.exportPage"));
        return;
      }
      const result = await desktop.invoke<{ path: string } | null>(
        "export:page",
        {
          ...target,
          format,
          components,
          presentation,
          reader,
          ...(packaging ? { packaging } : {}),
        },
      );
      resolveProblem(operation("op.exportPage"));
      if (result)
        setExportReceipt({ message: t("pageExported"), path: result.path });
    } catch (reason) {
      printTab?.close();
      const again = () =>
        void exportPage(format, components, presentation, reader, target);
      report(reason, {
        action: operation("op.exportPage"),
        retry: again,
        handlers: { chooseLocation: again },
      });
    } finally {
      setBusy(false);
    }
  }
  async function exportSite(components: "bundled" | "remote" = "bundled") {
    if (!selectedProject) return;
    setBusy(true);
    try {
      // The open page is part of the site when it belongs to this project.
      if (page.projectId === selectedProject) await saveOpenPage();
      else await settleOpenPage();
      const packaging = await packagingChoice(
        selectedProject,
        undefined,
        "site",
      );
      if (packaging === null) return;
      const result = await desktop.invoke<{ path: string } | null>(
        "export:site",
        {
          projectId: selectedProject,
          components,
          ...(packaging ? { packaging } : {}),
        },
      );
      resolveProblem(operation("op.exportSite"));
      if (result)
        setExportReceipt({
          message:
            components === "remote"
              ? t("siteExportedRemote")
              : t("siteExportedBundled"),
          path: result.path,
        });
    } catch (reason) {
      report(reason, {
        action: operation("op.exportSite"),
        retry: () => void exportSite(components),
        handlers: { chooseLocation: () => void exportSite(components) },
      });
    } finally {
      setBusy(false);
    }
  }
  const activePageTarget = (): LibraryTarget | null =>
    page.draft && page.projectId
      ? {
          kind: "page",
          projectId: page.projectId,
          id: page.draft.id,
          title: page.draft.title || tc("untitled"),
          icon: page.draft.icon,
          pinned: page.draft.favorite,
          parentId: page.draft.parentId,
        }
      : null;
  /** Duplicates a page from any of its menus and opens the copy. */
  async function duplicatePage(target: LibraryTarget) {
    if (page.draft?.id === target.id) await saveOpenPage();
    const result = await desktop.invoke<LoadedPage>("pages:duplicate", {
      projectId: target.projectId,
      pageId: target.id,
    });
    setContents((current) =>
      withCreatedPage(current, target.projectId, result),
    );
    await openPage(result.document.id, target.projectId);
    await refreshProjects([target.projectId]);
  }
  /** Creates one kind of content in a project or folder. */
  function runCreation(
    choice: CreationChoice,
    directory: { projectId: string; parentId: string | null },
  ): Promise<unknown> {
    if (choice === "folder") {
      setDialog({ type: "folder", ...directory });
      return Promise.resolve();
    }
    if (choice === "page" || choice === "board")
      return createPage("blank", undefined, choice, directory, true);
    if (choice === "agentPage") return createPageForAgent(directory);
    if (choice === "template")
      return beginNewPage(directory.projectId, directory.parentId);
    return importPage(directory);
  }
  async function beginPageIcon(target: LibraryTarget) {
    const retained = page.sessions.sessionFor(target.projectId, target.id);
    if (retained === page.sessions.getSnapshot().active) await saveOpenPage();
    else if (retained) {
      if (!(await retained.flush()))
        throw new DraftHeld(t("resolveDraftFirst"));
    } else await settleOpenPage();
    const record = await desktop.invoke<LoadedPage>("pages:get", {
      projectId: target.projectId,
      pageId: target.id,
    });
    setDialog({
      type: "pageIcon",
      target,
      value: record.document.icon,
      record,
    });
  }
  async function addBlock(kind: string, data: Record<string, unknown>) {
    if (
      !page.draft ||
      !page.projectId ||
      page.projectId !== selectedRef.current
    ) {
      setNotice(t("openPageFirst"), { kind: "warning" });
      return;
    }
    const source = upgradeResource(page.draft);
    const owner =
      activeSurface.current?.pageId === source.id
        ? findSurfaceNode(source, activeSurface.current.surfaceId)?.node
        : undefined;
    const destination =
      owner && ["surface", "region"].includes(owner.type ?? "")
        ? owner
        : source.content;
    const inserted = insertComponent(source, destination.attrs!.id, kind, data);
    const nodeId = inserted.nodeId;
    page.edit(inserted.document);
    await saveOpenPage();
    setDialog(null);
    setRevealNode(nodeId);
    setSelectedProject(page.projectId);
    selectedRef.current = page.projectId;
    setView("page");
  }
  async function importDroppedFiles(files: File[]) {
    if (!project) return;
    const { importers } = await desktop.invoke<{
      importers: { extensions: string[] }[];
    }>("imports:importers", { projectId: project.id });
    const extensions = importers.flatMap((importer) => importer.extensions);
    const accepted = files.filter((file) =>
      acceptsImport(file.name, extensions),
    );
    const skipped = files.filter((file) => !accepted.includes(file));
    if (skipped.length)
      setNotice(
        ti("unsupported", {
          names: skipped.map((file) => file.name).join(", "),
        }),
        { kind: "warning" },
      );
    if (!accepted.length) return;
    const size = accepted.reduce((sum, file) => sum + file.size, 0);
    if (size > IMPORT_DROP_LIMIT) {
      setNotice(
        ti("tooLarge", {
          size: formatSize(size),
          limit: formatSize(IMPORT_DROP_LIMIT),
        }),
        { kind: "warning" },
      );
      return;
    }
    const contents = await Promise.all(
      accepted.map(async (file) => ({
        name: file.name,
        data: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
      })),
    );
    await importPage(
      { projectId: project.id, parentId: currentFolder?.id ?? null },
      contents,
    );
  }
  return {
    importPlan,
    setImportPlan,
    importers,
    loadImporters,
    packagingDecision,
    busy,
    exportReceipt,
    setExportReceipt,
    handleActiveSurfaceChange,
    copyPageReference,
    copyPageLink,
    beginNewPage,
    createPage,
    createLinkedPage,
    renameLinkedPage,
    runSaveLocalCopy,
    keepDraftAsCopy,
    createPageForAgent,
    importPage,
    importFinished,
    exportPage,
    exportSite,
    activePageTarget,
    duplicatePage,
    runCreation,
    beginPageIcon,
    addBlock,
    importDroppedFiles,
  };
}

export type PageActions = ReturnType<typeof usePageActions>;
