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
  Moon,
  Settings2,
  Sun,
  Terminal,
} from "../ui/icons";
import type { DesktopInfo } from "../desktop/bridge";
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
import PluginInstallSettings from "./PluginInstallSettings";
import { workbenchCapabilities } from "./capabilities";

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
    (section === "plugins" && !capabilities.localPlugins)
    ? "sync"
    : section;
}

export function SettingsNavigation({
  section,
  onSelect,
  platform,
}: {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  platform?: string;
}) {
  const t = useTranslator(messages);
  return (
    <div className="settings-category-sidebar">
      <div className="settings-nav-label">{t("title")}</div>
      <nav className="settings-nav" aria-label={t("categories")}>
        {sections
          .filter(({ id }) => availableSettingsSection(id, platform) === id)
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={section === id ? "page" : undefined}
              onClick={() => onSelect(id)}
            >
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              {t(label)}
            </button>
          ))}
      </nav>
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
  dark,
  onDarkChange,
  onChooseHome,
  onCopyHome,
  onCopyConfig,
  onMigrate,
  onOpenShortcuts,
  docsVisible,
  onDocsVisibleChange,
}: {
  syncRequest?: ProjectSyncRequest;
  onOpenProject?: (projectId: string) => Promise<void>;
  section: SettingsSection;
  info: DesktopInfo | null;
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
  onChooseHome: () => void;
  onCopyHome: () => void;
  onCopyConfig: () => void;
  onMigrate: () => void;
  onOpenShortcuts: () => void;
  /** Absent where the host publishes its own documentation. */
  docsVisible?: boolean;
  onDocsVisibleChange?: (visible: boolean) => void;
}) {
  const t = useTranslator(messages);
  const language = useLanguagePreference();
  section = availableSettingsSection(section, info?.platform);
  const current = sections.find((item) => item.id === section)!;
  return (
    <div className="studio-settings" key={section}>
      <header className="settings-heading">
        <h2>{t(current.label)}</h2>
      </header>
      {section === "icons" && <IconViewer />}
      {section === "sync" && (
        <SyncSettings request={syncRequest} onOpenProject={onOpenProject} />
      )}
      {section === "general" && (
        <section
          className="settings-group"
          aria-labelledby="settings-library-title"
        >
          <h2 id="settings-library-title">{t("library")}</h2>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{t("storageLocation")}</h3>
            </div>
            <button
              className="settings-button"
              disabled={!info}
              onClick={onChooseHome}
            >
              {t("chooseLibrary")}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="settings-path">
            <Folder size={17} aria-hidden="true" />
            <code>{info?.home ?? t("readingLibrary")}</code>
            <button
              className="settings-icon-button"
              aria-label={t("copyLibraryPath")}
              title={t("copyLibraryPath")}
              disabled={!info}
              onClick={onCopyHome}
            >
              <Copy size={15} aria-hidden="true" />
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
      {section === "general" && onDocsVisibleChange && (
        <section
          className="settings-group"
          aria-labelledby="settings-sidebar-title"
        >
          <h2 id="settings-sidebar-title">{t("sidebar")}</h2>
          <div className="settings-row">
            <div className="settings-row-text">
              <label htmlFor="settings-builtin-docs">{t("builtinDocs")}</label>
              <p>{t("builtinDocsDetail")}</p>
            </div>
            <input
              id="settings-builtin-docs"
              type="checkbox"
              role="switch"
              className="settings-switch"
              checked={!!docsVisible}
              onChange={(event) => onDocsVisibleChange(event.target.checked)}
            />
          </div>
        </section>
      )}
      {section === "general" && info?.libraryVersion === 2 && (
        <LibrarySpace key={info.home} home={info.home} />
      )}
      {section === "appearance" && (
        <section
          className="settings-group"
          aria-labelledby="settings-theme-title"
        >
          <h2 id="settings-theme-title">{t("interface")}</h2>
          <div className="settings-row">
            <div className="settings-row-text">
              <label htmlFor="settings-theme">{t("theme")}</label>
            </div>
            <div className="settings-select">
              <select
                id="settings-theme"
                value={dark ? "dark" : "light"}
                onChange={(event) =>
                  onDarkChange(event.target.value === "dark")
                }
              >
                <option value="light">{t("light")}</option>
                <option value="dark">{t("dark")}</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </div>
          <fieldset className="settings-theme-options">
            <legend className="settings-sr-only">{t("themePreview")}</legend>
            {(["light", "dark"] as const).map((theme) => {
              const selected = dark === (theme === "dark");
              const Icon = theme === "light" ? Sun : Moon;
              return (
                <label
                  className={`settings-theme-option ${selected ? "selected" : ""}`}
                  key={theme}
                >
                  <input
                    type="radio"
                    name="settings-theme-preview"
                    value={theme}
                    checked={selected}
                    onChange={() => onDarkChange(theme === "dark")}
                  />
                  <ThemePreview theme={theme} />
                  <span className="settings-theme-label">
                    <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
                    <span>{t(theme)}</span>
                    <span className="settings-radio-mark" aria-hidden="true" />
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="settings-row">
            <div className="settings-row-text">
              <label htmlFor="settings-language">{t("language")}</label>
              <p>{t("languageDetail")}</p>
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
      {section === "agent" && <AgentSettings />}
      {section === "plugins" && (
        <section
          className="settings-group"
          aria-labelledby="settings-plugins-title"
        >
          <h2 id="settings-plugins-title">{t("localConnection")}</h2>
          {info?.mode === "browser" ? (
            <p>{t("pluginsDesktopOnly")}</p>
          ) : info ? (
            <PluginInstallSettings home={info.home} />
          ) : null}
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{t("launchConfig")}</h3>
            </div>
            <button
              className="settings-button"
              disabled={!info}
              onClick={onCopyConfig}
            >
              <Copy size={14} aria-hidden="true" />
              {t("copyLaunchConfig")}
            </button>
          </div>
          <details className="settings-config">
            <summary>
              <ChevronRight size={14} aria-hidden="true" />
              <Terminal size={15} aria-hidden="true" />
              {t("launchConfig")}
            </summary>
            <pre>
              <code>
                {info
                  ? JSON.stringify(info.cli, null, 2)
                  : t("readingLaunchConfig")}
              </code>
            </pre>
          </details>
        </section>
      )}
      {section === "about" && (
        <>
          <div className="settings-product">
            <span className="settings-product-symbol" aria-hidden="true">
              ✳
            </span>
            <div>
              <h2>ShowAI</h2>
            </div>
          </div>
          <section
            className="settings-group settings-about"
            aria-label={t("appInfo")}
          >
            <dl>
              <div className="settings-row">
                <dt>{t("version")}</dt>
                <dd>{info?.version ?? "—"}</dd>
              </div>
              <div className="settings-row">
                <dt>{t("platform")}</dt>
                <dd>
                  {info
                    ? ({ darwin: "macOS", win32: "Windows", linux: "Linux" }[
                        info.platform
                      ] ?? info.platform)
                    : "—"}
                </dd>
              </div>
              <div className="settings-row">
                <dt>{t("environment")}</dt>
                <dd>
                  {info
                    ? info.mode === "browser"
                      ? t("environmentBrowser")
                      : info.packaged
                        ? t("environmentPackaged")
                        : t("environmentDevelopment")
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>
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
