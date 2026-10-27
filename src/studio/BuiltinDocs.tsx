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
import type { CompiledComponent } from "../components/custom/types";
import SurfaceEditor from "../surface/SurfaceEditor";
import type { ShowDocument } from "../types";
import { useLocale, useTranslator } from "../i18n/react";
import sidebarMessages from "../i18n/messages/sidebar";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
} from "../ui/icons";
import { errorMessage } from "./bridge";
import {
  NAVIGATE_EVENT,
  type NavigationDetail,
} from "../portable/page-link.mjs";
import {
  builtinDocLink,
  builtinDocPath,
  builtinDocs,
  loadBuiltinDoc,
  WELCOME_DOC,
  type DocsEntry,
} from "./builtin-docs";
import PageHeading from "./PageHeading";
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

/** Title and icon of a documentation entry, including the first-run page. */
export function useBuiltinDocTitle() {
  const locale = useLocale();
  const t = useTranslator(sidebarMessages);
  return (id: string) =>
    id === WELCOME_DOC
      ? { title: t("docs.welcome"), icon: "👋" }
      : (builtinDocs(locale).pages[id] ?? { title: t("docs.title"), icon: "" });
}

/**
 * The documentation folder pinned under "Add" in the sidebar. It starts collapsed;
 * its folders open and close like library folders and the state is kept per App.
 */
export function DocsNavigation({
  activeId,
  onOpen,
}: {
  activeId: string | null;
  onOpen: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const locale = useLocale();
  const t = useTranslator(sidebarMessages);
  const docs = builtinDocs(locale);
  const title = useBuiltinDocTitle();
  const [expanded, setExpanded] = useState(readExpanded);
  // A page inside closed folders marks the outermost closed one, without opening anything.
  const closedAncestor = !activeId
    ? null
    : !expanded.root
      ? "root"
      : activeId === WELCOME_DOC
        ? null
        : ((builtinDocPath(locale, activeId) ?? []).find(
            (folder) => !expanded[folder.id],
          )?.id ?? null);
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = { ...current, [id]: !current[id] };
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
      return next;
    });
  const row = (
    key: string,
    depth: ReactNode,
    main: ReactNode,
    active = false,
  ) => (
    <div
      key={key}
      className={`studio-tree-row${active ? " active" : ""}`}
      data-docs-id={key}
    >
      {depth}
      {main}
    </div>
  );
  const chevron = (id: string, name: string) => (
    <button
      type="button"
      className="studio-tree-chevron"
      aria-label={t(expanded[id] ? "collapseItem" : "expandItem", {
        title: name,
      })}
      aria-expanded={!!expanded[id]}
      onClick={() => toggle(id)}
    >
      {expanded[id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  );
  const page = (id: string) => {
    const meta = title(id);
    return row(
      id,
      <span className="studio-tree-chevron" aria-hidden="true" />,
      <button
        type="button"
        className="studio-tree-main"
        aria-current={activeId === id ? "page" : undefined}
        title={meta.title}
        onClick={(event) => onOpen(id, event)}
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          onOpen(id, event);
        }}
      >
        <PageIcon value={meta.icon} size={15} />
        <span className="studio-tree-title">{meta.title}</span>
      </button>,
      activeId === id,
    );
  };
  const entries = (items: DocsEntry[]): ReactNode =>
    items.map((entry) =>
      entry.type === "page" ? (
        page(entry.id)
      ) : (
        <div key={entry.id}>
          {row(
            entry.id,
            chevron(entry.id, entry.name),
            <button
              type="button"
              className="studio-tree-main"
              title={entry.name}
              onClick={() => toggle(entry.id)}
            >
              {entry.icon ? (
                <PageIcon value={entry.icon} size={15} />
              ) : expanded[entry.id] ? (
                <FolderOpen size={15} aria-hidden="true" />
              ) : (
                <Folder size={15} aria-hidden="true" />
              )}
              <span className="studio-tree-title">{entry.name}</span>
            </button>,
            closedAncestor === entry.id,
          )}
          {expanded[entry.id] && (
            <div className="studio-tree-children">
              {entries(entry.children)}
            </div>
          )}
        </div>
      ),
    );
  return (
    <section className="studio-docs" aria-label={docs.name}>
      {row(
        "root",
        chevron("root", docs.name),
        <button
          type="button"
          className="studio-tree-main"
          title={docs.name}
          aria-expanded={!!expanded.root}
          onClick={() => toggle("root")}
        >
          <PageIcon value={docs.icon} size={15} />
          <span className="studio-tree-title">{docs.name}</span>
        </button>,
        closedAncestor === "root",
      )}
      {expanded.root && (
        <div className="studio-tree-children">
          {page(WELCOME_DOC)}
          {entries(docs.tree)}
        </div>
      )}
    </section>
  );
}

/** Folder names above a documentation page, for the breadcrumb. */
export function useBuiltinDocFolders(id: string | null) {
  const locale = useLocale();
  return id && id !== WELCOME_DOC
    ? (builtinDocPath(locale, id) ?? []).map((folder) => folder.name)
    : [];
}

/** A documentation page in the native read-only editor; links to other docs stay in the App. */
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
    // Components run in frames; their links reach the page as this event.
    const component = (event: Event) => {
      const url = (event as CustomEvent<{ url?: unknown }>).detail?.url;
      const target = typeof url === "string" ? builtinDocLink(url) : undefined;
      if (!target) return;
      event.preventDefault();
      latest.current(target.pageId, target.hash, false);
    };
    // In-page targets from components stay in this document, not the library page behind it.
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
  return (
    <div ref={root} className="studio-builtin-doc" data-builtin-doc={id}>
      {loaded ? (
        <CustomComponentsProvider components={loaded.components}>
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
