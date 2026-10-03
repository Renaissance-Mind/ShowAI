import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { JSONContent } from "@tiptap/core";
import {
  ArrowUpRight,
  Blocks,
  Check,
  ChevronRight,
  Code2,
  Copy,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  HardDrive,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import type {
  ProjectSummary,
  PageSummary,
  FolderMetadata,
} from "../core/model";
import type { DesktopInfo } from "../desktop/bridge";
import type { ShowArtifact, ShowDocument } from "../types";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
  ComponentMetadata,
  ComponentSource,
  TemplateMetadata,
  TemplateRecord,
  PackageRevisionRef,
  CatalogReadOptions,
} from "../components/custom/types";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import DocumentEditor from "../editor/DocumentEditor";
import { parseArtifact } from "../lib/artifact";
import { parseMarkdown } from "../lib/markdown";
import { newDocument } from "../lib/document";
import { desktop, errorMessage } from "./bridge";
import { usePage, type LoadedPage } from "./usePage";
import {
  LibraryRow,
  LibraryContextMenu,
  type LibraryTarget,
} from "./LibraryNavigation";
import Dialog from "./Dialog";
import {
  TemplateDialog,
  ComponentDialog,
  PublishDialog,
  blankTemplate,
} from "./CatalogDialogs";
import "./studio.css";

type View =
  "projects" | "project" | "page" | "templates" | "components" | "settings";
type Catalog = {
  builtin: BuiltinComponentMetadata[];
  custom: ComponentMetadata[];
};
type LoadedTemplate = TemplateRecord & {
  components?: CompiledComponent[];
  previewDocument?: ShowDocument;
};
type DialogState =
  | { type: "project"; project?: ProjectSummary }
  | {
      type: "newPage";
      projectId: string;
      parentId: string | null;
      templates: TemplateMetadata[];
    }
  | { type: "folder"; projectId: string; parentId: string | null }
  | { type: "rename"; target: LibraryTarget }
  | { type: "delete"; target: LibraryTarget }
  | { type: "template"; record: LoadedTemplate; copy?: boolean }
  | { type: "saveTemplate" }
  | { type: "publish"; ref: PackageRevisionRef }
  | {
      type: "component";
      builtin?: BuiltinComponentMetadata;
      custom?: CompiledComponent;
      source?: ComponentSource;
    }
  | null;

function shortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
function Scope({ value }: { value: string }) {
  return (
    <span className="studio-tag">
      {{
        builtin: "内置",
        global: "全局",
        published: "已发布",
        user: "全局",
        project: "项目",
      }[value] ?? value}
    </span>
  );
}

export default function Studio() {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [contents, setContents] = useState<
    Record<string, { pages: PageSummary[]; folders: FolderMetadata[] }>
  >({});
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({});
  const expandedRef = useRef(expandedProjects);
  expandedRef.current = expandedProjects;
  const pages = selectedProject ? (contents[selectedProject]?.pages ?? []) : [];
  const folders = selectedProject
    ? (contents[selectedProject]?.folders ?? [])
    : [];
  const [view, setView] = useState<View>("projects");
  const [templates, setTemplates] = useState<TemplateMetadata[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({ builtin: [], custom: [] });
  const [catalogScope, setCatalogScope] =
    useState<CatalogReadOptions["scope"]>("all");
  const catalogScopeRef = useRef(catalogScope);
  catalogScopeRef.current = catalogScope;
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    target: LibraryTarget;
    anchor: HTMLElement;
    pageTools?: boolean;
  } | null>(null);
  const [projectsMenu, setProjectsMenu] = useState<HTMLElement | null>(null);
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("showai:appearance");
    return saved
      ? saved === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [componentFilter, setComponentFilter] = useState<"all" | "custom">(
    "all",
  );
  const [focusWindow] = useState(
    () => new URLSearchParams(location.search).get("focus") === "1",
  );
  const page = usePage();
  const project = projects.find((item) => item.id === selectedProject);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const selectedRef = useRef(selectedProject);
  selectedRef.current = selectedProject;
  const selectedFolderRef = useRef(selectedFolder);
  selectedFolderRef.current = selectedFolder;
  const initialized = useRef(false);
  const closeDialog = useCallback(() => setDialog(null), []);

  const report = useCallback(
    (error: unknown) => setProblem(errorMessage(error)),
    [],
  );
  const loadProjectContents = useCallback(async (id: string) => {
    const [nextPages, nextFolders] = await Promise.all([
      desktop.invoke<PageSummary[]>("pages:list", { projectId: id }),
      desktop.invoke<FolderMetadata[]>("folders:list", { projectId: id }),
    ]);
    const next = { pages: nextPages, folders: nextFolders };
    setContents((current) => ({ ...current, [id]: next }));
    return next;
  }, []);
  const refresh = useCallback(async () => {
    const next = await desktop.invoke<ProjectSummary[]>("projects:list");
    setProjects(next);
    const visibleIds = next
      .filter(
        (item) =>
          expandedRef.current[item.id] || item.id === selectedRef.current,
      )
      .map((item) => item.id);
    await Promise.all(visibleIds.map(loadProjectContents));
  }, [loadProjectContents]);
  const loadCatalog = useCallback(async () => {
    const id = selectedRef.current;
    const requestedScope = catalogScopeRef.current;
    const scope = { ...(id ? { projectId: id } : {}), scope: requestedScope };
    const [nextTemplates, nextCatalog] = await Promise.all([
      desktop.invoke<TemplateMetadata[]>("templates:list", scope),
      desktop.invoke<(BuiltinComponentMetadata | ComponentMetadata)[]>(
        "components:list",
        scope,
      ),
    ]);
    if (
      selectedRef.current !== id ||
      catalogScopeRef.current !== requestedScope
    )
      return;
    setTemplates(nextTemplates);
    setCatalog({
      builtin: nextCatalog.filter(
        (item): item is BuiltinComponentMetadata => "kind" in item,
      ),
      custom: nextCatalog.filter(
        (item): item is ComponentMetadata => !("kind" in item),
      ),
    });
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      setInfo(await desktop.invoke<DesktopInfo>("app:info"));
      await refresh();
      await loadCatalog();
      const params = new URLSearchParams(location.search);
      const projectId = params.get("project"),
        pageId = params.get("page");
      if (projectId && pageId) {
        selectedRef.current = projectId;
        setSelectedProject(projectId);
        const loaded = await loadProjectContents(projectId);
        setSelectedFolder(
          loaded.pages.find((item) => item.id === pageId)?.parentId ?? null,
        );
        setExpandedProjects((current) => ({ ...current, [projectId]: true }));
        await page.open(projectId, pageId);
        setView("page");
      }
    })().catch(report);
  }, [refresh, loadCatalog, page, report]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = desktop.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh().catch(report);
        void loadCatalog().catch(report);
      }, 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh, loadCatalog, report]);
  useEffect(() => {
    if (initialized.current) void loadCatalog().catch(report);
  }, [catalogScope, loadCatalog, report]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("showai:appearance", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = titleRef.current.scrollHeight + "px";
    }
  }, [page.draft?.title, view]);
  useEffect(() => {
    document.title =
      view === "page" && page.draft
        ? `${page.draft.title || "无标题"} — ShowAI`
        : "ShowAI";
  }, [view, page.draft?.title]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
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

  async function navigate(next: View) {
    if (!(await page.flush())) {
      setView("page");
      return;
    }
    setContextMenu(null);
    setQuery("");
    setView(next);
    if (next === "projects") {
      setSelectedProject(null);
      selectedRef.current = null;
      setSelectedFolder(null);
    }
    if (next === "templates" || next === "components") await loadCatalog();
  }
  async function openProject(id: string, folderId: string | null = null) {
    if (!(await page.flush())) {
      setView("page");
      return;
    }
    selectedRef.current = id;
    setSelectedProject(id);
    setSelectedFolder(folderId);
    setExpandedProjects((current) => ({ ...current, [id]: true }));
    setQuery("");
    setView("project");
    setContextMenu(null);
    const loaded = await loadProjectContents(id);
    expandFolderPath(loaded.folders, folderId);
    await loadCatalog();
  }
  async function openPage(id: string, projectId = selectedProject) {
    if (!projectId) return;
    if (await page.open(projectId, id)) {
      selectedRef.current = projectId;
      setSelectedProject(projectId);
      setExpandedProjects((current) => ({ ...current, [projectId]: true }));
      const loaded = await loadProjectContents(projectId);
      const parentId =
        loaded.pages.find((item) => item.id === id)?.parentId ?? null;
      setSelectedFolder(parentId);
      expandFolderPath(loaded.folders, parentId);
      setView("page");
      setContextMenu(null);
    }
  }
  async function beginNewPage(projectId: string, parentId: string | null) {
    const choices = await desktop.invoke<TemplateMetadata[]>("templates:list", {
      projectId,
    });
    setContextMenu(null);
    setDialog({ type: "newPage", projectId, parentId, templates: choices });
  }
  function expandFolderPath(items: FolderMetadata[], parentId: string | null) {
    const expanded: Record<string, boolean> = {};
    while (parentId && !expanded[parentId]) {
      expanded[parentId] = true;
      parentId = items.find((item) => item.id === parentId)?.parentId ?? null;
    }
    setExpandedFolders((current) => ({ ...current, ...expanded }));
  }
  async function createPage(templateId = "blank", template?: TemplateMetadata) {
    const projectId =
      dialog?.type === "newPage" ? dialog.projectId : selectedProject;
    const parentId =
      dialog?.type === "newPage" ? dialog.parentId : selectedFolder;
    if (!projectId) return;
    if (!(await page.flush())) {
      setDialog(null);
      setView("page");
      return;
    }
    setBusy(true);
    try {
      const created = await desktop.invoke<LoadedPage>("pages:create", {
        projectId,
        parentId,
        templateId,
        templateVersion: template?.version,
        templateScope: template?.scope,
        templateIntegrity: template?.integrity,
      });
      await openProject(projectId, parentId);
      await page.open(projectId, created.document.id);
      setDialog(null);
      setView("page");
      await refresh();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  async function importPage() {
    if (!selectedProject) return;
    if (!(await page.flush())) return;
    const file = await desktop.invoke<{ name: string; content: string } | null>(
      "dialog:openPage",
    );
    if (!file) return;
    let artifact: ShowArtifact;
    if (/\.(md|markdown|txt)$/i.test(file.name)) {
      const document = newDocument(file.name.replace(/\.[^.]+$/, ""));
      document.content = parseMarkdown(file.content);
      artifact = { format: "showai", version: 1, document };
    } else if (/\.html?$/i.test(file.name)) {
      const dom = new DOMParser().parseFromString(file.content, "text/html");
      artifact = parseArtifact(
        dom.getElementById("showai-data")?.textContent ?? "",
      );
    } else artifact = parseArtifact(file.content);
    const imported = await desktop.invoke<LoadedPage>("pages:import", {
      projectId: selectedProject,
      parentId: selectedFolder,
      artifact,
    });
    await openPage(imported.document.id, selectedProject);
    setView("page");
    await refresh();
    setNotice("页面已导入");
  }
  async function exportPage(
    format: "html" | "json" | "inline",
    components: "bundled" | "remote" = "bundled",
  ) {
    if (!selectedProject || !page.draft || !(await page.flush())) return;
    setBusy(true);
    setContextMenu(null);
    try {
      const result = await desktop.invoke<{ path: string } | null>(
        "export:page",
        {
          projectId: selectedProject,
          pageId: page.draft.id,
          format,
          components,
        },
      );
      if (result) setNotice("页面已导出");
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  async function exportSite(components: "bundled" | "remote" = "bundled") {
    if (!selectedProject || !(await page.flush())) return;
    setBusy(true);
    try {
      const result = await desktop.invoke<{ path: string } | null>(
        "export:site",
        { projectId: selectedProject, components },
      );
      if (result)
        setNotice(
          components === "remote"
            ? "网站已导出，组件按固定发布版本联网加载"
            : "网站已导出，可部署到静态托管",
        );
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  const projectTarget = (item: ProjectSummary): LibraryTarget => ({
    kind: "project",
    projectId: item.id,
    id: item.id,
    title: item.name,
    pinned: !!item.pinned,
    parentId: null,
  });
  const folderTarget = (
    item: FolderMetadata,
    projectId: string,
  ): LibraryTarget => ({
    kind: "folder",
    projectId,
    id: item.id,
    title: item.name,
    pinned: !!item.pinned,
    parentId: item.parentId ?? null,
  });
  const pageTarget = (item: PageSummary, projectId: string): LibraryTarget => ({
    kind: "page",
    projectId,
    id: item.id,
    title: item.title || "无标题",
    pinned: !!item.favorite,
    parentId: item.parentId ?? null,
  });
  const activePageTarget = (): LibraryTarget | null =>
    page.draft && page.projectId
      ? {
          kind: "page",
          projectId: page.projectId,
          id: page.draft.id,
          title: page.draft.title || "无标题",
          pinned: page.draft.favorite,
          parentId: page.draft.parentId,
        }
      : null;
  const showMenu = (
    target: LibraryTarget,
    anchor: HTMLElement,
    pageTools = false,
  ) =>
    setContextMenu((current) =>
      current?.anchor === anchor && current.target.id === target.id
        ? null
        : { target, anchor, pageTools },
    );
  async function toggleProject(id: string) {
    if (!expandedProjects[id]) await loadProjectContents(id);
    setExpandedProjects((current) => ({ ...current, [id]: !current[id] }));
  }
  async function updateTarget(
    target: LibraryTarget,
    change: { name?: string; pinned?: boolean },
  ) {
    if (!(await page.flush())) {
      setView("page");
      return false;
    }
    if (
      target.kind === "page" &&
      page.draft?.id === target.id &&
      page.projectId === target.projectId
    ) {
      page.edit({
        ...(change.name !== undefined ? { title: change.name } : {}),
        ...(change.pinned !== undefined ? { favorite: change.pinned } : {}),
      });
      if (!(await page.flush())) return false;
    } else if (target.kind === "page") {
      const record = await desktop.invoke<LoadedPage>("pages:get", {
        projectId: target.projectId,
        pageId: target.id,
      });
      await desktop.invoke(
        change.name !== undefined ? "pages:rename" : "pages:pin",
        {
          projectId: target.projectId,
          pageId: target.id,
          baseHash: record.hash,
          ...(change.name !== undefined
            ? { title: change.name }
            : { pinned: change.pinned }),
        },
      );
    } else {
      await desktop.invoke(
        `${target.kind === "project" ? "projects" : "folders"}:${change.name !== undefined ? "rename" : "pin"}`,
        {
          projectId: target.projectId,
          ...(target.kind === "folder" ? { folderId: target.id } : {}),
          ...change,
        },
      );
    }
    await refresh();
    return true;
  }
  async function deleteTarget(target: LibraryTarget) {
    if (!(await page.flush())) {
      setDialog(null);
      setView("page");
      return;
    }
    const owning = contents[target.projectId];
    const insideFolder = (parentId: string | null): boolean => {
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        if (parentId === target.id) return true;
        visited.add(parentId);
        parentId =
          owning?.folders.find((item) => item.id === parentId)?.parentId ??
          null;
      }
      return false;
    };
    const closePage =
      page.projectId === target.projectId &&
      (target.kind === "project" ||
        (target.kind === "page" && page.draft?.id === target.id) ||
        (target.kind === "folder" &&
          insideFolder(page.draft?.parentId ?? null)));
    const currentRecord =
      target.kind === "page"
        ? await desktop.invoke<LoadedPage>("pages:get", {
            projectId: target.projectId,
            pageId: target.id,
          })
        : null;
    if (closePage && !(await page.clear())) return;
    await desktop.invoke(
      `${target.kind === "project" ? "projects" : target.kind === "folder" ? "folders" : "pages"}:remove`,
      {
        projectId: target.projectId,
        ...(target.kind === "folder" ? { folderId: target.id } : {}),
        ...(currentRecord
          ? { pageId: target.id, baseHash: currentRecord.hash }
          : {}),
      },
    );
    setDialog(null);
    setContextMenu(null);
    if (target.kind === "project" && selectedRef.current === target.projectId) {
      setSelectedProject(null);
      selectedRef.current = null;
      setSelectedFolder(null);
      setView("projects");
    } else if (
      selectedRef.current === target.projectId &&
      (closePage || (target.kind === "folder" && insideFolder(selectedFolder)))
    ) {
      setSelectedFolder(
        target.kind === "folder" ? target.parentId : selectedFolder,
      );
      setView("project");
    }
    await refresh();
    setNotice("已删除");
  }
  function renderChildren(
    projectId: string,
    parentId: string | null = null,
    depth = 0,
  ): ReactNode {
    if (depth > 30) return null;
    const current = contents[projectId];
    if (!current) return null;
    const folderIds = new Set(current.folders.map((item) => item.id));
    const targets: LibraryTarget[] = [
      ...current.folders
        .filter((item) => (item.parentId ?? null) === parentId)
        .map((item) => folderTarget(item, projectId)),
      ...current.pages
        .filter(
          (item) =>
            (item.parentId && folderIds.has(item.parentId)
              ? item.parentId
              : null) === parentId,
        )
        .map((item) => pageTarget(item, projectId)),
    ].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return targets.map((target) => (
      <div key={target.id}>
        <LibraryRow
          target={target}
          active={
            selectedProject === projectId &&
            (target.kind === "page"
              ? view === "page" && page.draft?.id === target.id
              : view === "project" && selectedFolder === target.id)
          }
          expanded={
            target.kind === "folder" ? !!expandedFolders[target.id] : undefined
          }
          onToggle={
            target.kind === "folder"
              ? () =>
                  setExpandedFolders((current) => ({
                    ...current,
                    [target.id]: !current[target.id],
                  }))
              : undefined
          }
          onOpen={() => {
            if (target.kind === "folder") {
              setExpandedFolders((current) => ({
                ...current,
                [target.id]: true,
              }));
              void openProject(projectId, target.id).catch(report);
            } else void openPage(target.id, projectId).catch(report);
          }}
          onMenu={showMenu}
        />
        {target.kind === "folder" && expandedFolders[target.id] && (
          <div className="studio-tree-children">
            {renderChildren(projectId, target.id, depth + 1)}
          </div>
        )}
      </div>
    ));
  }
  async function addBlock(kind: string, data: Record<string, unknown>) {
    if (
      !page.draft ||
      !page.projectId ||
      page.projectId !== selectedRef.current
    ) {
      setNotice("先打开一个页面，再插入组件");
      return;
    }
    const content: JSONContent = {
      ...page.draft.content,
      content: [
        ...(page.draft.content.content ?? []),
        { type: "widget", attrs: { id: crypto.randomUUID(), kind, data } },
        { type: "paragraph", attrs: { id: crypto.randomUUID() } },
      ],
    };
    page.editContent(content);
    if (!(await page.flush())) return;
    setDialog(null);
    setSelectedProject(page.projectId);
    selectedRef.current = page.projectId;
    setView("page");
  }
  async function viewComponent(
    item: BuiltinComponentMetadata | ComponentMetadata,
  ) {
    if ("kind" in item) {
      const source = await desktop.invoke<ComponentSource>(
        "components:source",
        { id: item.kind, scope: "builtin" },
      );
      setDialog({ type: "component", builtin: item, source });
      return;
    }
    const custom = await desktop.invoke<CompiledComponent>("components:get", {
      id: item.id,
      version: item.version,
      scope: item.scope,
      integrity: item.integrity,
      ...(selectedProject ? { projectId: selectedProject } : {}),
    });
    let source: ComponentSource | undefined;
    if (custom.entry) {
      try {
        source = await desktop.invoke<ComponentSource>("components:source", {
          id: item.id,
          version: item.version,
          scope: item.scope,
          integrity: item.integrity,
          ...(selectedProject ? { projectId: selectedProject } : {}),
        });
      } catch (reason) {
        if (!errorMessage(reason).includes("source")) throw reason;
      }
    }
    setDialog({ type: "component", custom, source });
  }

  const loading = !info && !problem;
  const filteredProjects = projects.filter((item) =>
    (item.name + " " + (item.binding?.harness ?? ""))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const folderIds = new Set(folders.map((item) => item.id));
  const currentFolder = folders.find((item) => item.id === selectedFolder);
  const filteredPages = pages.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) &&
      (query ||
        (item.parentId && folderIds.has(item.parentId)
          ? item.parentId
          : null) === selectedFolder),
  );
  const filteredFolders = folders.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) &&
      (query || (item.parentId ?? null) === selectedFolder),
  );
  const visibleEntries = [
    ...filteredFolders.map((item) => ({
      target: folderTarget(item, selectedProject!),
      updatedAt: item.updatedAt,
    })),
    ...filteredPages.map((item) => ({
      target: pageTarget(item, selectedProject!),
      updatedAt: item.updatedAt,
    })),
  ].sort((a, b) => Number(b.target.pinned) - Number(a.target.pinned));
  const breadcrumbFolders: FolderMetadata[] = [];
  let breadcrumbFolder = currentFolder;
  while (
    breadcrumbFolder &&
    !breadcrumbFolders.some((item) => item.id === breadcrumbFolder!.id)
  ) {
    breadcrumbFolders.unshift(breadcrumbFolder);
    breadcrumbFolder = folders.find(
      (item) => item.id === breadcrumbFolder!.parentId,
    );
  }
  const heading =
    view === "projects"
      ? "项目"
      : view === "project"
        ? (currentFolder?.name ?? project?.name ?? "项目")
        : view === "templates"
          ? "模板"
          : view === "components"
            ? "组件"
            : view === "settings"
              ? "设置"
              : page.draft?.title || "无标题";
  const action = (operation: () => Promise<unknown>) => () => {
    void operation().catch(report);
  };

  return (
    <div className={`studio ${focusWindow ? "focus-window" : ""}`}>
      {!focusWindow && (
        <aside className="studio-sidebar">
          <div className="studio-brand">
            <span>✳</span>
            <strong>ShowAI</strong>
          </div>
          <nav className="studio-main-nav" aria-label="主要导航">
            <button
              className={
                ["projects", "project", "page"].includes(view) ? "active" : ""
              }
              onClick={action(() => navigate("projects"))}
            >
              <FolderOpen size={17} />
              项目
            </button>
            <button
              className={view === "templates" ? "active" : ""}
              onClick={action(() => navigate("templates"))}
            >
              <LayoutTemplate size={17} />
              模板
            </button>
            <button
              className={view === "components" ? "active" : ""}
              onClick={action(() => navigate("components"))}
            >
              <Blocks size={17} />
              组件
            </button>
          </nav>
          <div className="studio-sidebar-projects">
            <div className="studio-sidebar-label">
              项目
              <button
                className="studio-icon studio-row-menu"
                aria-label="项目列表操作"
                aria-haspopup="menu"
                onClick={(event) => {
                  const anchor = event.currentTarget;
                  setProjectsMenu((current) =>
                    current === anchor ? null : anchor,
                  );
                }}
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
            {projects.map((item) => (
              <div key={item.id}>
                <LibraryRow
                  target={projectTarget(item)}
                  active={
                    selectedProject === item.id &&
                    view === "project" &&
                    !selectedFolder
                  }
                  expanded={!!expandedProjects[item.id]}
                  onToggle={action(() => toggleProject(item.id))}
                  onOpen={action(() => openProject(item.id))}
                  onMenu={showMenu}
                />
                {expandedProjects[item.id] && (
                  <div className="studio-tree-children">
                    {renderChildren(item.id)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="studio-sidebar-bottom">
            <button
              className={view === "settings" ? "active" : ""}
              onClick={action(() => navigate("settings"))}
            >
              <Settings2 size={15} />
              设置
            </button>
          </div>
        </aside>
      )}
      <main className="studio-main">
        <header className="studio-topbar">
          <div className="studio-breadcrumb">
            {focusWindow ? (
              <span>ShowAI</span>
            ) : (
              <button onClick={action(() => navigate("projects"))}>项目</button>
            )}
            {selectedProject && (
              <>
                <ChevronRight size={13} />
                <button onClick={action(() => openProject(selectedProject))}>
                  {project?.name ?? "项目"}
                </button>
              </>
            )}
            {breadcrumbFolders.map((item) => (
              <span className="studio-breadcrumb-folder" key={item.id}>
                <ChevronRight size={13} />
                <button
                  onClick={action(() => openProject(selectedProject!, item.id))}
                >
                  {item.name}
                </button>
              </span>
            ))}
            {view === "page" && (
              <>
                <ChevronRight size={13} />
                <span>{page.draft?.title || "无标题"}</span>
              </>
            )}
          </div>
          <div className="studio-header-actions">
            {view === "page" && page.draft && (
              <>
                <span className={`studio-save-state ${page.status}`}>
                  {page.status === "saving" ? (
                    <Loader2 size={12} className="studio-spin" />
                  ) : (
                    <Check size={12} />
                  )}
                  {
                    {
                      saved: "已保存",
                      saving: "保存中",
                      changed: "待保存",
                      conflict: "文件已更新",
                      error: "保存失败",
                    }[page.status]
                  }
                </span>
                <button
                  className="studio-icon"
                  aria-label="显示页面文件"
                  title="显示页面文件"
                  onClick={action(() =>
                    desktop.invoke("fs:reveal", {
                      projectId: selectedProject,
                      pageId: page.draft!.id,
                    }),
                  )}
                >
                  <FolderOpen size={16} />
                </button>
                <button
                  className="studio-button small primary"
                  disabled={busy}
                  onClick={() => void exportPage("html")}
                >
                  <ArrowUpRight size={14} />
                  导出
                </button>
                <button
                  className="studio-icon"
                  aria-label="页面操作"
                  aria-haspopup="menu"
                  onClick={(event) => {
                    const target = activePageTarget();
                    if (target) showMenu(target, event.currentTarget, true);
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>
              </>
            )}
          </div>
        </header>
        {problem && (
          <div className="studio-problem" role="alert">
            <span>{problem}</span>
            <button
              className="studio-icon"
              aria-label="关闭错误提示"
              onClick={() => setProblem("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {view === "page" && page.error && (
          <div className="studio-conflict" role="alert">
            <div>
              <strong>
                {page.status === "conflict"
                  ? "这个文件有新的修改"
                  : "保存遇到问题"}
              </strong>
              <p>{page.error}</p>
            </div>
            <button
              onClick={action(async () => {
                const copy = await page.keepCopy();
                if (copy) {
                  await refresh();
                  setNotice("草稿已保留为副本");
                }
              })}
            >
              保留为副本
            </button>
            {page.status === "conflict" ? (
              <button onClick={action(page.reload)}>载入文件版本</button>
            ) : (
              <button onClick={action(page.retry)}>重试保存</button>
            )}
          </div>
        )}
        <div className="studio-scroll">
          {loading && (
            <div className="studio-loading">
              <Loader2 size={24} className="studio-spin" />
            </div>
          )}
          {view === "page" && page.draft ? (
            <article className="studio-editor-page">
              <textarea
                ref={titleRef}
                className="studio-page-title"
                aria-label="页面标题"
                placeholder="无标题"
                value={page.draft.title}
                rows={1}
                maxLength={1000}
                onChange={(event) =>
                  page.edit({ title: event.target.value.replaceAll("\n", "") })
                }
              />
              <CustomComponentsProvider
                components={page.record?.components ?? []}
              >
                <DocumentEditor
                  key={page.draft.id}
                  content={page.draft.content}
                  onChange={page.editContent}
                  onBrowseComponents={() =>
                    void navigate("components").catch(report)
                  }
                  minimal
                />
              </CustomComponentsProvider>
            </article>
          ) : (
            <div className="studio-library">
              <div className="studio-section-heading">
                <div>
                  <h1>{heading}</h1>
                </div>
                <div className="studio-section-actions">
                  {view === "projects" && (
                    <button
                      className="studio-button primary"
                      onClick={() => setDialog({ type: "project" })}
                    >
                      <Plus size={15} />
                      新建项目
                    </button>
                  )}
                  {view === "project" && project && (
                    <>
                      <button
                        className="studio-button"
                        onClick={action(importPage)}
                      >
                        <Upload size={15} />
                        导入
                      </button>
                      <button
                        className="studio-button"
                        disabled={!pages.length || busy}
                        aria-haspopup="menu"
                        onClick={(event) => {
                          const anchor = event.currentTarget;
                          setExportMenu((current) =>
                            current === anchor ? null : anchor,
                          );
                        }}
                      >
                        <ArrowUpRight size={15} />
                        导出网站
                      </button>
                      <button
                        className="studio-icon"
                        aria-label="当前目录操作"
                        aria-haspopup="menu"
                        onClick={(event) =>
                          showMenu(
                            currentFolder
                              ? folderTarget(currentFolder, project.id)
                              : projectTarget(project),
                            event.currentTarget,
                          )
                        }
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </>
                  )}
                  {view === "templates" && (
                    <button
                      disabled={!selectedProject}
                      className="studio-button primary"
                      onClick={() =>
                        setDialog({
                          type: "template",
                          record: blankTemplate(),
                          copy: true,
                        })
                      }
                    >
                      <Plus size={15} />
                      新建模板
                    </button>
                  )}
                  {view === "components" && (
                    <>
                      <button
                        className="studio-button"
                        disabled={!selectedProject}
                        onClick={action(async () => {
                          const result =
                            await desktop.invoke<CompiledComponent | null>(
                              "components:import",
                              selectedProject
                                ? { projectId: selectedProject }
                                : {},
                            );
                          if (result) {
                            await loadCatalog();
                            setNotice("组件已安装");
                          }
                        })}
                      >
                        <Upload size={15} />
                        导入组件
                      </button>
                      <button
                        className="studio-button primary"
                        disabled={!selectedProject}
                        onClick={action(async () => {
                          const result =
                            await desktop.invoke<CompiledComponent>(
                              "components:createExample",
                              selectedProject
                                ? { projectId: selectedProject }
                                : {},
                            );
                          await loadCatalog();
                          await viewComponent(result);
                        })}
                      >
                        <Plus size={15} />
                        新建组件
                      </button>
                    </>
                  )}
                </div>
              </div>
              {(view === "templates" || view === "components") && (
                <div className="studio-library-toolbar catalog-scope-controls">
                  <label>
                    定制项目
                    <select
                      aria-label="目录项目"
                      value={selectedProject ?? ""}
                      onChange={(event) => {
                        const id = event.target.value;
                        void (async () => {
                          if (!(await page.flush())) return;
                          selectedRef.current = id || null;
                          setSelectedProject(id || null);
                          setSelectedFolder(null);
                          if (id) await loadProjectContents(id);
                          await loadCatalog();
                        })().catch(report);
                      }}
                    >
                      <option value="">选择项目</option>
                      {projects.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    查看范围
                    <select
                      aria-label="目录范围"
                      value={catalogScope ?? "all"}
                      onChange={(event) =>
                        setCatalogScope(
                          event.target.value as CatalogReadOptions["scope"],
                        )
                      }
                    >
                      <option value="all">全部</option>
                      <option value="project">项目</option>
                      <option value="global">全局</option>
                      <option value="published">已发布</option>
                      <option value="builtin">内置</option>
                    </select>
                  </label>
                  {!selectedProject && <span>先选择项目，再创建或定制。</span>}
                </div>
              )}

              {view === "projects" && (
                <>
                  <div className="studio-library-toolbar">
                    <span />
                    <label className="studio-search">
                      <Search size={15} />
                      <input
                        aria-label="搜索项目"
                        placeholder="搜索项目"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                  </div>
                  {filteredProjects.length ? (
                    <div className="studio-project-grid">
                      {filteredProjects.map((item) => (
                        <div className="studio-project-card" key={item.id}>
                          <button
                            className="studio-card-open"
                            onClick={action(() => openProject(item.id))}
                          >
                            <span className="studio-folder-symbol">
                              <Folder size={21} strokeWidth={1.6} />
                            </span>
                            <h2>
                              {item.name}
                              {item.pinned && (
                                <Pin size={12} aria-label="已置顶" />
                              )}
                            </h2>
                            <p>{item.binding?.harness ?? "本地项目"}</p>
                            <footer>{shortDate(item.updatedAt)}</footer>
                          </button>
                          <button
                            className="studio-icon studio-row-menu"
                            aria-label={`${item.name}的操作`}
                            aria-haspopup="menu"
                            onClick={(event) =>
                              showMenu(projectTarget(item), event.currentTarget)
                            }
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="studio-empty">
                      <FolderOpen size={34} strokeWidth={1.2} />
                      <h2>{query ? "没有找到项目" : "创建一个项目"}</h2>
                      <p>
                        {query
                          ? "试试其他关键词。"
                          : "页面会按项目保存在这台设备上。"}
                      </p>
                      {!query && (
                        <button
                          className="studio-button primary"
                          onClick={() => setDialog({ type: "project" })}
                        >
                          <Plus size={15} />
                          新建项目
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              {view === "project" && (
                <>
                  <div className="studio-library-toolbar">
                    <button
                      className="studio-text-button"
                      onClick={action(() =>
                        desktop.invoke("fs:reveal", {
                          projectId: selectedProject,
                        }),
                      )}
                    >
                      <FolderOpen size={14} />
                      打开项目目录
                    </button>
                    <label className="studio-search">
                      <Search size={15} />
                      <input
                        aria-label="搜索页面"
                        placeholder="搜索页面"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                  </div>
                  {visibleEntries.length ? (
                    <div className="studio-page-list">
                      {visibleEntries.map(({ target, updatedAt }) => (
                        <div key={target.id} className="studio-page-list-row">
                          <button
                            className="studio-page-list-open"
                            onClick={action(() =>
                              target.kind === "folder"
                                ? openProject(target.projectId, target.id)
                                : openPage(target.id, target.projectId),
                            )}
                          >
                            <span className="studio-page-list-icon">
                              {target.kind === "folder" ? (
                                <Folder size={19} />
                              ) : (
                                <FileText size={19} />
                              )}
                            </span>
                            <strong>{target.title}</strong>
                            {target.pinned && (
                              <Pin size={12} aria-label="已置顶" />
                            )}
                            <time>{shortDate(updatedAt)}</time>
                          </button>
                          <button
                            className="studio-icon studio-row-menu"
                            aria-label={`${target.title}的操作`}
                            aria-haspopup="menu"
                            onClick={(event) =>
                              showMenu(target, event.currentTarget)
                            }
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="studio-empty">
                      <FilePlus2 size={30} strokeWidth={1.2} />
                      <h2>
                        {query
                          ? "没有匹配的内容"
                          : currentFolder
                            ? "文件夹为空"
                            : "从空白画布开始"}
                      </h2>
                      {!query && (
                        <button
                          className="studio-text-button"
                          onClick={action(() =>
                            beginNewPage(selectedProject!, selectedFolder),
                          )}
                        >
                          创建页面
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              {view === "templates" && (
                <>
                  <div className="studio-template-grid">
                    {templates.map((item, index) => (
                      <div
                        className="studio-template-card"
                        key={`${item.scope}:${item.id}:${item.version}`}
                      >
                        <button
                          className={`studio-template-art art-${index % 4}`}
                          aria-label={`查看模板 ${item.name} ${item.version} ${item.scope}`}
                          onClick={action(async () => {
                            const record = await desktop.invoke<LoadedTemplate>(
                              "templates:get",
                              {
                                id: item.id,
                                ...(selectedProject
                                  ? { projectId: selectedProject }
                                  : {}),
                              },
                            );
                            setDialog({
                              type: "template",
                              record,
                              copy: item.scope === "builtin",
                            });
                          })}
                        >
                          <div className="template-sheet">
                            <i />
                            <i />
                            <i />
                            <div />
                            <i />
                            <i />
                          </div>
                        </button>
                        <div className="studio-template-info">
                          <div>
                            <h2>{item.name}</h2>
                            <Scope value={item.scope} />
                          </div>
                          <p>{item.description}</p>
                          <button
                            className="studio-text-button"
                            disabled={!selectedProject}
                            onClick={() => void createPage(item.id, item)}
                          >
                            使用模板
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!selectedProject && (
                    <p className="studio-caption">
                      打开一个项目后，可以用模板创建页面。
                    </p>
                  )}
                </>
              )}
              {view === "components" && (
                <>
                  <div className="studio-library-toolbar">
                    <div className="studio-filter-tabs">
                      <button
                        className={componentFilter === "all" ? "active" : ""}
                        onClick={() => setComponentFilter("all")}
                      >
                        全部
                      </button>
                      <button
                        className={componentFilter === "custom" ? "active" : ""}
                        onClick={() => setComponentFilter("custom")}
                      >
                        自定义
                      </button>
                    </div>
                    <span />
                  </div>
                  <div className="studio-component-grid">
                    {componentFilter === "all" &&
                      catalog.builtin.map((item, index) => (
                        <button
                          className="studio-component-card"
                          key={item.kind}
                          onClick={action(() => viewComponent(item))}
                        >
                          <div
                            className={`studio-component-symbol symbol-${index % 4}`}
                          >
                            <span>
                              {
                                (
                                  {
                                    text: "T",
                                    image: "▧",
                                    table: "▦",
                                    callout: "!",
                                    toggle: "⌄",
                                    divider: "—",
                                    code: "{}",
                                    chart: "↗",
                                    database: "▦",
                                    metrics: "◴",
                                    playground: "⌁",
                                    gallery: "▧",
                                    bookmark: "↗",
                                  } as Record<string, string>
                                )[item.kind]
                              }
                            </span>
                          </div>
                          <div>
                            <h2>
                              {item.name}
                              <Scope value="builtin" />
                            </h2>
                            <p>{item.description}</p>
                            <footer>v{item.version ?? "1.0.0"}</footer>
                          </div>
                        </button>
                      ))}
                    {catalog.custom.map((item) => (
                      <button
                        className="studio-component-card"
                        key={`${item.id}@${item.version}:${item.scope}`}
                        onClick={action(() => viewComponent(item))}
                      >
                        <div className="studio-component-symbol symbol-3">
                          <Code2 size={26} />
                        </div>
                        <div>
                          <h2>
                            {item.name}
                            <Scope value={item.scope} />
                          </h2>
                          <p>{item.description}</p>
                          <footer>v{item.version}</footer>
                        </div>
                      </button>
                    ))}
                  </div>
                  {componentFilter === "custom" && !catalog.custom.length && (
                    <div className="studio-empty">
                      <Blocks size={33} strokeWidth={1.3} />
                      <h2>添加自己的组件</h2>
                      <p>导入本地组件包，或从一个可编辑的示例开始。</p>
                    </div>
                  )}
                </>
              )}
              {view === "settings" && (
                <div className="studio-settings">
                  <section>
                    <h2>
                      <HardDrive size={18} />
                      内容位置
                    </h2>
                    <p className="studio-path">{info?.home}</p>
                    <p>
                      项目、页面和快照保存在这个文件夹。可以选择已有内容库，也可以使用新目录。
                    </p>
                    <button
                      className="studio-button"
                      onClick={action(async () => {
                        if (!(await page.clear())) return;
                        const next = await desktop.invoke<DesktopInfo | null>(
                          "settings:chooseHome",
                        );
                        if (next) {
                          setInfo(next);
                          setSelectedProject(null);
                          selectedRef.current = null;
                          setSelectedFolder(null);
                          setContents({});
                          setExpandedProjects({});
                          setExpandedFolders({});
                          await refresh();
                          await loadCatalog();
                          setNotice("内容库已切换");
                        }
                      })}
                    >
                      选择内容库
                    </button>
                  </section>
                  <section>
                    <h2>
                      <Settings2 size={18} />
                      外观
                    </h2>
                    <div className="studio-choice-row">
                      <button
                        className={!dark ? "selected" : ""}
                        onClick={() => setDark(false)}
                      >
                        浅色
                      </button>
                      <button
                        className={dark ? "selected" : ""}
                        onClick={() => setDark(true)}
                      >
                        深色
                      </button>
                    </div>
                  </section>
                  <section>
                    <h2>
                      <Code2 size={18} />
                      连接 Agent
                    </h2>
                    <p>
                      默认通过文件和 CLI 操作各自项目。MCP
                      可作为按项目配置的可选入口。
                    </p>
                    <div className="studio-code-preview">
                      <code>
                        {info ? JSON.stringify(info.cli, null, 2) : ""}
                      </code>
                    </div>
                    <button
                      className="studio-button"
                      onClick={action(async () => {
                        await desktop.invoke("clipboard:write", {
                          text: JSON.stringify(info?.cli, null, 2),
                        });
                        setNotice("本地启动配置已复制");
                      })}
                    >
                      <Copy size={14} />
                      复制启动配置
                    </button>
                    <p className="studio-caption">
                      先创建或绑定项目，再把 projectId 传给命令。无需提前运行
                      Core 服务。
                    </p>
                  </section>
                  <section>
                    <h2>ShowAI</h2>
                    <p>
                      版本 {info?.version} ·{" "}
                      {info?.platform === "darwin" ? "macOS" : info?.platform} ·{" "}
                      {info?.packaged ? "桌面安装包" : "开发环境"}
                    </p>
                  </section>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      {notice && (
        <div className="studio-toast" role="status">
          <Check size={14} />
          {notice}
        </div>
      )}
      {exportMenu && (
        <LibraryContextMenu
          anchor={exportMenu}
          label="网站导出方式"
          onClose={() => setExportMenu(null)}
          items={[
            {
              label: "离线网站 · 打包组件",
              onSelect: () => void exportSite("bundled"),
            },
            {
              label: "联网网站 · 引用发布组件",
              onSelect: () => void exportSite("remote"),
            },
          ]}
        />
      )}
      {projectsMenu && (
        <LibraryContextMenu
          anchor={projectsMenu}
          label="项目列表操作"
          onClose={() => setProjectsMenu(null)}
          items={[
            {
              label: "新建项目",
              icon: <FolderPlus size={15} />,
              onSelect: () => setDialog({ type: "project" }),
            },
          ]}
        />
      )}
      {contextMenu && (
        <LibraryContextMenu
          anchor={contextMenu.anchor}
          label={`${contextMenu.target.title}的操作`}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "添加新页面",
              icon: <FilePlus2 size={15} />,
              onSelect: action(() =>
                beginNewPage(
                  contextMenu.target.projectId,
                  contextMenu.target.kind === "folder"
                    ? contextMenu.target.id
                    : contextMenu.target.parentId,
                ),
              ),
            },
            {
              label: "新文件夹",
              icon: <FolderPlus size={15} />,
              onSelect: () =>
                setDialog({
                  type: "folder",
                  projectId: contextMenu.target.projectId,
                  parentId:
                    contextMenu.target.kind === "folder"
                      ? contextMenu.target.id
                      : contextMenu.target.parentId,
                }),
            },
            {
              label: "重命名",
              icon: <Pencil size={15} />,
              onSelect: () =>
                setDialog({ type: "rename", target: contextMenu.target }),
            },
            {
              label: contextMenu.target.pinned ? "取消置顶" : "置顶",
              icon: contextMenu.target.pinned ? (
                <PinOff size={15} />
              ) : (
                <Pin size={15} />
              ),
              onSelect: action(() =>
                updateTarget(contextMenu.target, {
                  pinned: !contextMenu.target.pinned,
                }),
              ),
            },
            ...(contextMenu.pageTools
              ? [
                  {
                    label: "保存为模板",
                    separatorBefore: true,
                    icon: <LayoutTemplate size={15} />,
                    onSelect: action(async () => {
                      if (await page.flush())
                        setDialog({ type: "saveTemplate" });
                    }),
                  },
                  {
                    label: "复制页面",
                    icon: <Copy size={15} />,
                    onSelect: action(async () => {
                      if (!(await page.flush())) return;
                      const result = await desktop.invoke<LoadedPage>(
                        "pages:duplicate",
                        {
                          projectId: contextMenu.target.projectId,
                          pageId: contextMenu.target.id,
                        },
                      );
                      await openPage(
                        result.document.id,
                        contextMenu.target.projectId,
                      );
                      await refresh();
                    }),
                  },
                  {
                    label: "下载源文件",
                    onSelect: () => void exportPage("json"),
                  },
                  {
                    label: "引用已发布组件导出",
                    onSelect: () => void exportPage("html", "remote"),
                  },
                  {
                    label: "导出会话片段",
                    onSelect: () => void exportPage("inline"),
                  },
                  {
                    label: "在独立窗口打开",
                    onSelect: action(() =>
                      desktop.invoke("app:openPageWindow", {
                        projectId: contextMenu.target.projectId,
                        pageId: contextMenu.target.id,
                      }),
                    ),
                  },
                ]
              : []),
            {
              label: "删除",
              icon: <Trash2 size={15} />,
              danger: true,
              separatorBefore: true,
              onSelect: () =>
                setDialog({ type: "delete", target: contextMenu.target }),
            },
          ]}
        />
      )}
      {dialog?.type === "folder" && (
        <NameDialog
          title="新文件夹"
          inputLabel="文件夹名称"
          onClose={closeDialog}
          onSave={async (name) => {
            if (!(await page.flush())) return;
            const folder = await desktop.invoke<FolderMetadata>(
              "folders:create",
              { projectId: dialog.projectId, parentId: dialog.parentId, name },
            );
            setExpandedFolders((current) => ({
              ...current,
              ...(dialog.parentId ? { [dialog.parentId]: true } : {}),
            }));
            await openProject(dialog.projectId, folder.id);
            await refresh();
            setDialog(null);
          }}
        />
      )}
      {dialog?.type === "rename" && (
        <NameDialog
          title="重命名"
          inputLabel="名称"
          initialValue={dialog.target.title}
          onClose={closeDialog}
          onSave={async (name) => {
            if (await updateTarget(dialog.target, { name })) setDialog(null);
          }}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteDialog
          target={dialog.target}
          onClose={closeDialog}
          onDelete={() => deleteTarget(dialog.target)}
        />
      )}
      {dialog?.type === "project" && (
        <ProjectDialog
          project={dialog.project}
          onClose={closeDialog}
          onSave={async (name) => {
            const result = dialog.project
              ? await desktop.invoke<ProjectSummary>("projects:rename", {
                  projectId: dialog.project.id,
                  name,
                })
              : await desktop.invoke<ProjectSummary>("projects:create", {
                  name,
                });
            await refresh();
            await openProject(result.id);
            setDialog(null);
          }}
        />
      )}
      {dialog?.type === "newPage" && (
        <Dialog title="新页面" onClose={closeDialog}>
          <div className="studio-template-picker">
            {dialog.templates.map((item) => (
              <button
                key={`${item.scope}:${item.id}:${item.version}`}
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
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                </div>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {dialog?.type === "publish" && (
        <PublishDialog
          refValue={dialog.ref}
          projectId={selectedProject ?? undefined}
          onClose={closeDialog}
          onPublished={async () => {
            await loadCatalog();
            setDialog(null);
            setNotice("发布版本已验证并登记");
          }}
        />
      )}
      {dialog?.type === "template" && (
        <TemplateDialog
          key={`${dialog.record.id}:${dialog.record.version}:${dialog.record.scope}`}
          record={dialog.record}
          copy={dialog.copy}
          components={dialog.record.components ?? []}
          templates={templates}
          onPublish={(ref) => setDialog({ type: "publish", ref })}
          projectId={selectedProject ?? undefined}
          onClose={closeDialog}
          onSaved={async () => {
            await loadCatalog();
            setDialog(null);
            setNotice("模板目录已更新");
          }}
        />
      )}
      {dialog?.type === "saveTemplate" && page.draft && (
        <TemplateDialog
          record={{
            ...blankTemplate(),
            name: page.draft.title || "新模板",
            document: page.draft,
          }}
          components={page.record?.components ?? []}
          templates={templates}
          onPublish={(ref) => setDialog({ type: "publish", ref })}
          projectId={selectedProject ?? undefined}
          onClose={closeDialog}
          onSaved={async () => {
            await loadCatalog();
            setDialog(null);
            setNotice("页面已保存为模板");
          }}
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
          source={dialog.source}
          canInsert={!!page.draft && page.projectId === selectedProject}
          onPublish={(ref) => setDialog({ type: "publish", ref })}
          projectId={selectedProject ?? undefined}
          onInsert={addBlock}
          onClose={closeDialog}
          onSaved={async (component) => {
            await loadCatalog();
            await viewComponent(component);
            setNotice("组件目录已更新");
          }}
        />
      )}
    </div>
  );
}

function NameDialog({
  title,
  inputLabel,
  initialValue = "",
  onClose,
  onSave,
}: {
  title: string;
  inputLabel: string;
  initialValue?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          setError("");
          void onSave(name.trim())
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {inputLabel}
          <input
            aria-label={inputLabel}
            value={name}
            maxLength={1000}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="studio-button primary"
            disabled={!name.trim() || busy}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}
            {initialValue ? "保存" : "创建"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  target,
  onClose,
  onDelete,
}: {
  target: LibraryTarget;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      title={`删除${target.kind === "project" ? "项目" : target.kind === "folder" ? "文件夹" : "页面"}`}
      onClose={onClose}
    >
      <div className="studio-form">
        <p className="studio-delete-description">
          删除「{target.title}」？
          {target.kind !== "page" && "其中的页面和子文件夹也会从列表中移除。"}
        </p>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" onClick={onClose}>
            取消
          </button>
          <button
            className="studio-button danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onDelete()
                .catch((reason) => setError(errorMessage(reason)))
                .finally(() => setBusy(false));
            }}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}删除
          </button>
        </footer>
      </div>
    </Dialog>
  );
}

function ProjectDialog({
  project,
  onClose,
  onSave,
}: {
  project?: ProjectSummary;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog title={project ? "项目名称" : "新建项目"} onClose={onClose}>
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void onSave(name.trim())
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          名称
          <input
            aria-label="项目名称"
            placeholder="例如：多模态模型调研"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={1000}
          />
        </label>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="studio-button" onClick={onClose}>
            取消
          </button>
          <button
            className="studio-button primary"
            disabled={!name.trim() || busy}
          >
            {busy ? <Loader2 size={15} className="studio-spin" /> : null}
            {project ? "保存" : "创建项目"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
