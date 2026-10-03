import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Download, Moon, MoreHorizontal, Printer, Sun } from "lucide-react";
import { parseArtifact, serializeArtifact } from "./validation.mjs";
import type { ShowArtifact, ShowDocument } from "../types";
import { loadRemoteComponents } from "./remote.mjs";
import type { CompiledComponent } from "../components/custom/types";
import { PageContent } from "./PageContent";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import "./portable.css";
import "../design/tokens.css";
import "../design/content.css";

// Set only by the trusted inline exporter. Ordinary readers and the desktop app
// keep individual sandboxed iframes for custom code.
const inlineHost =
  window.document
    .getElementById("root")
    ?.closest<HTMLElement>("[data-showai-inline-root]") ?? null;

function downloadSource(
  document: ShowDocument,
  components: ShowArtifact["components"],
  remoteComponents: ShowArtifact["remoteComponents"],
) {
  const url = URL.createObjectURL(
    new Blob([serializeArtifact(document, components, remoteComponents)], {
      type: "application/json",
    }),
  );
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${document.title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "page"}.showai.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ArtifactReader({ artifact }: { artifact: ShowArtifact }) {
  const { document } = artifact;
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [remote, setRemote] = useState<CompiledComponent[]>([]);
  const [remoteError, setRemoteError] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(
    !!artifact.remoteComponents?.length,
  );
  useEffect(() => {
    if (!artifact.remoteComponents?.length) return;
    if (inlineHost) {
      setRemoteError("对话内页面必须完整打包组件，不能使用远程依赖。");
      setRemoteLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setRemoteLoading(true);
    void loadRemoteComponents(artifact.remoteComponents, {
      signal: controller.signal,
    })
      .then((components) => {
        if (active) {
          setRemote(components);
          setRemoteError("");
        }
      })
      .catch((error) => {
        if (active)
          setRemoteError(
            error instanceof Error
              ? error.message
              : "远程组件无法加载，请检查网络。",
          );
      })
      .finally(() => {
        if (active) setRemoteLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [artifact.remoteComponents]);
  useEffect(() => {
    window.document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", closeOnPointer);
    window.document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnPointer);
      window.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div className="portable-app">
      <div className="portable-options" ref={menuRef}>
        <button
          ref={menuButtonRef}
          className="portable-options-trigger"
          aria-label="页面选项"
          aria-expanded={menuOpen}
          aria-controls="page-options"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal size={19} />
        </button>
        {menuOpen && (
          <div className="portable-options-menu" id="page-options">
            <button
              onClick={() => {
                downloadSource(
                  document,
                  artifact.components,
                  artifact.remoteComponents,
                );
                setMenuOpen(false);
              }}
            >
              <Download size={15} /> 下载源文件
            </button>
            <button
              onClick={() => {
                setDark(!dark);
                setMenuOpen(false);
              }}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
              {dark ? "浅色外观" : "深色外观"}
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                window.print();
              }}
            >
              <Printer size={15} /> 打印
            </button>
          </div>
        )}
      </div>
      <main className="portable-document">
        {document.title && <h1 className="portable-title">{document.title}</h1>}
        {!!artifact.remoteComponents?.length && (
          <p className="portable-network-note">
            {remoteLoading
              ? "正在校验并加载已发布的固定版本组件…"
              : "此页面使用已发布的固定版本组件，需要联网加载。"}
          </p>
        )}
        {remoteError && (
          <p role="alert" className="portable-network-error">
            {remoteError}
          </p>
        )}
        <CustomComponentsProvider
          components={[...(artifact.components ?? []), ...remote]}
          inlineHost={inlineHost}
        >
          <PageContent content={document.content} />
        </CustomComponentsProvider>
      </main>
    </div>
  );
}

function App() {
  const result = useMemo(() => {
    const raw = window.document.getElementById("showai-data")?.textContent;
    if (!raw || raw.trim() === "null") return { error: "页面内容为空。" };
    try {
      return { artifact: parseArtifact(raw) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "无法读取这份页面。",
      };
    }
  }, []);
  if (!result.artifact)
    return (
      <main className="portable-error">
        <h1>无法打开页面</h1>
        <p>{result.error}</p>
      </main>
    );
  return <ArtifactReader artifact={result.artifact} />;
}

createRoot(window.document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
