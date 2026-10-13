import ExpandableSearch from "../components/ExpandableSearch";
import { useMemo, useRef, useState } from "react";
import * as icons from "../ui/icons";
import {
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

// This is the application's shared export list, never a second list of icons.
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
  const current = catalog.find((item) => item.name === selected) ?? catalog[0];
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
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="icon-viewer" aria-label={t("browser")}>
      <div className="icon-viewer-tools">
        <ExpandableSearch
          label={t("search")}
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={setQuery}
        />
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
              aria-pressed={selected === name}
              onClick={() => {
                setSelected(name);
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
              <span>{name}</span>
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
        <aside className="icon-viewer-detail" aria-label={t("detail")}>
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
                  setPreview({ ...preview, stroke: Number(event.target.value) })
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
                    color: "#252629",
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
                    color: "#ededed",
                  })
                }
              >
                <Moon size={14} />
                {t("dark")}
              </button>
              <button
                aria-label={t("reset")}
                title={t("reset")}
                onClick={() => setPreview(defaults)}
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
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
          {error && <p role="alert">{error}</p>}

          <code className="icon-viewer-source">src/ui/icons.ts</code>
        </aside>
      </div>
    </section>
  );
}
