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
import "./icon-viewer.css";

function category(name: string) {
  if (
    /Align|Bold|Heading|Highlighter|Italic|List|Quote|Strikethrough|Type|Underline|Code/.test(
      name,
    )
  )
    return "文字与排版";
  if (
    /Chart|Columns|Database|Flask|Gauge|Image|Table|Workflow|Puzzle|Blocks/.test(
      name,
    )
  )
    return "内容与数据";
  if (/File|Folder|Package|Download|Upload|Printer|Copy|History/.test(name))
    return "文件与项目";
  if (
    /Arrow|Chevron|Expand|Focus|Grip|Layout|Maximize|Mouse|Panel|Square|Circle|Layers/.test(
      name,
    )
  )
    return "导航与画布";
  return "操作与状态";
}

// This is the application's shared export list, never a second list of icons.
const catalog = Object.entries(icons).map(([name, Icon]) => ({
  name,
  Icon,
  category: category(name),
}));
const categories = [...new Set(catalog.map((item) => item.category))];
const categoryIcons = {
  全部: Shapes,
  文字与排版: Type,
  内容与数据: Database,
  文件与项目: Folder,
  导航与画布: LayoutDashboard,
  操作与状态: Settings2,
};
const defaults = {
  size: 24,
  stroke: 1.7,
  color: "#252629",
  background: "light" as "light" | "dark",
};

export default function IconViewer() {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("全部");
  const [selected, setSelected] = useState(catalog[0].name);
  const [preview, setPreview] = useState(defaults);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const specimen = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () =>
      catalog.filter(
        (item) =>
          (group === "全部" || item.category === group) &&
          `${item.name} ${item.category}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [group, query],
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
        `复制失败：${reason instanceof Error ? reason.message : String(reason)}`,
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
    <section className="icon-viewer" aria-label="应用图标浏览器">
      <div className="icon-viewer-tools">
        <ExpandableSearch
          label="搜索图标"
          placeholder="搜索图标名称或分类…"
          value={query}
          onChange={setQuery}
        />
        <span className="icon-viewer-count" aria-live="polite">
          {visible.length} / {catalog.length} 个图标
        </span>
      </div>
      <div
        className="icon-viewer-categories"
        role="group"
        aria-label="图标分类"
      >
        {["全部", ...categories].map((item) => {
          const CategoryIcon =
            categoryIcons[item as keyof typeof categoryIcons];
          return (
            <button
              key={item}
              aria-pressed={group === item}
              onClick={() => setGroup(item)}
            >
              <CategoryIcon size={14} aria-hidden="true" />
              {item}
            </button>
          );
        })}
      </div>
      <div className="icon-viewer-layout">
        <div className="icon-viewer-grid" role="group" aria-label="图标列表">
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
              <p>没有找到图标</p>
              <button
                onClick={() => {
                  setQuery("");
                  setGroup("全部");
                }}
              >
                显示全部图标
              </button>
            </div>
          )}
        </div>
        <aside className="icon-viewer-detail" aria-label="图标详情">
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
          <p>{current.category} · Lucide</p>
          <div className="icon-viewer-controls">
            <label>
              尺寸 <output>{preview.size} px</output>
              <input
                aria-label="图标尺寸"
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
              线宽 <output>{preview.stroke}</output>
              <input
                aria-label="图标线宽"
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
              颜色{" "}
              <input
                aria-label="图标颜色"
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
              aria-label="预览背景"
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
                浅色
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
                深色
              </button>
              <button
                aria-label="重置图标预览"
                title="重置图标预览"
                onClick={() => setPreview(defaults)}
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
          <div className="icon-viewer-actions">
            <button onClick={() => void copy(current.name, "已复制图标名称")}>
              <Copy size={14} />
              复制名称
            </button>
            <button onClick={() => void copy(svg(), "已复制 SVG")}>
              <Copy size={14} />
              复制 SVG
            </button>
            <button onClick={download}>
              <Download size={14} />
              下载 SVG
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
