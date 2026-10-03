import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
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
  link.download = `${document.title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "document"}.showai.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ArtifactReader({ artifact }: { artifact: ShowArtifact }) {
  const { document } = artifact;
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [wide, setWide] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const editor = useEditor({
    extensions: createExtensions({ readOnly: true }),
    content: document.content,
    editable: false,
    immediatelyRender: true,
  });
  const headings = useMemo(() => {
    const result: { text: string; level: number; id: string }[] = [];
    const visit = (node: ShowDocument["content"]) => {
      if (node.type === "heading")
        result.push({
          text: node.content?.map((child) => child.text ?? "").join("") ?? "",
          level: Number(node.attrs?.level ?? 2),
          id: `section-${result.length + 1}`,
        });
      node.content?.forEach(visit);
    };
    visit(document.content);
    return result;
  }, [document.content]);

  useEffect(() => {
    window.document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    if (!editor) return;
    editor.view.dom
      .querySelectorAll("h1,h2,h3,h4,h5,h6")
      .forEach((heading, index) => {
        heading.id = `section-${index + 1}`;
      });
  }, [editor, headings]);

  return (
    <div className={`portable-app ${wide ? "is-wide" : ""}`}>
      <header className="portable-toolbar">
        <a
          href="#document-top"
          className="portable-brand"
          aria-label="ShowAI 文档"
        >
          <span>✦</span> ShowAI <i>/</i>
          <span className="portable-toolbar-title">
            {document.title || "无标题"}
          </span>
        </a>
        <nav aria-label="文档操作">
          {headings.length > 0 && (
            <button
              onClick={() => setTocOpen(!tocOpen)}
              aria-expanded={tocOpen}
            >
              目录
            </button>
          )}
          <button onClick={() => setWide(!wide)} aria-pressed={wide}>
            {wide ? "标准宽度" : "宽页模式"}
          </button>
          <button
            onClick={() => setDark(!dark)}
            aria-label={dark ? "切换浅色外观" : "切换深色外观"}
          >
            {dark ? "☀" : "◐"}
          </button>
          <button onClick={() => window.print()}>打印</button>
          <button
            className="portable-source-button"
            onClick={() => downloadSource(document)}
          >
            下载源文件 ↗
          </button>
        </nav>
      </header>
      {tocOpen && (
        <aside className="portable-toc" aria-label="文档目录">
          <div className="portable-toc-title">
            本文目录
            <button onClick={() => setTocOpen(false)} aria-label="关闭目录">
              ×
            </button>
          </div>
          {headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              style={{ paddingLeft: Math.max(0, heading.level - 1) * 10 + 12 }}
              onClick={() => setTocOpen(false)}
            >
              {heading.text || "未命名标题"}
            </a>
          ))}
        </aside>
      )}
      <main id="document-top" className="portable-document">
        {document.cover && document.cover !== "none" && (
          <div
            className={`portable-cover cover-${document.cover}`}
            aria-hidden="true"
          >
            <div />
            <span>让想法继续生长。</span>
          </div>
        )}
        <div className="portable-document-body">
          <div className="portable-document-icon" aria-hidden="true">
            {document.icon || "✦"}
          </div>
          <p className="portable-eyebrow">一份可以探索的文档</p>
          <h1 className="portable-title">{document.title || "无标题"}</h1>
          <div className="portable-meta">
            <span>ShowAI 文档</span>
            <span>·</span>
            <time dateTime={document.updatedAt}>
              {new Date(document.updatedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
            <span>·</span>
            <span>探索下方的内容</span>
          </div>
          <EditorContent editor={editor} className="portable-editor" />
          {document.comments.length > 0 && (
            <details className="portable-comments">
              <summary>文档批注 · {document.comments.length}</summary>
              {document.comments.map((comment) => (
                <div key={comment.id} className="portable-comment">
                  <p>{comment.text}</p>
                  <small>
                    {comment.resolved ? "已解决 · " : ""}
                    {new Date(comment.createdAt).toLocaleDateString()}
                  </small>
                </div>
              ))}
            </details>
          )}
          <footer className="portable-footer">
            <span>✦ ShowAI</span>
            <p>保存源文件，让思考继续。</p>
            <button onClick={() => downloadSource(document)}>
              下载可编辑源文件 ↗
            </button>
          </footer>
        </div>
      </main>
    </div>
  );
}

function App() {
  const result = useMemo(() => {
    const raw = window.document.getElementById("showai-data")?.textContent;
    if (!raw || raw.trim() === "null")
      return {
        error:
          "这是 ShowAI 阅读器模板。请从 ShowAI 导出文档，或使用插件附带的命令生成完整的交互文档。",
      };
    try {
      return { artifact: parseArtifact(raw) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "无法读取这份文档。",
      };
    }
  }, []);
  if (!result.artifact)
    return (
      <main className="portable-error">
        <span>✦</span>
        <h1>ShowAI 文档</h1>
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
