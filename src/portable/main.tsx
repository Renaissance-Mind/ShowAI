import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import { Download, Moon, MoreHorizontal, Printer, Sun } from "lucide-react";
import { createExtensions } from "../editor/extensions";
import { parseArtifact, serializeArtifact } from "./validation.mjs";
import type { ShowArtifact, ShowDocument } from "../types";
import "../editor/editor.css";
import "./portable.css";

function downloadSource(document: ShowDocument) {
  const url = URL.createObjectURL(
    new Blob([serializeArtifact(document)], { type: "application/json" }),
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
  const editor = useEditor({
    extensions: createExtensions({ readOnly: true }),
    content: document.content,
    editable: false,
    immediatelyRender: true,
  });

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
                downloadSource(document);
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
        <EditorContent editor={editor} className="portable-editor" />
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
