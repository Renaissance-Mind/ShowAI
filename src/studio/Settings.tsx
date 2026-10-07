import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  Info,
  Shapes,
  Moon,
  Settings2,
  Sun,
  Terminal,
} from "../ui/icons";
import type { DesktopInfo } from "../desktop/bridge";
import "./settings.css";
import LibrarySpace from "./LibrarySpace";
import IconViewer from "./IconViewer";
import SyncSettings from "./SyncSettings";

const sections = [
  {
    id: "sync",
    label: "服务器与同步",
    icon: Folder,
  },
  {
    id: "general",
    label: "通用",
    icon: Settings2,
  },
  {
    id: "appearance",
    label: "外观",
    icon: Sun,
  },
  {
    id: "agent",
    label: "Agent",
    icon: Bot,
  },
  {
    id: "icons",
    label: "图标",
    icon: Shapes,
  },
  {
    id: "about",
    label: "关于",
    icon: Info,
  },
] as const;

export type SettingsSection = (typeof sections)[number]["id"];

export function SettingsNavigation({
  section,
  onSelect,
}: {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <div className="settings-category-sidebar">
      <div className="settings-nav-label">设置</div>
      <nav className="settings-nav" aria-label="设置分类">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-current={section === id ? "page" : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
            {label}
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
  section,
  info,
  dark,
  onDarkChange,
  onChooseHome,
  onCopyHome,
  onCopyConfig,
  onMigrate,
}: {
  section: SettingsSection;
  info: DesktopInfo | null;
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
  onChooseHome: () => void;
  onCopyHome: () => void;
  onCopyConfig: () => void;
  onMigrate: () => void;
}) {
  const current = sections.find((item) => item.id === section)!;
  return (
    <div className="studio-settings" key={section}>
      <header className="settings-heading">
        <h2>{current.label}</h2>
      </header>
      {section === "icons" && <IconViewer />}
      {section === "sync" && <SyncSettings />}
      {section === "general" && (
        <section
          className="settings-group"
          aria-labelledby="settings-library-title"
        >
          <h2 id="settings-library-title">内容库</h2>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>存储位置</h3>
            </div>
            <button
              className="settings-button"
              disabled={!info}
              onClick={onChooseHome}
            >
              选择内容库
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="settings-path">
            <Folder size={17} aria-hidden="true" />
            <code>{info?.home ?? "正在读取内容库…"}</code>
            <button
              className="settings-icon-button"
              aria-label="复制内容库路径"
              title="复制内容库路径"
              disabled={!info}
              onClick={onCopyHome}
            >
              <Copy size={15} aria-hidden="true" />
            </button>
          </div>

          {info?.libraryVersion === 1 && (
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>修改历史</h3>
                <p>导入现有内容，保留原始文件并启用完整修改记录。</p>
              </div>
              <button className="settings-button" onClick={onMigrate}>
                启用版本历史
                <ChevronRight size={14} />
              </button>
            </div>
          )}
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
          <h2 id="settings-theme-title">界面</h2>
          <div className="settings-row">
            <div className="settings-row-text">
              <label htmlFor="settings-theme">主题</label>
            </div>
            <div className="settings-select">
              <select
                id="settings-theme"
                value={dark ? "dark" : "light"}
                onChange={(event) =>
                  onDarkChange(event.target.value === "dark")
                }
              >
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </div>
          <fieldset className="settings-theme-options">
            <legend className="settings-sr-only">主题预览</legend>
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
                    <span>{theme === "light" ? "浅色" : "深色"}</span>
                    <span className="settings-radio-mark" aria-hidden="true" />
                  </span>
                </label>
              );
            })}
          </fieldset>
        </section>
      )}
      {section === "agent" && (
        <>
          <section
            className="settings-group"
            aria-labelledby="settings-agent-title"
          >
            <h2 id="settings-agent-title">本地连接</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>启动配置</h3>
              </div>
              <button
                className="settings-button"
                disabled={!info}
                onClick={onCopyConfig}
              >
                <Copy size={14} aria-hidden="true" />
                复制启动配置
              </button>
            </div>
            <details className="settings-config">
              <summary>
                <ChevronRight size={14} aria-hidden="true" />
                <Terminal size={15} aria-hidden="true" />
                启动配置
              </summary>
              <pre>
                <code>
                  {info
                    ? JSON.stringify(info.cli, null, 2)
                    : "正在读取启动配置…"}
                </code>
              </pre>
            </details>
          </section>
        </>
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
            aria-label="应用信息"
          >
            <dl>
              <div className="settings-row">
                <dt>版本</dt>
                <dd>{info?.version ?? "—"}</dd>
              </div>
              <div className="settings-row">
                <dt>运行平台</dt>
                <dd>
                  {info
                    ? ({ darwin: "macOS", win32: "Windows", linux: "Linux" }[
                        info.platform
                      ] ?? info.platform)
                    : "—"}
                </dd>
              </div>
              <div className="settings-row">
                <dt>应用环境</dt>
                <dd>
                  {info
                    ? info.mode === "browser"
                      ? "本地浏览器版"
                      : info.packaged
                        ? "桌面安装包"
                        : "开发环境"
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
