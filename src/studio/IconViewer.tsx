import { useMemo, useRef, useState } from "react";
import * as icons from "../ui/icons";
import {
  ChevronLeft,
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
const defaults = {
  size: 24,
  stroke: 1.7,
  color: "#252629",
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
  const [notice, setNotice] = useState("");
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
    setNotice("");
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
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
    setNotice(t("downloadedSvg"));
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="icon-viewer"
      data-narrow-view={visible.length ? narrowView : "catalog"}
      aria-label={t("browser")}
    >
      <div className="icon-viewer-tools">
        <label className="icon-viewer-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label={t("search")}
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="icon-viewer-count" aria-live="polite">
          {t("count", { visible: visible.length, count: catalog.length })}
        </span>
      </div>
      <div
        className="icon-viewer-categories"
        role="group"
        aria-label={t("categories")}
      >
        {(["all", ...categories] as Group[]).map((item) => {
          const CategoryIcon = categoryIcons[item];
          return (
            <button
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
      <div className="icon-viewer-layout">
        <div className="icon-viewer-grid" role="group" aria-label={t("list")}>
          {visible.map(({ name, Icon }) => (
            <button
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
                setNotice("");
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
            <div className="icon-viewer-empty">
              <Search size={28} />
              <p>{t("empty")}</p>
              <button
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
          <aside className="icon-viewer-detail" aria-label={t("detail")}>
            <button
              type="button"
              className="settings-button icon-viewer-back"
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
            <h2>{current.name}</h2>
            <p>{t(`category.${current.category}`)} · Lucide</p>
            <div className="icon-viewer-settings-heading">
              <h3>{t("previewOptions")}</h3>
              <button
                type="button"
                className="settings-button"
                onClick={() => {
                  setPreview(defaults);
                  setNotice(t("previewReset"));
                  setError("");
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {t("resetPreview")}
              </button>
            </div>
            <div className="icon-viewer-controls">
              <label>
                {t("size")} <output>{preview.size} px</output>
                <input
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
                {t("stroke")} <output>{preview.stroke}</output>
                <input
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
                {t("color")}{" "}
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
                  className="icon-viewer-background"
                  role="group"
                  aria-label={t("background")}
                >
                  <button
                    aria-pressed={preview.background === "light"}
                    onClick={() =>
                      setPreview({
                        ...preview,
                        background: "light",
                      })
                    }
                  >
                    <Sun size={14} />
                    {t("light")}
                  </button>
                  <button
                    aria-pressed={preview.background === "dark"}
                    onClick={() =>
                      setPreview({
                        ...preview,
                        background: "dark",
                      })
                    }
                  >
                    <Moon size={14} />
                    {t("dark")}
                  </button>
                </div>
              </div>
            </div>
            {error && (
              <div className="icon-viewer-copy-error" role="alert">
                {error} {t("downloadInstead")}
              </div>
            )}
            <div className="icon-viewer-actions">
              <button onClick={() => void copy(current.name, t("copiedName"))}>
                <Copy size={14} />
                {t("copyName")}
              </button>
              <button onClick={() => void copy(svg(), t("copiedSvg"))}>
                <Copy size={14} />
                {t("copySvg")}
              </button>
              <button onClick={download}>
                <Download size={14} />
                {t("downloadSvg")}
              </button>
            </div>
            <div role="status" className="icon-viewer-status">
              {notice}
            </div>
            <code className="icon-viewer-source">src/ui/icons.ts</code>
          </aside>
        )}
      </div>
    </section>
  );
}
