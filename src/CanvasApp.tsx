import { linearContent } from "./surface/document.mjs";
import { upgradeResource } from "./surface/containers.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  FileJson,
  FileText,
  MoreHorizontal,
  Moon,
  Sun,
  Upload,
  X,
} from "./ui/icons";
import SurfaceEditor from "./surface/SurfaceEditor";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "./lib/artifact";
import { CANVAS_KEY } from "./lib/canvas";
import {
  buildCanvasArtifactHtml,
  loadCanvasArtifact,
  materializeCanvasArtifact,
  retainCanvasArtifact,
  saveCanvasArtifact,
} from "./portable/canvas";
import { CustomComponentsProvider } from "./components/custom/CustomBlock";
import type { CompiledComponent } from "./components/custom/types";
import { downloadFile, newDocument, toMarkdown } from "./lib/document";
import { parseMarkdown } from "./lib/markdown";
import type { ShowArtifact, ShowDocument } from "./types";

function initialPage() {
  try {
    const artifact = loadCanvasArtifact(localStorage);
    const original = localStorage.getItem(CANVAS_KEY);
    const backupKey = `showai.migration.v1:${artifact.document.id}`;
    if (original && artifact.version === 1 && !localStorage.getItem(backupKey))
      localStorage.setItem(backupKey, original);
    return {
      document: upgradeResource(artifact.document),
      components: artifact.components ?? [],
      error: "",
    };
  } catch {
    return {
      document: newDocument(),
      components: [] as CompiledComponent[],
      error: "本地页面未能读取，原始数据已保留。",
    };
  }
}

export default function App() {
  const [initial] = useState(initialPage);
  const [page, setPage] = useState(initial.document);
  const [components, setComponents] = useState(initial.components);
  const [error, setError] = useState(initial.error);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dark, setDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = useRef(page);
  const currentComponents = useRef(components);
  const blocked = useRef(!!initial.error);
  const importGeneration = useRef(0);
  current.current = page;
  currentComponents.current = components;

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
    document.title = page.title ? `${page.title} · ShowAI` : "ShowAI";
  }, [page.title]);

  const persist = useCallback(() => {
    if (blocked.current) return;
    try {
      saveCanvasArtifact(localStorage, {
        format: "showai",
        version: 1,
        document: current.current,
        components: currentComponents.current,
      });
      setError("");
    } catch {
      setError("保存失败，请下载源文件备份。");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(persist, 300);
    return () => clearTimeout(timer);
  }, [page, components, persist]);

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [persist]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      )
        setMenuOpen(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        buttonRef.current?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]',
          ) ?? []),
        ];
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        event.preventDefault();
        items[
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, [menuOpen]);

  const update = useCallback((changes: Partial<ShowDocument>) => {
    setPage((document) => ({
      ...document,
      ...changes,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  async function exportPage(kind: "html" | "json" | "md") {
    setMenuOpen(false);
    setBusy(true);
    try {
      const source = current.current;
      const name = source.title.trim() || "ShowAI";
      if (kind === "html")
        downloadFile(
          `${name}.html`,
          await buildCanvasArtifactHtml({
            format: "showai",
            version: 1,
            document: source,
            components: currentComponents.current,
          }),
          "text/html;charset=utf-8",
        );
      if (kind === "json")
        downloadFile(
          `${name}.showai.json`,
          serializeArtifact(source, currentComponents.current),
          "application/json",
        );
      if (kind === "md")
        downloadFile(
          `${name}.md`,
          (source.title ? `# ${source.title}\n\n` : "") +
            toMarkdown(linearContent(source)),
          "text/markdown;charset=utf-8",
        );
      setNotice("已导出");
    } catch (reason) {
      setError(
        `导出失败：${reason instanceof Error ? reason.message : "请重试"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function openFile(file: File) {
    const request = ++importGeneration.current;
    setMenuOpen(false);
    if (file.size > 10 * 1024 * 1024) {
      setError("页面文件不能超过 10 MB。");
      return;
    }
    try {
      const raw = await file.text();
      let incoming: ShowDocument;
      let incomingComponents: CompiledComponent[] = [];
      let remoteComponents: ShowArtifact["remoteComponents"];
      if (/\.(md|markdown|txt)$/i.test(file.name)) {
        incoming = newDocument(file.name.replace(/\.[^.]+$/, ""));
        incoming.content = parseMarkdown(raw);
        incoming = validateDocument(incoming);
      } else if (/\.html?$/i.test(file.name)) {
        const html = new DOMParser().parseFromString(raw, "text/html");
        const source =
          html.getElementById("showai-data") ??
          [...html.querySelectorAll('script[type="application/json"]')].find(
            (element) => /^showai-.+-data$/.test(element.id),
          );
        const artifact = parseArtifact(source?.textContent ?? "");
        incoming = artifact.document;
        incomingComponents = artifact.components ?? [];
        remoteComponents = artifact.remoteComponents;
      } else {
        const artifact = parseArtifact(raw);
        incoming = artifact.document;
        incomingComponents = artifact.components ?? [];
        remoteComponents = artifact.remoteComponents;
      }
      const materialized = await materializeCanvasArtifact({
        format: "showai",
        version: 1,
        document: incoming,
        components: incomingComponents,
        remoteComponents,
      });
      if (request !== importGeneration.current) return;
      incomingComponents = materialized.components ?? [];
      retainCanvasArtifact(localStorage, {
        format: "showai",
        version: 1,
        document: current.current,
        components: currentComponents.current,
      });
      if (blocked.current)
        localStorage.setItem(
          "showai.canvas.recovery",
          localStorage.getItem(CANVAS_KEY) ?? "",
        );
      saveCanvasArtifact(localStorage, {
        format: "showai",
        version: 1,
        document: incoming,
        components: incomingComponents,
      });
      blocked.current = false;
      setPage(incoming);
      setComponents(incomingComponents);
      setError("");
      window.scrollTo(0, 0);
    } catch (reason) {
      if (request !== importGeneration.current) return;
      setError(
        `打开失败：${reason instanceof Error ? reason.message : "请检查页面格式"}`,
      );
    }
  }

  return (
    <div className="canvas-app">
      <div className="canvas-actions">
        <button
          className="canvas-icon-button"
          aria-label="导出页面"
          title="导出页面"
          disabled={busy}
          onClick={() => void exportPage("html")}
        >
          {busy ? (
            <span className="canvas-spinner" />
          ) : (
            <ArrowUpRight size={18} />
          )}
        </button>
        <div className="canvas-menu-anchor">
          <button
            ref={buttonRef}
            className="canvas-icon-button"
            aria-label="页面选项"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="页面选项"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <MoreHorizontal size={19} />
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              className="canvas-menu"
              role="menu"
              aria-label="页面选项"
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node) &&
                  event.relatedTarget !== buttonRef.current
                )
                  setMenuOpen(false);
              }}
            >
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  fileRef.current?.click();
                }}
              >
                <Upload size={15} />
                打开页面…
              </button>
              <button
                role="menuitem"
                disabled={busy}
                onClick={() => void exportPage("json")}
              >
                <FileJson size={15} />
                下载源文件
              </button>
              <button
                role="menuitem"
                disabled={busy}
                onClick={() => void exportPage("md")}
              >
                <FileText size={15} />
                导出 Markdown
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setDark(!dark);
                  setMenuOpen(false);
                }}
              >
                {dark ? <Sun size={15} /> : <Moon size={15} />}
                {dark ? "浅色外观" : "深色外观"}
              </button>
            </div>
          )}
        </div>
      </div>
      {error && (
        <div className="canvas-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void exportPage("json")}>下载源文件</button>
          <button
            className="canvas-icon-button"
            aria-label="关闭提示"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <CustomComponentsProvider components={components}>
        <SurfaceEditor
          key={page.id}
          document={page}
          onChange={(next) => update(next)}
          header={
            <textarea
              ref={titleRef}
              className="surface-page-title"
              aria-label="页面标题"
              placeholder="无标题"
              rows={1}
              maxLength={1000}
              value={page.title}
              onChange={(event) =>
                update({ title: event.target.value.replaceAll("\n", "") })
              }
            />
          }
        />
      </CustomComponentsProvider>
      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept=".json,.md,.markdown,.txt,.html,.htm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = "";
        }}
      />
      {notice && (
        <div className="canvas-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
