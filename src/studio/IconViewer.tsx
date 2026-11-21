import { useNotify } from "../problems/toast-context";
import { useMemo, useRef, useState } from "react";
import * as icons from "../ui/icons";
import {
  ChevronLeft,
  CircleAlert,
  Copy,
  Download,
  Moon,
  RotateCcw,
  Search,
  Sun,
  Shapes,
  Type,
  Database,
  Folder,
  LayoutDashboard,
  Settings2,
} from "../ui/icons";
import { desktop } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/icons";
import "./icon-viewer.css";

type Category = "text" | "content" | "files" | "navigation" | "actions";
type Group = Category | "all";

function category(name: string): Category {
  if (
    /Align|Bold|Heading|Highlighter|Italic|List|Quote|Strikethrough|Type|Underline|Code/.test(
      name,
    )
  )
    return "text";
  if (
    /Chart|Columns|Database|Flask|Gauge|Image|Table|Workflow|Puzzle|Blocks/.test(
      name,
    )
  )
    return "content";
  if (/File|Folder|Package|Download|Upload|Printer|Copy|History/.test(name))
    return "files";
  if (
    /Arrow|Chevron|Expand|Focus|Grip|Layout|Maximize|Mouse|Panel|Square|Circle|Layers/.test(
      name,
    )
  )
    return "navigation";
  return "actions";
}

const catalog = Object.entries(icons).map(([name, Icon]) => ({
  name,
  Icon,
  category: category(name),
}));
const categories = [...new Set(catalog.map((item) => item.category))];
const categoryIcons: Record<Group, typeof Shapes> = {
  all: Shapes,
  text: Type,
  content: Database,
  files: Folder,
  navigation: LayoutDashboard,
  actions: Settings2,
};
const lightInk = "#252629";
const darkInk = "#f4f4f6";
const defaults = {
  size: 24,
  stroke: 1.7,
  color: lightInk,
  background: "light" as "light" | "dark",
};

export default function IconViewer() {
  const t = useTranslator(messages);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [selected, setSelected] = useState(catalog[0].name);
  const [preview, setPreview] = useState(defaults);
  const [narrowView, setNarrowView] = useState<"catalog" | "detail">("catalog");
  const selectedTile = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const notify = useNotify();
  const [error, setError] = useState("");
  const specimen = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () =>
      catalog.filter(
        (item) =>
          (group === "all" || item.category === group) &&
          `${item.name} ${t(`category.${item.category}`)}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [group, query, t],
  );
  const current =
    visible.find((item) => item.name === selected) ?? visible[0] ?? catalog[0];
  const Icon = current.Icon;
  const svg = () => {
    const element = specimen
      .current!.querySelector("svg")!
      .cloneNode(true) as SVGElement;
    element.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    element.setAttribute("stroke", preview.color);
    element.removeAttribute("class");
    element.removeAttribute("aria-hidden");
    return element.outerHTML;
  };
  const copy = async (text: string, message: string) => {
    setError("");
    try {
      await desktop
        .invoke("clipboard:write", { text })
        .catch(() => navigator.clipboard.writeText(text));
      notify(message);
    } catch (reason) {
      setError(
        t("copyFailed", {
          error: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([svg()], { type: "image/svg+xml" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${current.name}.svg`;
    link.click();
    setError("");
    notify(t("downloadedSvg"));
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="icon-viewer"
      data-narrow-view={visible.length ? narrowView : "catalog"}
      aria-label={t("browser")}
    >
      <div className="icon-viewer-toolbar">
        <div className="icon-viewer-tools">
          <label className="settings-search-field icon-viewer-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label={t("search")}
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="settings-badge icon-viewer-count" aria-live="polite">
            {t("count", { visible: visible.length, count: catalog.length })}
          </span>
        </div>
        <div
          className="settings-segmented icon-viewer-categories"
          role="group"
          aria-label={t("categories")}
        >
          {(["all", ...categories] as Group[]).map((item) => {
            const CategoryIcon = categoryIcons[item];
            return (
              <button
                type="button"
                key={item}
                aria-pressed={group === item}
                onClick={() => setGroup(item)}
              >
                <CategoryIcon size={14} aria-hidden="true" />
                {t(`category.${item}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="icon-viewer-layout">
        <div className="icon-viewer-grid" role="group" aria-label={t("list")}>
          {visible.map(({ name, Icon }) => (
            <button
              type="button"
              key={name}
              className="icon-viewer-tile"
              aria-label={name}
              aria-pressed={current.name === name}
              title={name}
              onClick={(event) => {
                setSelected(name);
                if (window.matchMedia("(max-width: 800px)").matches) {
                  selectedTile.current = event.currentTarget;
                  setNarrowView("detail");
                  requestAnimationFrame(() => backButton.current?.focus());
                }
                setError("");
              }}
            >
              <span
                className={`icon-viewer-tile-art preview-${preview.background}`}
                style={{ color: preview.color }}
              >
                <Icon
                  size={preview.size}
                  strokeWidth={preview.stroke}
                  aria-hidden="true"
                />
              </span>
              <span className="icon-viewer-name">{name}</span>
            </button>
          ))}
          {!visible.length && (
            <div className="settings-card icon-viewer-empty">
              <Search size={26} aria-hidden="true" />
              <p>{t("empty")}</p>
              <button
                type="button"
                className="settings-button"
                onClick={() => {
                  setQuery("");
                  setGroup("all");
                }}
              >
                {t("showAll")}
              </button>
            </div>
          )}
        </div>
        {!!visible.length && (
          <aside
            className="settings-card icon-viewer-detail"
            aria-label={t("detail")}
          >
            <button
              type="button"
              className="settings-button settings-back-button icon-viewer-back"
              ref={backButton}
              onClick={() => {
                setNarrowView("catalog");
                requestAnimationFrame(() => selectedTile.current?.focus());
              }}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {t("backToIcons")}
            </button>
            <div
              className={`icon-viewer-specimen preview-${preview.background}`}
              ref={specimen}
              style={{ color: preview.color }}
            >
              <Icon
                size={preview.size}
                strokeWidth={preview.stroke}
                aria-hidden="true"
              />
            </div>
            <div className="icon-viewer-meta">
              <h3>{current.name}</h3>
              <p>{t(`category.${current.category}`)} · Lucide</p>
            </div>
            <div className="icon-viewer-settings-heading">
              <h4>{t("previewOptions")}</h4>
              <button
                type="button"
                className="settings-button"
                onClick={() => {
                  setPreview(defaults);
                  notify(t("previewReset"));
                  setError("");
                }}
              >
                <RotateCcw size={13} aria-hidden="true" />
                {t("resetPreview")}
              </button>
            </div>
            <div className="icon-viewer-controls">
              <label>
                <span>{t("size")}</span>
                <output>{preview.size} px</output>
                <input
                  className="showai-range"
                  aria-label={t("sizeLabel")}
                  type="range"
                  min={12}
                  max={64}
                  step={1}
                  value={preview.size}
                  onChange={(event) =>
                    setPreview({ ...preview, size: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                <span>{t("stroke")}</span>
                <output>{preview.stroke}</output>
                <input
                  className="showai-range"
                  aria-label={t("strokeLabel")}
                  type="range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={preview.stroke}
                  onChange={(event) =>
                    setPreview({
                      ...preview,
                      stroke: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="icon-viewer-color">
                <span>{t("color")}</span>
                <input
                  aria-label={t("colorLabel")}
                  type="color"
                  value={preview.color}
                  onChange={(event) =>
                    setPreview({ ...preview, color: event.target.value })
                  }
                />
                <code>{preview.color}</code>
              </label>
              <div className="icon-viewer-background-field">
                <span>{t("previewBackground")}</span>
                <div
                  className="settings-segmented icon-viewer-background"
                  role="group"
                  aria-label={t("background")}
                >
                  <button
                    type="button"
                    aria-pressed={preview.background === "light"}
                    onClick={() =>
                      setPreview({
                        ...preview,
                        background: "light",
                        color:
                          preview.color === darkInk ? lightInk : preview.color,
                      })
                    }
                  >
                    <Sun size={14} aria-hidden="true" />
                    {t("light")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={preview.background === "dark"}
                    onClick={() =>
                      setPreview({
                        ...preview,
                        background: "dark",
                        color:
                          preview.color === lightInk ? darkInk : preview.color,
                      })
                    }
                  >
                    <Moon size={14} aria-hidden="true" />
                    {t("dark")}
                  </button>
                </div>
              </div>
            </div>
            {error && (
              <div
                className="settings-callout icon-viewer-copy-error"
                data-tone="error"
                role="alert"
              >
                <CircleAlert size={14} aria-hidden="true" />
                <span>
                  {error} {t("downloadInstead")}
                </span>
              </div>
            )}
            <div className="icon-viewer-actions">
              <button
                type="button"
                className="settings-button settings-primary-button"
                onClick={() => void copy(current.name, t("copiedName"))}
              >
                <Copy size={14} aria-hidden="true" />
                {t("copyName")}
              </button>
              <button
                type="button"
                className="settings-button"
                onClick={() => void copy(svg(), t("copiedSvg"))}
              >
                <Copy size={14} aria-hidden="true" />
                {t("copySvg")}
              </button>
              <button
                type="button"
                className="settings-button"
                onClick={download}
              >
                <Download size={14} aria-hidden="true" />
                {t("downloadSvg")}
              </button>
            </div>
            <code className="icon-viewer-source">src/ui/icons.ts</code>
          </aside>
        )}
      </div>
    </section>
  );
}
