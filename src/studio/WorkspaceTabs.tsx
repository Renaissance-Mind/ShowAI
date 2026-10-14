import { useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Folder,
  History,
  LayoutTemplate,
  Plus,
  Settings2,
  X,
} from "../ui/icons";
import PageIcon from "../components/PageIcon";
import { currentEntry, type WorkspaceTabsState } from "./workspace-tabs";
import "./workspace-tabs.css";
import { useTranslator } from "../i18n/react";
import sidebarMessages from "../i18n/messages/sidebar";

export function WorkspaceHistory({
  busy,
  canBack,
  canForward,
  onStep,
}: {
  busy: boolean;
  canBack: boolean;
  canForward: boolean;
  onStep: (offset: number) => void;
}) {
  const t = useTranslator(sidebarMessages);
  return (
    <div className="studio-tab-history" aria-label={t("tabHistory")}>
      <button
        type="button"
        aria-label={t("back")}
        title={t("back")}
        disabled={busy || !canBack}
        onClick={() => onStep(-1)}
      >
        <ArrowLeft size={16} />
      </button>
      <button
        type="button"
        aria-label={t("forward")}
        title={t("forward")}
        disabled={busy || !canForward}
        onClick={() => onStep(1)}
      >
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

export default function WorkspaceTabs({
  tabs,
  activeId,
  busy,
  onSelect,
  onClose,
  onAdd,
}: WorkspaceTabsState & {
  busy: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}) {
  const t = useTranslator(sidebarMessages);
  const list = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);
  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    list.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus();
  }, [activeId, busy, tabs.length]);

  return (
    <div className="studio-tabs-bar">
      <div
        ref={list}
        className="studio-tabs"
        role="tablist"
        aria-label={t("workspaceTabs")}
      >
        {tabs.map((tab, index) => {
          const entry = currentEntry(tab);
          const view = entry.location.view;
          const Icon =
            view === "projects"
              ? History
              : view === "templates"
                ? LayoutTemplate
                : view === "components"
                  ? Blocks
                  : view === "settings"
                    ? Settings2
                    : Folder;
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className="studio-tab"
              data-active={active || undefined}
            >
              <button
                type="button"
                role="tab"
                id={`workspace-tab-${tab.id}`}
                aria-selected={active}
                aria-controls="studio-tab-panel"
                tabIndex={active ? 0 : -1}
                disabled={busy}
                title={entry.title}
                onClick={() => {
                  restoreFocus.current = true;
                  onSelect(tab.id);
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onClose(tab.id);
                  }
                }}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + tabs.length) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    restoreFocus.current = true;
                    onSelect(tabs[next].id);
                  } else if (event.key === "Delete") {
                    event.preventDefault();
                    restoreFocus.current = true;
                    onClose(tab.id);
                  }
                }}
              >
                <PageIcon
                  value={entry.icon}
                  size={15}
                  fallback={view === "page" ? undefined : <Icon size={15} />}
                />
                <span>{entry.title}</span>
              </button>
              <button
                type="button"
                className="studio-tab-close"
                tabIndex={active ? 0 : -1}
                disabled={busy}
                aria-label={t("closeTabNamed", { title: entry.title })}
                title={t("closeTab")}
                onClick={() => {
                  restoreFocus.current = true;
                  onClose(tab.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="studio-tab-add"
        disabled={busy}
        aria-label={t("newTab")}
        title={t("newTabShortcut")}
        onClick={() => {
          restoreFocus.current = true;
          onAdd();
        }}
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
