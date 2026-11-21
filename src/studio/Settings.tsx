import { readSessionDraft, writeSessionDraft } from "./session-draft";
import { useEffect, useState } from "react";
import { pluginNeedsUpdate, usePluginHosts } from "./usePluginHosts";
import {
  Bot,
  ChevronLeft,
  Cloud,
  Puzzle,
  Folder,
  Info,
  Keyboard,
  Monitor,
  Moon,
  Search,
  Settings2,
  Sun,
  Globe,
} from "../ui/icons";
import Select from "../ui/Select";
import { appIconForTheme } from "../design/app-icon";
import type { DesktopInfo } from "../host/protocol";
import type { AppearancePreference } from "../design/appearance-preference";
import {
  isLanguagePreference,
  LOCALE_NAMES,
  LOCALES,
  setLanguagePreference,
} from "../i18n";
import { useLanguagePreference, useTranslator } from "../i18n/react";
import messages from "../i18n/messages/settings";
import "./settings.css";
import { SettingsPath } from "./SettingsPath";
import LibrarySpace from "./LibrarySpace";
import SyncSettings, { type ProjectSyncRequest } from "./SyncSettings";
import AgentSettings from "./AgentSettings";
import WorkRecordsSettings from "./WorkRecordsSettings";
import PluginInstallSettings from "./PluginInstallSettings";
import RemoteMcpSettings from "./RemoteMcpSettings";
import ShortcutsPanel from "./ShortcutsPanel";
import remoteMcpMessages from "../i18n/messages/remoteMcp";
import { workbenchCapabilities } from "./capabilities";
import { AboutFeedback, type FeedbackRequest } from "./feedback/AboutFeedback";

const SHORTCUTS_EVENT = "showai:settings-shortcuts";
const SHORTCUTS_DRAFT_KEY = "settings.subpage";

const sections = [
  {
    id: "general",
    group: "workspace",
    label: "section.general",
    icon: Settings2,
  },
  {
    id: "appearance",
    group: "workspace",
    label: "section.appearance",
    icon: Sun,
  },
  {
    id: "sync",
    group: "workspace",
    label: "section.sync",
    icon: Cloud,
  },
  {
    id: "projects",
    group: "workspace",
    label: "section.projects",
    icon: Folder,
  },
  {
    id: "agent",
    group: "agent",
    label: "section.agent",
    icon: Bot,
  },
  {
    id: "plugins",
    group: "agent",
    label: "section.plugins",
    icon: Puzzle,
  },
  {
    id: "remote",
    group: "agent",
    label: "section.remote",
    icon: Globe,
  },
  {
    id: "about",
    group: "support",
    label: "section.about",
    icon: Info,
  },
] as const;

const navGroups = [
  { id: "workspace", label: "navGroup.workspace" },
  { id: "agent", label: "navGroup.agent" },
  { id: "support", label: "navGroup.support" },
] as const;

export type SettingsSection = (typeof sections)[number]["id"];

export function availableSettingsSection(
  section: SettingsSection,
  platform?: string,
): SettingsSection {
  const capabilities = workbenchCapabilities(platform);
  return (section === "general" && !capabilities.manageLibrary) ||
    ((section === "plugins" || section === "remote") &&
      !capabilities.localPlugins)
    ? "sync"
    : section;
}

export function SettingsNavigation({
  section,
  onSelect,
  platform,
  pluginHome,
}: {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  platform?: string;
  pluginHome?: string;
}) {
  const t = useTranslator(messages);
  const { hosts } = usePluginHosts(pluginHome ?? null);
  const updates = hosts.filter(pluginNeedsUpdate).length;
  const visible = sections.filter(
    ({ id }) => availableSettingsSection(id, platform) === id,
  );
  return (
    <div className="settings-category-sidebar">
      <nav className="settings-nav-groups" aria-label={t("categories")}>
        {navGroups.map((group) => {
          const items = visible.filter((item) => item.group === group.id);
          if (!items.length) return null;
          return (
            <div className="settings-nav-group" key={group.id}>
              <div className="settings-nav-label">{t(group.label)}</div>
              <div className="settings-nav">
                {items.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={t(label)}
                    aria-description={
                      id === "plugins" && updates > 0
                        ? t("pluginUpdates", { count: updates })
                        : undefined
                    }
                    aria-current={section === id ? "page" : undefined}
                    onClick={() => {
                      writeSessionDraft(SHORTCUTS_DRAFT_KEY, "");
                      window.dispatchEvent(new Event(SHORTCUTS_EVENT));
                      onSelect(id);
                    }}
                  >
                    <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                    <span>{t(label)}</span>
                    {id === "plugins" && updates > 0 && (
                      <span className="settings-nav-updates" aria-hidden="true">
                        {updates}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

export function SettingsSearch({
  platform,
  onSelect,
}: {
  platform?: string;
  onSelect: (section: SettingsSection) => void;
  onShortcuts?: () => void;
}) {
  const t = useTranslator(messages);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const hasGeneral = availableSettingsSection("general", platform) === "general";
  const options: Array<{
    id: SettingsSection;
    name: string;
    category: string;
    target: string;
  }> = sections
    .filter(({ id }) => availableSettingsSection(id, platform) === id)
    .map(({ id, label }) => ({
      id,
      name: t(label),
      category: "",
      target: "",
    }));
  options.push(
    {
      id: "appearance",
      name: t("theme"),
      category: t("section.appearance"),
      target: "settings-theme-title",
    },
    {
      id: "appearance",
      name: t("language"),
      category: t("section.appearance"),
      target: "settings-language",
    },
    {
      id: hasGeneral ? "general" : "appearance",
      name: t("keyboardShortcuts"),
      category: t(hasGeneral ? "section.general" : "section.appearance"),
      target: "shortcuts",
    },
    {
      id: "projects",
      name: t("searchProjects"),
      category: t("section.projects"),
      target: "",
    },
    {
      id: "sync",
      name: t("searchAccounts"),
      category: t("section.sync"),
      target: "",
    },
    {
      id: "projects",
      name: t("searchJoinProject"),
      category: t("section.projects"),
      target: "",
    },
    {
      id: "agent",
      name: t("searchModel"),
      category: t("section.agent"),
      target: "agent-sources-title",
    },
    {
      id: "agent",
      name: t("searchRuntime"),
      category: t("section.agent"),
      target: "agent-runtime-title",
    },
    {
      id: "agent",
      name: t("searchIpad"),
      category: t("section.agent"),
      target: "agent-device-settings",
    },
    {
      id: "about",
      name: t("searchUpdates"),
      category: t("section.about"),
      target: "feedback-product-card",
    },
    {
      id: "about",
      name: t("searchDiagnostics"),
      category: t("section.about"),
      target: "feedback-diagnostics-title",
    },
    {
      id: "about",
      name: t("searchReport"),
      category: t("section.about"),
      target: "feedback-help-title",
    },
  );
  if (hasGeneral)
    options.push(
      {
        id: "general",
        name: t("library"),
        category: t("section.general"),
        target: "settings-library-title",
      },
      {
        id: "general",
        name: t("workRecords"),
        category: t("section.general"),
        target: "settings-work-records-title",
      },
      {
        id: "general",
        name: t("searchBackup"),
        category: t("section.general"),
        target: "settings-backup-title",
      },
    );
  const normalized = query.trim().toLocaleLowerCase();
  const matches = options.filter(
    ({ name, category }) =>
      name.toLocaleLowerCase().includes(normalized) ||
      category.toLocaleLowerCase().includes(normalized),
  );
  function select(option: (typeof options)[number]) {
    setQuery("");
    setSearching(false);
    if (option.target === "shortcuts") {
      writeSessionDraft(SHORTCUTS_DRAFT_KEY, "shortcuts");
      onSelect(option.id);
      window.dispatchEvent(new Event(SHORTCUTS_EVENT));
      return;
    }
    writeSessionDraft(SHORTCUTS_DRAFT_KEY, "");
    window.dispatchEvent(new Event(SHORTCUTS_EVENT));
    onSelect(option.id);
    requestAnimationFrame(() => {
      const target =
        (option.target ? document.getElementById(option.target) : null) ??
        document.querySelector<HTMLElement>(".studio-settings h2");
      if (!target) return;
      if (target.tabIndex < 0) target.tabIndex = -1;
      target.scrollIntoView({ block: "nearest" });
      target.focus({ preventScroll: true });
    });
  }
  return (
    <div
      className="settings-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setSearching(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && searching) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          setQuery("");
          setSearching(false);
        }
        if (
          event.key === "Enter" &&
          searching &&
          event.target instanceof HTMLInputElement &&
          matches[0]
        ) {
          event.preventDefault();
          select(matches[0]);
        }
      }}
    >
      <label className="settings-search-field">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label={t("searchSettings")}
          placeholder={t("searchSettings")}
          value={query}
          onFocus={() => setSearching(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearching(true);
          }}
        />
      </label>
      {searching && (
        <div className="settings-search-results">
          {matches.map((option) => (
            <button
              key={`${option.id}:${option.target || option.name}`}
              type="button"
              onClick={() => select(option)}
            >
              <span>{option.name}</span>
              {option.category && <small>{option.category}</small>}
            </button>
          ))}
          {!matches.length && <p>{t("noSettingsResults")}</p>}
        </div>
      )}
    </div>
  );
}

function ThemePreview({ theme }: { theme: "light" | "dark" }) {
  return (
    <span
      className={`settings-theme-preview preview-${theme}`}
      aria-hidden="true"
    >
      <span className="settings-preview-sidebar">
        <img
          className="settings-preview-brand"
          src={appIconForTheme(theme)}
          alt=""
          draggable={false}
        />
        <span className="settings-preview-nav active" />
        <span className="settings-preview-nav" />
        <span className="settings-preview-nav short" />
        <span className="settings-preview-bottom" />
      </span>
      <span className="settings-preview-main">
        <span className="settings-preview-topbar" />
        <span className="settings-preview-content">
          <span className="settings-preview-title" />
          <span className="settings-preview-line" />
          <span className="settings-preview-line short" />
          <span className="settings-preview-blocks">
            <span />
            <span />
          </span>
        </span>
      </span>
    </span>
  );
}

function ShortcutsSection({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const t = useTranslator(messages);
  return (
    <section
      className="settings-group"
      aria-labelledby="settings-shortcuts-title"
    >
      <h2 id="settings-shortcuts-title">{t("keyboardShortcuts")}</h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>{t("keyboardShortcuts")}</h3>
            <p>{t("keyboardShortcutsDetail")}</p>
          </div>
          <button
            type="button"
            className="settings-button"
            onClick={onOpenShortcuts}
          >
            <Keyboard size={14} aria-hidden="true" />
            {t("showShortcuts")}
          </button>
        </div>
      </div>
    </section>
  );
}

export function SettingsPanel({
  syncRequest,
  onOpenProject,
  section,
  info,
  appearance,
  theme: currentTheme,
  onAppearanceChange,
  onSelectSection,
  onChooseHome,
  onCopyHome,
  onMigrate,
  onOpenShortcuts,
  feedbackRequest,
  onOpenDocs,
  onOpenFaq,
}: {
  syncRequest?: ProjectSyncRequest;
  onOpenProject?: (projectId: string) => Promise<void>;
  section: SettingsSection;
  info: DesktopInfo | null;
  appearance: AppearancePreference;
  theme: "light" | "dark";
  onAppearanceChange: (appearance: AppearancePreference) => void;
  onSelectSection: (section: SettingsSection) => void;
  onChooseHome: () => void;
  onCopyHome: () => void;
  onCopyConfig?: () => void;
  onMigrate: () => void;
  onOpenShortcuts?: () => void;
  feedbackRequest?: FeedbackRequest;
  onOpenDocs?: () => void;
  onOpenFaq?: () => void;
}) {
  const t = useTranslator(messages);
  const language = useLanguagePreference();
  const tr = useTranslator(remoteMcpMessages);
  const capabilities = workbenchCapabilities(info?.platform);
  const hasGeneral =
    availableSettingsSection("general", info?.platform) === "general";
  section = availableSettingsSection(section, info?.platform);
  const [subpage, setSubpage] = useState<"shortcuts" | null>(() =>
    readSessionDraft<string>(SHORTCUTS_DRAFT_KEY, "") === "shortcuts"
      ? "shortcuts"
      : null,
  );
  useEffect(() => {
    const sync = () => {
      setSubpage(
        readSessionDraft<string>(SHORTCUTS_DRAFT_KEY, "") === "shortcuts"
          ? "shortcuts"
          : null,
      );
    };
    window.addEventListener(SHORTCUTS_EVENT, sync);
    return () => window.removeEventListener(SHORTCUTS_EVENT, sync);
  }, []);
  useEffect(() => {
    if (section !== "general" && section !== "appearance") {
      if (subpage) {
        writeSessionDraft(SHORTCUTS_DRAFT_KEY, "");
        setSubpage(null);
      }
    }
  }, [section, subpage]);
  const openShortcutsSubpage = () => {
    writeSessionDraft(SHORTCUTS_DRAFT_KEY, "shortcuts");
    setSubpage("shortcuts");
  };
  const closeShortcutsSubpage = () => {
    writeSessionDraft(SHORTCUTS_DRAFT_KEY, "");
    setSubpage(null);
  };
  const showShortcutsSubpage =
    subpage === "shortcuts" &&
    (section === "general" || section === "appearance");
  void onOpenShortcuts;
  return (
    <div
      className="studio-settings"
      key={section === "sync" || section === "projects" ? "sync-family" : section}
      data-settings-section={section}
      data-settings-subpage={showShortcutsSubpage ? "shortcuts" : undefined}
    >
      {(section === "sync" || section === "projects") && (
        <SyncSettings
          mode={section === "projects" ? "projects" : "accounts"}
          onSelectSection={onSelectSection}
          request={syncRequest}
          onOpenProject={onOpenProject}
          home={info?.home}
        />
      )}
      {section === "general" &&
        (showShortcutsSubpage ? (
          <>
            <div className="settings-subpage-bar">
              <button
                type="button"
                className="settings-button settings-back-button"
                onClick={closeShortcutsSubpage}
              >
                <ChevronLeft size={15} aria-hidden="true" />
                {t("backToGeneral")}
              </button>
            </div>
            <ShortcutsPanel
              browser={info?.mode === "browser"}
              tabs={capabilities.tabs}
              windows={capabilities.windows}
            />
          </>
        ) : (
          <>
            <section
              className="settings-group"
              aria-labelledby="settings-library-title"
            >
              <h2 id="settings-library-title">{t("library")}</h2>
              <div className="settings-card">
                <div className="settings-card-section">
                  <div className="settings-row-head">
                    <div className="settings-row-text">
                      <h3>{t("storageLocation")}</h3>
                      <p>{t("storageLocationDetail")}</p>
                    </div>
                    <div className="settings-row-actions">
                      <button
                        type="button"
                        className="settings-button"
                        disabled={!info}
                        onClick={onChooseHome}
                      >
                        {t("switchLibrary")}
                      </button>
                    </div>
                  </div>
                  <SettingsPath
                    value={info?.home ?? t("readingLibrary")}
                    copyLabel={t("copyLibraryPath")}
                    copiedLabel={t("directoryCopied")}
                    disabled={!info}
                    onCopy={onCopyHome}
                  />
                </div>
                {info?.libraryVersion === 1 && (
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <h3>{t("upgradeLibrary")}</h3>
                      <p>{t("upgradeLibraryDetail")}</p>
                    </div>
                    <button
                      type="button"
                      className="settings-button settings-primary-button"
                      onClick={onMigrate}
                    >
                      {t("upgradeLibrary")}
                    </button>
                  </div>
                )}
              </div>
            </section>
            {info && <WorkRecordsSettings key={`records:${info.home}`} />}
            {info?.libraryVersion === 2 && (
              <LibrarySpace key={`space:${info.home}`} home={info.home} />
            )}
            <ShortcutsSection onOpenShortcuts={openShortcutsSubpage} />
          </>
        ))}
      {section === "appearance" &&
        (showShortcutsSubpage && !hasGeneral ? (
          <>
            <div className="settings-subpage-bar">
              <button
                type="button"
                className="settings-button settings-back-button"
                onClick={closeShortcutsSubpage}
              >
                <ChevronLeft size={15} aria-hidden="true" />
                {t("backToAppearance")}
              </button>
            </div>
            <ShortcutsPanel
              browser={info?.mode === "browser"}
              tabs={capabilities.tabs}
              windows={capabilities.windows}
            />
          </>
        ) : (
          <>
            <section
              className="settings-group"
              aria-labelledby="settings-theme-title"
            >
              <h2 id="settings-theme-title">{t("theme")}</h2>
              <div
                className="settings-theme-options"
                role="radiogroup"
                aria-labelledby="settings-theme-title"
              >
                {(["system", "light", "dark"] as const).map((option) => {
                  const selected = appearance === option;
                  const Icon =
                    option === "system"
                      ? Monitor
                      : option === "light"
                        ? Sun
                        : Moon;
                  return (
                    <label
                      className={`settings-theme-option ${selected ? "selected" : ""}`}
                      key={option}
                    >
                      <input
                        type="radio"
                        name="settings-theme"
                        value={option}
                        aria-label={t(
                          option === "system" ? "themeSystem" : option,
                        )}
                        aria-describedby={
                          option === "system"
                            ? "settings-system-effective"
                            : undefined
                        }
                        checked={selected}
                        onChange={() => onAppearanceChange(option)}
                      />
                      <ThemePreview
                        theme={option === "system" ? currentTheme : option}
                      />
                      <span className="settings-theme-label">
                        <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
                        <span>
                          {t(option === "system" ? "themeSystem" : option)}
                          {option === "system" && (
                            <small
                              id="settings-system-effective"
                              className="settings-theme-effective"
                            >
                              {t("effectiveTheme", { theme: t(currentTheme) })}
                            </small>
                          )}
                        </span>
                        <span className="settings-radio-mark" aria-hidden="true" />
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
            <section
              className="settings-group"
              aria-labelledby="settings-interface-title"
            >
              <h2 id="settings-interface-title">{t("interface")}</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <label htmlFor="settings-language">{t("language")}</label>
                    <p>{t("languageDetail")}</p>
                  </div>
                  <div className="settings-select">
                    <Select
                      id="settings-language"
                      value={language}
                      onChange={(event) => {
                        if (isLanguagePreference(event.target.value))
                          setLanguagePreference(event.target.value);
                      }}
                    >
                      <option value="system">{t("languageSystem")}</option>
                      {LOCALES.map((locale) => (
                        <option key={locale} value={locale} lang={locale}>
                          {LOCALE_NAMES[locale]}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>
            </section>
            {!hasGeneral && (
              <ShortcutsSection onOpenShortcuts={openShortcutsSubpage} />
            )}
          </>
        ))}
      {section === "agent" && (
        <AgentSettings
          onAccounts={() => {
            onSelectSection("sync");
          }}
        />
      )}
      {section === "remote" &&
        (info?.mode === "browser" ? (
          <div className="settings-callout">
            <p>{tr("desktopOnly")}</p>
          </div>
        ) : (
          <RemoteMcpSettings home={info?.home} />
        ))}
      {section === "plugins" && info && (
        <PluginInstallSettings home={info.home} />
      )}
      {section === "about" && (
        <AboutFeedback
          info={info}
          request={feedbackRequest}
          onOpenDocs={onOpenDocs}
          onOpenFaq={onOpenFaq}
          onOpenPlugins={
            availableSettingsSection("plugins", info?.platform) === "plugins"
              ? () => onSelectSection("plugins")
              : undefined
          }
        />
      )}
    </div>
  );
}
