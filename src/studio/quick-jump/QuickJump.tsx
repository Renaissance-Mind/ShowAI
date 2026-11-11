import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import PageIcon from "../../components/PageIcon";
import {
  Blocks,
  ChevronRight,
  FileText,
  Folder,
  Layers,
  Search,
} from "../../ui/icons";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/quickJump";
import commonMessages from "../../i18n/messages/common";
import { useComponentCatalog } from "../../components/useComponentCatalog";
import {
  INSERT_COMPONENT_EVENT,
  type InsertComponentDetail,
} from "../../components/slash-menu-model";
import { flushSync } from "react-dom";
import { componentWidgetData } from "../../components/custom/contract";
import { requestNavigation } from "../../portable/page-link.mjs";
import type { SearchResult } from "../../core/library-index";
import type { ProjectSummary } from "../../core/model";
import type { EditorControls } from "../../surface/EditorControls";
import { desktop } from "../bridge";
import { clientIsMac, formatShortcut } from "../keyboard-shortcuts";
import {
  QuickJumpRegistry,
  flattenGroups,
  type QuickJumpGroup,
  type QuickJumpIcon,
  type QuickJumpRow,
} from "./registry";
import {
  builtinSources,
  type QuickJumpContext,
  type WorkbenchCommand,
} from "./sources";
import "./quick-jump.css";

/** The built-in sources; other contributors register here too. */
export const quickJumpSources = new QuickJumpRegistry<QuickJumpContext>(
  builtinSources,
);

const icons: Record<QuickJumpIcon, ReactNode> = {
  page: <FileText size={16} />,
  board: <FileText size={16} />,
  folder: <Folder size={16} />,
  project: <Layers size={16} />,
  content: <Search size={16} />,
  command: <ChevronRight size={16} />,
  component: <Blocks size={16} />,
};

export default function QuickJump({
  projects,
  pages,
  commands,
  editor,
  openDirectory,
  onClose,
  onError,
}: {
  projects: readonly ProjectSummary[];
  pages: QuickJumpContext["pages"];
  commands: readonly WorkbenchCommand[];
  /** The open page or board, when it is editable. */
  editor?: Pick<EditorControls, "kind" | "insertComponent">;
  openDirectory: QuickJumpContext["openDirectory"];
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const catalog = useComponentCatalog(true);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<QuickJumpGroup[]>([]);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const latestQuery = useRef("");
  latestQuery.current = query;
  // The workbench re-renders often; the dialog keeps the commands it opened
  // with and reads its callbacks through refs, so typing alone re-ranks.
  const [openedCommands] = useState(commands);
  const latest = useRef({ resolve: catalog.resolve, openDirectory, onError });
  latest.current = { resolve: catalog.resolve, openDirectory, onError };
  // Read while rendering, before the input takes focus (effects run twice in development).
  if (previous.current === null)
    previous.current = document.activeElement as HTMLElement | null;
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  const restoreFocus = () =>
    previous.current?.isConnected &&
    previous.current.focus({ preventScroll: true });
  // The dialog is gone and focus is back where it was when this returns,
  // inside the key or click handler, as the "/" menu leaves things.
  const close = () => {
    flushSync(onClose);
    restoreFocus();
  };

  const context = useMemo<QuickJumpContext>(
    () => ({
      projects,
      pages,
      commands: openedCommands,
      components: catalog.items,
      canInsert: !!editor,
      labels: {
        pages: t("group.pages"),
        folders: t("group.folders"),
        projects: t("group.projects"),
        content: t("group.content"),
        commands: t("group.commands"),
        components: t("group.components"),
      },
      // Typing pauses before the full-text index is asked.
      searchContent: (value) =>
        new Promise<void>((resolve) => setTimeout(resolve, 160)).then(() =>
          latestQuery.current.trim() !== value
            ? []
            : desktop
                .invoke<{ items: SearchResult[] }>("library:search", {
                  query: value,
                  kind: "page",
                  limit: 12,
                })
                .then((result) => result.items),
        ),
      openPage: (target) => {
        requestNavigation(window, target);
      },
      openDirectory: (projectId, folderId) =>
        latest.current.openDirectory(projectId, folderId),
      insert: async (component, props) => {
        if (!editor) return;
        const value = await latest.current.resolve(component);
        const data = props
          ? value.component
            ? componentWidgetData(value.component, props(value.component))
            : structuredClone(
                props(component as Parameters<typeof props>[0]),
              )
          : value.data;
        // The rich-text editor with the caret inserts there, as its "/" menu
        // does; a page without a caret takes it at the end of its text flow;
        // a board places it after its selection.
        const request = (target: Element, at: "selection" | "end") =>
          !target.dispatchEvent(
            new CustomEvent<InsertComponentDetail>(INSERT_COMPONENT_EVENT, {
              bubbles: true,
              cancelable: true,
              detail: {
                kind: value.kind,
                data,
                native: value.native,
                at,
                ...(value.component ? { component: value.component } : {}),
              },
            }),
          );
        if (request(document.activeElement ?? document.body, "selection"))
          return;
        const flow =
          editor.kind === "page"
            ? [
                ...document.querySelectorAll<HTMLElement>(
                  ".container-workspace .ProseMirror",
                ),
              ].find((node) => node.offsetParent !== null)
            : undefined;
        if (flow && request(flow, "end")) return;
        editor.insertComponent(value.kind, data, value.component);
      },
    }),
    [projects, pages, openedCommands, catalog.items, editor, t],
  );
  useEffect(
    () =>
      quickJumpSources.search(query, context, setGroups, (error) =>
        latest.current.onError(error),
      ),
    [query, context],
  );
  useEffect(() => setSelected(0), [query]);
  const rows = flattenGroups(groups);
  const current = rows[Math.min(selected, rows.length - 1)];
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [current?.source, current?.item.key]);

  const run = (row: QuickJumpRow) => {
    if (row.item.disabled) return;
    close();
    void Promise.resolve()
      .then(() => quickJumpSources.run(row, context))
      .catch(latest.current.onError);
  };
  const mac = clientIsMac();
  let index = -1;
  return (
    <div
      className="studio-modal-shade quick-jump-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("dialog")}
        className="studio-modal quick-jump"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          // ⌘K again closes, like Escape.
          if (
            event.key === "Escape" ||
            ((mac ? event.metaKey : event.ctrlKey) &&
              event.key.toLowerCase() === "k")
          ) {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const count = rows.length;
            if (!count) return;
            const step = event.key === "ArrowDown" ? 1 : -1;
            setSelected((value) => (Math.min(value, count - 1) + step + count) % count);
            return;
          }
          if (event.key === "Enter" && current) {
            event.preventDefault();
            run(current);
            return;
          }
          if (event.key === "Tab") event.preventDefault();
        }}
      >
        <div className="quick-jump-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              current ? `${listId}-${current.source}-${current.item.key}` : undefined
            }
            aria-label={t("dialog")}
            placeholder={t("placeholder")}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={t("results")}
          className="quick-jump-results"
        >
          {!rows.length && query.trim() && (
            <p className="quick-jump-empty">{t("none")}</p>
          )}
          {groups.map((group) => (
            <div key={group.source} role="group" aria-label={group.label}>
              <div className="quick-jump-group" aria-hidden="true">
                {group.label}
              </div>
              {group.rows.map((row) => {
                index++;
                const position = index;
                const active = row === current;
                return (
                  <div
                    key={row.item.key}
                    id={`${listId}-${row.source}-${row.item.key}`}
                    role="option"
                    aria-selected={active}
                    aria-disabled={row.item.disabled || undefined}
                    className={`quick-jump-row${active ? " is-selected" : ""}`}
                    onMouseMove={() => {
                      if (!active) setSelected(position);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(row)}
                  >
                    <span className="quick-jump-icon" aria-hidden="true">
                      {row.item.emoji ? (
                        <PageIcon
                          value={row.item.emoji}
                          size={16}
                          fallback={icons[row.item.icon]}
                        />
                      ) : (
                        icons[row.item.icon]
                      )}
                    </span>
                    <span className="quick-jump-text">
                      <span className="quick-jump-title">
                        {row.item.title || tc("untitled")}
                      </span>
                      {row.item.path && (
                        <span className="quick-jump-path">{row.item.path}</span>
                      )}
                    </span>
                    {row.item.shortcut && (
                      <kbd className="quick-jump-shortcut">
                        {formatShortcut(row.item.shortcut, mac)}
                      </kbd>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export type { WorkbenchCommand } from "./sources";
