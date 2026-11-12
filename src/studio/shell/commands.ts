import { useEffect, useRef } from "react";
import type { MenuCommand, TabCommand } from "../../host/protocol";
import { desktop } from "../../host/bridge";
import type { useAppearancePreference } from "../../design/appearance-preference";
import {
  getLocale,
  LOCALE_NAMES,
  LOCALES,
  setLanguagePreference,
} from "../../i18n";
import { useTranslator } from "../../i18n/react";
import navigationMessages from "../../i18n/messages/navigation";
import quickJumpMessages from "../../i18n/messages/quickJump";
import shellMessages from "../../i18n/messages/appShell";
import { modalOpen } from "../../ui/modal";
import { REPORT_PROBLEM_EVENT, type ReportProblemDetail } from "../../problems";
import { commandKey, tabShortcut } from "../../workbench/tab-shortcuts";
import type { FeedbackRequest } from "../feedback/AboutFeedback";
import type { LibraryContextMenuItem } from "../LibraryNavigation";
import type { WorkbenchCommand } from "../quick-jump/QuickJump";
import type { useFind } from "../find/useFind";
import { SIDEBAR_TOGGLE_EVENT } from "../AutoHideSidebar";
import { builtinDocLink } from "../builtin-docs";
import { clientIsMac } from "../keyboard-shortcuts";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { DialogControl } from "./useDialogState";
import type { MenuState } from "./menus/useMenuState";
import type { StudioRouter } from "./useStudioRouter";
import type { PageActions } from "./usePageActions";
import type { MenuItems } from "./menus/useMenuItems";
import type { AssistantControl, PageState, WorkspaceTabs } from "./types";

/**
 * Keyboard shortcuts, native menu commands, quick jump commands and the
 * feedback entry points: each carries out the same action as its control.
 */
export function useStudioCommands({
  feedback: { setNotice, report },
  library: { info, capabilities },
  route: {
    view,
    selectedProject,
    showDocs,
    setSearchLibrary,
    setSettingsSection,
    setFeedbackRequest,
    feedbackRequestId,
    selectedRef,
    selectedFolderRef,
    workspaceReady,
  },
  dialogs: { setDialog, dialogRef },
  menus: { setContextMenu, setExportMenu, exportSiteButton },
  router: { navigate, openDoc },
  pageActions: {
    importers,
    loadImporters,
    beginNewPage,
    importPage,
    exportPage,
  },
  menuItems: { newMenuItems, pageExportMenuItems },
  page,
  workspace,
  find,
  appearance,
  assistant: { assistantOpen, changeAssistantOpen },
}: {
  feedback: Pick<StudioFeedback, "setNotice" | "report">;
  library: Pick<LibraryState, "info" | "capabilities">;
  route: Pick<
    RouteState,
    | "view"
    | "selectedProject"
    | "showDocs"
    | "setSearchLibrary"
    | "setSettingsSection"
    | "setFeedbackRequest"
    | "feedbackRequestId"
    | "selectedRef"
    | "selectedFolderRef"
    | "workspaceReady"
  >;
  dialogs: Pick<DialogControl, "setDialog" | "dialogRef">;
  menus: Pick<
    MenuState,
    "setContextMenu" | "setExportMenu" | "exportSiteButton"
  >;
  router: Pick<StudioRouter, "navigate" | "openDoc">;
  pageActions: Pick<
    PageActions,
    "importers" | "loadImporters" | "beginNewPage" | "importPage" | "exportPage"
  >;
  menuItems: Pick<MenuItems, "newMenuItems" | "pageExportMenuItems">;
  page: PageState;
  workspace: WorkspaceTabs;
  find: ReturnType<typeof useFind>;
  appearance: ReturnType<typeof useAppearancePreference>;
  assistant: Pick<AssistantControl, "assistantOpen" | "changeAssistantOpen">;
}) {
  const tn = useTranslator(navigationMessages);
  const tq = useTranslator(quickJumpMessages);
  const tshell = useTranslator(shellMessages);
  useEffect(() => {
    if (view !== "page") return;
    const refreshPage = () => {
      void page.reloadCurrent().catch(report);
    };
    const key = (event: KeyboardEvent) => {
      if (
        commandKey(event, clientIsMac()) &&
        !event.altKey &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) refreshPage();
      }
    };
    const unsubscribe = desktop.onRefreshPage(refreshPage);
    window.addEventListener("keydown", key, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", key, true);
    };
  }, [view, page.reloadCurrent, report]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
      if (
        commandKey(event, clientIsMac()) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        // An open dialog keeps what was typed into it.
        if (dialogRef.current) return;
        if (selectedRef.current)
          void beginNewPage(
            selectedRef.current,
            selectedFolderRef.current,
          ).catch(report);
        else setDialog({ type: "project" });
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const openSearchRef = useRef<() => void>(() => {});
  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if (
        !commandKey(event, clientIsMac()) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "k" ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.defaultPrevented ||
        dialogRef.current ||
        modalOpen()
      )
        return;
      event.preventDefault();
      openSearchRef.current();
    };
    // The desktop Help menu and Settings → About open the shortcut overview.
    const shortcuts = () => setDialog({ type: "shortcuts" });
    window.addEventListener("keydown", search);
    window.addEventListener("showai:open-shortcuts", shortcuts);
    return () => {
      window.removeEventListener("keydown", search);
      window.removeEventListener("showai:open-shortcuts", shortcuts);
    };
  }, []);
  function openLibrarySearch() {
    if (view === "templates" || view === "components") {
      document
        .querySelector<HTMLInputElement>(".catalog-list-search input")
        ?.focus();
      return;
    }
    const open = () => {
      setSearchLibrary(true);
      document
        .querySelector<HTMLButtonElement>(
          ".studio-topbar .expandable-search-trigger",
        )
        ?.click();
    };
    if (document.querySelector(".studio-topbar .expandable-search-trigger"))
      open();
    // Libraries without full-text search offer it on Recent only.
    else void navigate("projects").then(() => setTimeout(open, 50), report);
  }
  openSearchRef.current = () => {
    setDialog({ type: "quickJump" });
    // A library importer saved since the project opened shows up too.
    loadImporters();
  };
  useEffect(() => {
    if (!capabilities.tabs) return;
    const command = (command: TabCommand) => {
      if (dialogRef.current || !workspaceReady) return;
      const index = workspace.tabs.findIndex(
        (tab) => tab.id === workspace.activeId,
      );
      // Like other Mac apps, closing the last tab closes the window.
      if (
        command === "close" &&
        workspace.tabs.length === 1 &&
        info?.mode === "desktop"
      ) {
        window.close();
        return;
      }
      const operation =
        command === "new"
          ? workspace.add
          : command === "close"
            ? () => workspace.close()
            : () =>
                workspace.select(
                  workspace.tabs[
                    (index +
                      (command === "next" ? 1 : workspace.tabs.length - 1)) %
                      workspace.tabs.length
                  ].id,
                );
      void operation().catch(report);
    };
    const key = (event: KeyboardEvent) => {
      const shortcut = tabShortcut(event, clientIsMac());
      if (!shortcut || event.defaultPrevented || dialogRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) command(shortcut);
    };
    const unsubscribe = desktop.onTabCommand(command);
    window.addEventListener("keydown", key, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", key, true);
    };
  }, [workspace, workspaceReady, report, capabilities.tabs, info?.mode]);
  // Native menu items carry out the same actions as the workbench controls.
  const menuCommand = useRef<(command: MenuCommand) => void>(() => {});
  const helpDoc = (slug: string) => {
    const url = `https://showai.renaissancemind.ai/doc${slug ? `/${slug}` : ""}`;
    const link = builtinDocLink(url);
    if (showDocs && link) return openDoc(link.pageId, link.hash);
    window.open(url, "_blank");
    return Promise.resolve(true);
  };
  const openFeedback = useRef<
    (view: FeedbackRequest["view"], context?: ReportProblemDetail) => void
  >(() => {});
  openFeedback.current = (view, context) => {
    setFeedbackRequest({ id: ++feedbackRequestId.current, view, context });
    setSettingsSection("about");
    void navigate("settings").catch(report);
  };
  // 报告问题 from notices, the Agent and the Help menu all end in 关于与反馈.
  useEffect(() => {
    const reportProblem = (event: CustomEvent<ReportProblemDetail>) => {
      event.preventDefault();
      openFeedback.current("report", event.detail);
    };
    const feedback = (event: Event) => {
      event.preventDefault();
      const detail = (event as CustomEvent<{ view?: string } | undefined>)
        .detail;
      openFeedback.current(detail?.view === "about" ? "about" : "report");
    };
    const diagnostics = (event: Event) => {
      event.preventDefault();
      openFeedback.current("diagnostics");
    };
    window.addEventListener(REPORT_PROBLEM_EVENT, reportProblem);
    window.addEventListener("showai:open-feedback", feedback);
    window.addEventListener("showai:copy-diagnostics", diagnostics);
    return () => {
      window.removeEventListener(REPORT_PROBLEM_EVENT, reportProblem);
      window.removeEventListener("showai:open-feedback", feedback);
      window.removeEventListener("showai:copy-diagnostics", diagnostics);
    };
  }, []);
  menuCommand.current = (command) => {
    const doc = helpDoc;
    // The feedback listeners above take these events; otherwise use the About page.
    const unhandled = (name: string, detail?: unknown) =>
      window.dispatchEvent(new CustomEvent(name, { cancelable: true, detail }));
    const about = () => {
      setSettingsSection("about");
      return navigate("settings");
    };
    const operations: Record<MenuCommand, () => Promise<unknown> | void> = {
      newProject: () => setDialog({ type: "project" }),
      newPage: () =>
        dialogRef.current
          ? undefined
          : selectedRef.current
            ? beginNewPage(selectedRef.current, selectedFolderRef.current)
            : setDialog({ type: "project" }),
      newTab: () => {
        if (capabilities.tabs && workspaceReady) return workspace.add();
      },
      import: () =>
        selectedProject ? importPage() : setDialog({ type: "project" }),
      export: () => {
        if (view === "page" && page.draft) return exportPage("html");
        if (view === "project" && exportSiteButton.current)
          setExportMenu(exportSiteButton.current);
      },
      settings: () => navigate("settings"),
      projects: () => navigate("projects"),
      docs: () => doc(""),
      faq: () => doc("agent-troubleshooting"),
      about,
      reportProblem: () => {
        if (unhandled("showai:open-feedback", { source: "menu" }))
          return about();
      },
      copyDiagnostics: async () => {
        if (
          !unhandled("showai:copy-diagnostics") ||
          !window.showai?.diagnostics
        )
          return;
        await desktop.invoke("clipboard:write", {
          text: await window.showai.diagnostics(),
        });
        setNotice(tshell("diagnostics.copied"));
      },
      shortcuts: () => {
        unhandled("showai:open-shortcuts");
      },
      find: () => void find.run("open"),
      findReplace: () => void find.run("replace"),
      findNext: () => void find.run("next"),
      findPrevious: () => void find.run("previous"),
    };
    if (dialogRef.current && command !== "copyDiagnostics") return;
    void Promise.resolve(operations[command]?.()).catch(report);
  };
  useEffect(
    () => desktop.onMenuCommand((command) => menuCommand.current(command)),
    [],
  );
  function quickJumpCommands(): WorkbenchCommand[] {
    const fromMenu = (items: LibraryContextMenuItem[]) =>
      items.flatMap((item) =>
        item.command && item.onSelect
          ? [
              {
                id: item.command,
                title: item.command.startsWith("export.")
                  ? tq("command.export", { format: item.label })
                  : item.command === "new.folder"
                    ? tq("command.newFolder")
                    : item.command === "new.page"
                      ? tq("command.newPage")
                      : item.command === "new.board"
                        ? tq("command.newBoard")
                        : item.label,
                ...(item.disabled ? { disabled: true } : {}),
                run: item.onSelect,
              },
            ]
          : [],
      );
    const pageOpen = view === "page" && !!page.draft;
    const dark = appearance.theme === "dark";
    const otherLocale = LOCALES.find((locale) => locale !== getLocale())!;
    const shortcut = (label: string, keys: string) => ({
      title: label,
      shortcut: keys,
    });
    return [
      ...fromMenu(newMenuItems()),
      ...(pageOpen ? fromMenu(pageExportMenuItems()) : []),
      ...(pageOpen
        ? [
            {
              id: "page.find",
              ...shortcut(tn("shortcut.find"), "Mod+F"),
              run: () => menuCommand.current("find"),
            },
            {
              id: "page.findReplace",
              ...shortcut(tn("shortcut.findReplace"), "Alt+Mod+F"),
              run: () => menuCommand.current("findReplace"),
            },
            {
              id: "agent.toggle",
              title: tq(
                assistantOpen ? "command.agentClose" : "command.agentOpen",
              ),
              keywords: tq("keywords.agent"),
              run: () => changeAssistantOpen(!assistantOpen),
            },
          ]
        : []),
      // Each importer is a command; "Import file…" above picks one by the file.
      ...(selectedProject
        ? importers.map((importer) => ({
            id: `import.${importer.id}`,
            title: tq("command.importWith", { name: importer.name }),
            keywords: `${tq("keywords.import")} ${importer.extensions.join(" ")}`,
            run: () => importPage(undefined, undefined, importer.id),
          }))
        : []),
      {
        id: "library.search",
        title: tq("command.searchLibrary"),
        run: openLibrarySearch,
      },
      {
        id: "sidebar.toggle",
        ...shortcut(tn("shortcut.sidebar"), "Mod+\\"),
        keywords: tq("keywords.sidebar"),
        run: () => {
          window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT));
        },
      },
      ...(capabilities.tabs && info?.mode !== "browser"
        ? [
            {
              id: "tab.new",
              ...shortcut(tn("shortcut.newTab"), "Mod+T"),
              run: () => menuCommand.current("newTab"),
            },
          ]
        : []),
      {
        id: "view.recent",
        title: tq("command.recent"),
        run: () => menuCommand.current("projects"),
      },
      {
        id: "view.settings",
        title: tq("command.settings"),
        run: () => menuCommand.current("settings"),
      },
      {
        id: "view.docs",
        title: tq("command.docs"),
        run: () => menuCommand.current("docs"),
      },
      {
        id: "view.shortcuts",
        title: tq("command.shortcuts"),
        run: () => menuCommand.current("shortcuts"),
      },
      {
        id: "appearance.toggle",
        title: tq(dark ? "command.themeLight" : "command.themeDark"),
        keywords: tq("keywords.theme"),
        run: () => appearance.setPreference(dark ? "light" : "dark"),
      },
      {
        id: "language.switch",
        title: tq("command.language", { name: LOCALE_NAMES[otherLocale] }),
        keywords: tq("keywords.language"),
        run: () => setLanguagePreference(otherLocale),
      },
    ];
  }
  return { menuCommand, helpDoc, openFeedback, quickJumpCommands };
}

export type StudioCommands = ReturnType<typeof useStudioCommands>;
