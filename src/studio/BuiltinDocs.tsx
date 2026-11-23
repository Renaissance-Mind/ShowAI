import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import PageIcon from "../components/PageIcon";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import type { CompiledComponent } from "../contract/types";
import SurfaceEditor from "../surface/SurfaceEditor";
import type { ShowDocument } from "../types";
import { useLocale, useTranslator } from "../i18n/react";
import sidebarMessages from "../i18n/messages/sidebar";
import { Folder, FolderOpen, Loader2 } from "../ui/icons";
import { errorMessage } from "../host/bridge";
import {
  NAVIGATE_EVENT,
  type NavigationDetail,
} from "../document/page-link.mjs";
import {
  builtinDocLink,
  builtinDocPath,
  builtinDocs,
  loadBuiltinDoc,
  DOCS_HOME,
  WELCOME_DOC,
  type DocsEntry,
} from "./builtin-docs";
import PageHeading from "./PageHeading";
import { ReaderStateContext, readerStateStore } from "../surface/reader-state";
import "./builtin-docs.css";

const EXPANDED_KEY = "showai:builtin-docs-expanded";

function readExpanded(): Record<string, boolean> {
  let saved: unknown = null;
  try {
    saved = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "null");
  } catch (error) {
    console.warn("Could not read the documentation folder state", error);
  }
  return saved && typeof saved === "object" && !Array.isArray(saved)
    ? (saved as Record<string, boolean>)
    : {};
}

export function useBuiltinDocTitle() {
  const locale = useLocale();
  const t = useTranslator(sidebarMessages);
  return (id: string) =>
    id === WELCOME_DOC
      ? { title: t("docs.welcome"), icon: "👋" }
      : (builtinDocs(locale).pages[id] ?? { title: t("docs.title"), icon: "" });
}

export function useDocsExpansion() {
  const [expanded, setExpanded] = useState(readExpanded);
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = { ...current, [id]: !current[id] };
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
      return next;
    });
  return { expanded, toggle };
}

export function DocsNavigation({
  activeId,
  onOpen,
  expanded,
  toggle,
}: ReturnType<typeof useDocsExpansion> & {
  activeId: string | null;
  onOpen: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const locale = useLocale();
  const t = useTranslator(sidebarMessages);
  const docs = builtinDocs(locale);
  const title = useBuiltinDocTitle();
  const closedAncestor =
    activeId && activeId !== WELCOME_DOC
      ? builtinDocPath(locale, activeId)?.find((folder) => !expanded[folder.id])
          ?.id
      : undefined;
  const row = (
    key: string,
    main: ReactNode,
    active: boolean,
    children?: ReactNode,
  ) => (
    <div key={key} className="studio-docs-entry">
      <div
        className={`studio-tree-row${active ? " active" : ""}`}
        data-docs-id={key}
      >
        {main}
      </div>
      {children}
    </div>
  );
  const page = (id: string) => {
    const meta = title(id);
    const label = id === DOCS_HOME ? t("docs.home") : meta.title;
    return row(
      id,
      <button
        type="button"
        className="studio-tree-main"
        aria-current={activeId === id ? "page" : undefined}
        title={label}
        onClick={(event) => onOpen(id, event)}
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          onOpen(id, event);
        }}
      >
        <PageIcon value={meta.icon} size={15} />
        <span className="studio-tree-title">{label}</span>
      </button>,
      activeId === id,
    );
  };
  const entries = (items: DocsEntry[]): ReactNode =>
    items.map((entry) => {
      if (entry.type === "page") return page(entry.id);
      const open = !!expanded[entry.id];
      const Icon = open ? FolderOpen : Folder;
      return row(
        entry.id,
        <button
          type="button"
          className="studio-tree-main"
          title={entry.name}
          aria-expanded={open}
          onClick={() => toggle(entry.id)}
        >
          <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
          <span className="studio-tree-title">{entry.name}</span>
        </button>,
        closedAncestor === entry.id,
        open && (
          <div
            className="studio-docs-children"
            role="group"
            aria-label={entry.name}
          >
            {entries(entry.children)}
          </div>
        ),
      );
    });
  return (
    <section
      id="studio-docs-navigation"
      className="studio-docs"
      aria-label={docs.name}
    >
      {page(WELCOME_DOC)}
      {entries(docs.tree)}
    </section>
  );
}

export function useBuiltinDocFolders(id: string | null) {
  const locale = useLocale();
  return id && id !== WELCOME_DOC
    ? (builtinDocPath(locale, id) ?? []).map((folder) => folder.name)
    : [];
}

export function BuiltinDocPage({
  id,
  hash,
  onOpenDoc,
}: {
  id: string;
  hash?: string;
  onOpenDoc: (id: string, hash: string, newTab: boolean) => void;
}) {
  const locale = useLocale();
  const [state, setState] = useState<
    | { document: ShowDocument; components: CompiledComponent[] }
    | { error: string }
    | null
  >(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(onOpenDoc);
  latest.current = onOpenDoc;
  useEffect(() => {
    let active = true;
    setState(null);
    loadBuiltinDoc(locale, id).then(
      (loaded) => active && setState(loaded),
      (reason) => active && setState({ error: errorMessage(reason) }),
    );
    return () => {
      active = false;
    };
  }, [locale, id]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const click = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button > 1) return;
      const anchor = event
        .composedPath()
        .find(
          (entry): entry is HTMLAnchorElement =>
            entry instanceof HTMLAnchorElement && entry.hasAttribute("href"),
        );
      const target = anchor && builtinDocLink(anchor.href);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current(
        target.pageId,
        target.hash,
        event.button === 1 || event.metaKey || event.ctrlKey,
      );
    };
    const component = (event: Event) => {
      const url = (event as CustomEvent<{ url?: unknown }>).detail?.url;
      const target = typeof url === "string" ? builtinDocLink(url) : undefined;
      if (!target) return;
      event.preventDefault();
      latest.current(target.pageId, target.hash, false);
    };
    const navigate = (event: Event) => {
      const target = (event as CustomEvent<NavigationDetail>).detail?.target;
      if (!target || target.pageId) return;
      event.preventDefault();
      event.stopPropagation();
      element
        .querySelector(
          `[data-block-id="${CSS.escape(target.blockIds[0] ?? "")}"]`,
        )
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    element.addEventListener("click", click, true);
    element.addEventListener("auxclick", click, true);
    element.addEventListener("showai:component-link", component);
    element.addEventListener(NAVIGATE_EVENT, navigate);
    return () => {
      element.removeEventListener("click", click, true);
      element.removeEventListener("auxclick", click, true);
      element.removeEventListener("showai:component-link", component);
      element.removeEventListener(NAVIGATE_EVENT, navigate);
    };
  }, []);
  const loaded = state && "document" in state ? state : null;
  useEffect(() => {
    if (!loaded || !hash) return;
    const target = decodeURIComponent(hash.replace(/^#/, ""));
    let attempts = 0;
    const timer = setInterval(() => {
      const element = root.current?.querySelector(
        `[id="${CSS.escape(target)}"]`,
      );
      if (element) element.scrollIntoView({ block: "start" });
      if (element || ++attempts > 20) clearInterval(timer);
    }, 80);
    return () => clearInterval(timer);
  }, [loaded, hash]);
  const ignore = useMemo(() => () => {}, []);
  const readerState = useMemo(
    () => ({ page: `docs/${id}`, store: readerStateStore() }),
    [id],
  );
  return (
    <div ref={root} className="studio-builtin-doc" data-builtin-doc={id}>
      {loaded ? (
        <CustomComponentsProvider components={loaded.components}>
          <ReaderStateContext.Provider value={readerState}>
            <SurfaceEditor
              key={loaded.document.id}
              document={loaded.document}
              readOnly
              onChange={ignore}
              header={
                <PageHeading
                  title={loaded.document.title}
                  icon={loaded.document.icon}
                  readOnly
                  onTitleChange={ignore}
                  onEditIcon={ignore}
                />
              }
            />
          </ReaderStateContext.Provider>
        </CustomComponentsProvider>
      ) : state && "error" in state ? (
        <p className="studio-builtin-doc-error" role="alert">
          {state.error}
        </p>
      ) : (
        <div className="studio-loading">
          <Loader2 size={24} className="studio-spin" />
        </div>
      )}
    </div>
  );
}
