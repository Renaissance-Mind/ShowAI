import { writeSessionDraft } from "./session-draft";
import { useState } from "react";
import ExpandableSearch from "../components/ExpandableSearch";
import { pluginNeedsUpdate, usePluginHosts } from "./usePluginHosts";
import {
  Bot,
  Puzzle,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  Info,
  Keyboard,
  Shapes,
  Monitor,
  Moon,
  Settings2,
  Sun,
  Globe,
} from "../ui/icons";
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
import LibrarySpace from "./LibrarySpace";
import IconViewer from "./IconViewer";
import SyncSettings, { type ProjectSyncRequest } from "./SyncSettings";
import AgentSettings from "./AgentSettings";
import WorkRecordsSettings from "./WorkRecordsSettings";
import PluginInstallSettings, {
  LaunchConfigCopy,
} from "./PluginInstallSettings";
import RemoteMcpSettings from "./RemoteMcpSettings";
import remoteMcpMessages from "../i18n/messages/remoteMcp";
import { workbenchCapabilities } from "./capabilities";
import { AboutFeedback, type FeedbackRequest } from "./feedback/AboutFeedback";

const sections = [
  {
    id: "sync",
    label: "section.sync",
    icon: Folder,
  },
  {
    id: "general",
    label: "section.general",
    icon: Settings2,
  },
  {
    id: "appearance",
    label: "section.appearance",
    icon: Sun,
  },
  {
    id: "agent",
    label: "section.agent",
    icon: Bot,
  },
  {
    id: "plugins",
    label: "section.plugins",
    icon: Puzzle,
  },
  {
    id: "remote",
    label: "section.remote",
    icon: Globe,
  },
  {
    id: "icons",
    label: "section.icons",
    icon: Shapes,
  },
  {
    id: "about",
    label: "section.about",
    icon: Info,
  },
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
  return (
    <div className="settings-category-sidebar">
      <div className="settings-nav-label">{t("title")}</div>
      <nav className="settings-nav" aria-label={t("categories")}>
        {sections
          .filter(({ id }) => availableSettingsSection(id, platform) === id)
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={t(label)}
              aria-description={
                id === "plugins" && updates > 0
                  ? t("pluginUpdates", { count: updates })
                  : undefined
              }
              aria-current={section === id ? "page" : undefined}
              onClick={() => onSelect(id)}
            >
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              {t(label)}
              {id === "plugins" && updates > 0 && (
                <span className="settings-nav-updates" aria-hidden="true">
                  {updates}
                </span>
              )}
            </button>
          ))}
      </nav>
    </div>
  );
}

export function SettingsSearch({
  platform,
  onSelect,
  onShortcuts,
}: {
  platform?: string;
  onSelect: (section: SettingsSection) => void;
  onShortcuts: () => void;
}) {
  const t = useTranslator(messages);
  const [query, setQuery] = useState("");
  const options = sections
    .filter(({ id }) => availableSettingsSection(id, platform) === id)
    .map(({ id, label }) => ({ id, name: t(label), target: "" }));
  options.push(
    { id: "appearance", name: t("language"), target: "settings-language" },
    { id: "appearance", name: t("theme"), target: "settings-theme-title" },
    { id: "about", name: t("keyboardShortcuts"), target: "shortcuts" },
    {
      id: "about",
      name: t("searchDiagnostics"),
      target: "feedback-diagnostics-title",
    },
  );
  if (availableSettingsSection("general", platform) === "general")
    options.push(
      { id: "general", name: t("library"), target: "settings-library-title" },
      {
        id: "general",
        name: t("workRecords"),
        target: "settings-work-records-title",
      },
      {
        id: "general",
        name: t("searchBackup"),
        target: "settings-backup-title",
      },
    );
  options.push({
    id: "agent",
    name: t("searchModel"),
    target: "agent-sources-title",
  });
  const matches = options.filter(({ name }) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  function select(option: (typeof options)[number]) {
    setQuery("");
    onSelect(option.id);
    if (option.target === "shortcuts") {
      onShortcuts();
      return;
    }
    requestAnimationFrame(() => {
      const target =
        (option.target ? document.getElementById(option.target) : null) ??
        document.querySelector<HTMLElement>(".studio-settings h2");
      if (!target) return;
      for (
        let parent = target.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (target.tabIndex < 0) target.tabIndex = -1;
      target.scrollIntoView({ block: "nearest" });
      target.focus({ preventScroll: true });
    });
  }
  return (
    <ExpandableSearch
      label={t("searchSettings")}
      value={query}
      onChange={setQuery}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          matches[0]
        ) {
          event.preventDefault();
          select(matches[0]);
        }
      }}
    >
      <div className="settings-search-results">
        {matches.map((option) => (
          <button
            key={option.target || option.id}
            type="button"
            onClick={() => select(option)}
          >
            {option.name}
          </button>
        ))}
        {!matches.length && <p>{t("noSettingsResults")}</p>}
      </div>
    </ExpandableSearch>
  );
}

function ThemePreview({ theme }: { theme: "light" | "dark" }) {
  return (
    <span
      className={`settings-theme-preview preview-${theme}`}
      aria-hidden="true"
    >
      <span className="settings-preview-sidebar">
        <span className="settings-preview-brand">✳</span>
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
  onOpenShortcuts: () => void;
  feedbackRequest?: FeedbackRequest;
  onOpenDocs?: () => void;
  onOpenFaq?: () => void;
}) {
  const t = useTranslator(messages);
  const language = useLanguagePreference();
  const tr = useTranslator(remoteMcpMessages);
  section = availableSettingsSection(section, info?.platform);
  const current = sections.find((item) => item.id === section)!;
  return (
    <div className="studio-settings" key={section}>
      {section !== "sync" && (
        <header className="settings-heading">
          <h2>{t(current.label)}</h2>
        </header>
      )}
      {section === "icons" && <IconViewer />}
      {section === "sync" && (
        <SyncSettings
          request={syncRequest}
          onOpenProject={onOpenProject}
          home={info?.home}
        />
      )}
      {section === "general" && (
        <section
          className="settings-group"
          aria-labelledby="settings-library-title"
        >
          <h2 id="settings-library-title">{t("library")}</h2>
          <div className="settings-row settings-location-heading">
            <div className="settings-row-text">
              <h3>{t("storageLocation")}</h3>
            </div>
          </div>
          <div className="settings-path">
            <Folder size={17} aria-hidden="true" />
            <code>{info?.home ?? t("readingLibrary")}</code>
            <button
              type="button"
              className="settings-button"
              aria-label={t("copyLibraryPath")}
              disabled={!info}
              onClick={onCopyHome}
            >
              <Copy size={15} aria-hidden="true" />
              {t("copyDirectory")}
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={!info}
              onClick={onChooseHome}
            >
              {t("switchLibrary")}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>

          {info?.libraryVersion === 1 && (
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>{t("upgradeLibrary")}</h3>
                <p>{t("upgradeLibraryDetail")}</p>
              </div>
              <button className="settings-button" onClick={onMigrate}>
                {t("upgradeLibrary")}
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </section>
      )}
      {section === "general" && info && (
        <WorkRecordsSettings key={`records:${info.home}`} />
      )}
      {section === "general" && info?.libraryVersion === 2 && (
        <LibrarySpace key={`space:${info.home}`} home={info.home} />
      )}
      {section === "appearance" && (
        <section
          className="settings-group"
          aria-labelledby="settings-theme-title"
        >
          <fieldset className="settings-theme-options">
            <legend id="settings-theme-title" className="settings-theme-legend">
              {t("theme")}
            </legend>
            {(["system", "light", "dark"] as const).map((option) => {
              const selected = appearance === option;
              const Icon =
                option === "system" ? Monitor : option === "light" ? Sun : Moon;
              return (
                <label
                  className={`settings-theme-option ${selected ? "selected" : ""}`}
                  key={option}
                >
                  <input
                    type="radio"
                    name="settings-theme"
                    value={option}
                    aria-label={t(option === "system" ? "themeSystem" : option)}
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
          </fieldset>
          <div className="settings-row">
            <div className="settings-row-text">
              <label htmlFor="settings-language">{t("language")}</label>
            </div>
            <div className="settings-select">
              <select
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
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </div>
        </section>
      )}
      {section === "agent" && (
        <AgentSettings
          onAccounts={() => {
            writeSessionDraft(
              `sync-settings-view:${info?.home ?? ""}`,
              "accounts",
            );
            onSelectSection("sync");
          }}
        />
      )}
      {section === "remote" &&
        (info?.mode === "browser" ? (
          <p className="settings-help">{tr("desktopOnly")}</p>
        ) : (
          <RemoteMcpSettings home={info?.home} />
        ))}
      {section === "plugins" && (
        <>
          {info && <PluginInstallSettings home={info.home} />}
          <LaunchConfigCopy info={info} />
        </>
      )}
      {section === "about" && (
        <>
          <AboutFeedback
            info={info}
            request={feedbackRequest}
            onOpenDocs={onOpenDocs}
            onOpenFaq={onOpenFaq}
          />
          <section
            className="settings-group"
            aria-labelledby="settings-shortcuts-title"
          >
            <div className="settings-row">
              <div className="settings-row-text">
                <h3 id="settings-shortcuts-title">{t("keyboardShortcuts")}</h3>
              </div>
              <button className="settings-button" onClick={onOpenShortcuts}>
                <Keyboard size={14} aria-hidden="true" />
                {t("showShortcuts")}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
