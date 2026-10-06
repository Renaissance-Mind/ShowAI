import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Markdown } from "showai:components";
import "./style.css";

type Node = { label: string; role?: string; detail?: string; tag?: string };
type Fact = { label: string; source: string };
type Evidence = {
  label: string;
  explanation: string;
  code?: string;
  result?: string;
  url?: string;
};
type Frame = {
  label: string;
  action: string;
  facts: string[];
  added: string[];
};
type Diagram = {
  kind:
    | "roles"
    | "context"
    | "exchange"
    | "filetree"
    | "pipeline"
    | "hooks"
    | "overview";
  nodes: Node[];
  steps?: Node[];
  facts?: Fact[];
  files?: { name: string; note: string; depth: number; selected?: boolean }[];
  hooks?: { label: string; event: string; index: number; output: string }[];
  frames?: Frame[];
  caption?: string;
};
type Slide = {
  id: string;
  nav: string;
  kicker: string;
  title: string;
  lead: string;
  diagram: Diagram;
  added: string[];
  context: Fact[];
  note: string;
  evidence: Evidence[];
};
type Data = { title: string; scope: string; slides: Slide[] };

type Props = {
  data: Data;
  readOnly?: boolean;
  onChange?: (data: Data) => void;
};

function NodeBox({ node, number }: { node: Node; number?: number }) {
  return (
    <div className={`ed-node ed-role-${node.role ?? "resource"}`}>
      <div className="ed-node-top">
        {number !== undefined && (
          <span className="ed-step-number">{number + 1}</span>
        )}
        {node.tag && <span className="ed-node-tag">{node.tag}</span>}
      </div>
      <strong>{node.label}</strong>
      {node.detail && <p>{node.detail}</p>}
    </div>
  );
}
function Flow({ nodes }: { nodes: Node[] }) {
  return (
    <div className="ed-flow">
      {nodes.map((node, index) => (
        <div className="ed-flow-piece" key={index}>
          <NodeBox node={node} number={index} />
          {index < nodes.length - 1 && (
            <span className="ed-connector" aria-hidden="true">
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
function ContextWindow({
  facts,
  label = "模型此时可见",
}: {
  facts: Fact[];
  label?: string;
}) {
  return (
    <div className="ed-context-window">
      <div className="ed-window-bar">
        <span className="ed-window-mark" />
        {label}
      </div>
      <ul>
        {facts.map((fact, index) => (
          <li key={index}>
            <span>{fact.label}</span>
            <small>{fact.source}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
function DiagramView({ diagram }: { diagram: Diagram }) {
  const [frame, setFrame] = useState(0);
  const frames = diagram.frames ?? [];
  const current = frames[Math.min(frame, Math.max(0, frames.length - 1))];
  if (diagram.kind === "roles")
    return (
      <div className="ed-actors">
        {diagram.nodes.map((n, i) => (
          <NodeBox node={n} key={i} />
        ))}
      </div>
    );
  if (diagram.kind === "context")
    return (
      <div className="ed-context-flow">
        <div className="ed-inputs">
          {diagram.nodes.map((n, i) => (
            <div className="ed-input" key={i}>
              <span className="ed-input-source">{n.tag}</span>
              <strong>{n.label}</strong>
              <small>{n.detail}</small>
            </div>
          ))}
        </div>
        <span className="ed-large-arrow" aria-hidden="true">
          →
        </span>
        <ContextWindow facts={diagram.facts ?? []} />
      </div>
    );
  if (diagram.kind === "exchange")
    return (
      <>
        <div className="ed-lanes">
          {diagram.nodes.map((n, i) => (
            <div className={`ed-lane ed-role-${n.role}`} key={i}>
              <span>{n.tag}</span>
              <strong>{n.label}</strong>
              <p>{n.detail}</p>
            </div>
          ))}
        </div>
        <div className="ed-exchange-track">
          {(diagram.steps ?? []).map((n, i) => (
            <div className={`ed-exchange-step ed-role-${n.role}`} key={i}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{n.label}</strong>
              <small>{n.detail}</small>
              {i < (diagram.steps?.length ?? 0) - 1 && (
                <b aria-hidden="true">→</b>
              )}
            </div>
          ))}
        </div>
      </>
    );
  if (diagram.kind === "filetree")
    return (
      <div className="ed-reference-layout">
        <div className="ed-file-tree">
          <div className="ed-tree-caption">{diagram.caption}</div>
          {(diagram.files ?? []).map((f, i) => (
            <div
              className={`ed-file${f.selected ? " is-highlighted" : ""}`}
              style={{ paddingInlineStart: 18 + f.depth * 20 }}
              key={i}
            >
              <span className="ed-file-glyph" aria-hidden="true">
                {f.depth === 0 ? "▸" : "└"}
              </span>
              <code>{f.name}</code>
              <small>{f.note}</small>
            </div>
          ))}
        </div>
        <div className="ed-reference-output">
          <span className="ed-reference-arrow" aria-hidden="true">
            ↓
          </span>
          <ContextWindow facts={diagram.facts ?? []} label="读取指南后新增" />
        </div>
      </div>
    );
  if (diagram.kind === "pipeline")
    return (
      <>
        <Flow nodes={diagram.nodes} />
        {diagram.steps && (
          <div className="ed-output-row">
            {diagram.steps.map((n, i) => (
              <div key={i}>
                <span>{n.tag}</span>
                <strong>{n.label}</strong>
                <p>{n.detail}</p>
              </div>
            ))}
          </div>
        )}
      </>
    );
  if (diagram.kind === "hooks")
    return (
      <div className="ed-hooks">
        <div className="ed-event-track">
          {diagram.nodes.map((n, i) => (
            <div className="ed-event" key={i}>
              <span className="ed-event-dot" />
              <strong>{n.label}</strong>
              <small>{n.detail}</small>
            </div>
          ))}
        </div>
        <div className="ed-hook-track">
          {(diagram.hooks ?? []).map((hook, i) => (
            <div
              className="ed-hook"
              key={i}
              style={{ gridColumn: hook.index + 1 }}
            >
              <span className="ed-hook-link" aria-hidden="true" />
              <span className="ed-auto-label">宿主自动</span>
              <strong>{hook.label}</strong>
              <code>{hook.event}</code>
              <small>{hook.output}</small>
            </div>
          ))}
        </div>
      </div>
    );
  if (diagram.kind === "overview" && current)
    return (
      <div className="ed-overview">
        <div className="ed-frame-tabs" role="group" aria-label="选择上下文阶段">
          {frames.map((f, i) => (
            <button
              type="button"
              className={i === frame ? "is-active" : ""}
              aria-pressed={i === frame}
              onClick={() => setFrame(i)}
              key={i}
            >
              {i + 1}
              <span>{f.label}</span>
            </button>
          ))}
        </div>
        <div className="ed-frame-result" aria-live="polite">
          <div className="ed-frame-action">
            <small>这一步做了什么</small>
            <strong>{current.action}</strong>
          </div>
          <div className="ed-frame-facts">
            <small>这一步之后已取得的主要信息</small>
            <div>
              {current.facts.map((f, i) => (
                <span
                  className={current.added.includes(f) ? "is-new" : ""}
                  key={i}
                >
                  {current.added.includes(f) && <b>新增</b>}
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  return null;
}

export function readData(data: Data) {
  return {
    title: data.title,
    slideCount: data.slides.length,
    slides: data.slides.map((s) => ({
      id: s.id,
      title: s.title,
      added: s.added,
      evidenceLabels: s.evidence.map((e) => e.label),
    })),
    derived: ["slideCount"],
  };
}
export default function ExplainerDeck({ data, onChange, readOnly }: Props) {
  const [index, setIndex] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const id = useId().replace(/:/g, "-");
  useEffect(
    () => setIndex((i) => Math.min(i, Math.max(0, data.slides.length - 1))),
    [data.slides.length],
  );
  const slide = data.slides[index];
  if (!slide)
    return (
      <section className="ed-root">
        <p>添加讲解屏幕后开始演示。</p>
      </section>
    );
  const go = (next: number) => {
    setIndex(Math.max(0, Math.min(data.slides.length - 1, next)));
    setEvidenceOpen(false);
    setContextOpen(false);
    setEditOpen(false);
  };
  const keyboardGo = (next: number, target: HTMLElement) => {
    const bounded = Math.max(0, Math.min(data.slides.length - 1, next));
    go(bounded);
    if (target.closest("[role=tablist]"))
      document
        .getElementById(`${id}-tab-${bounded}`)
        ?.focus({ preventScroll: true });
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.matches("input,textarea,select") || target.isContentEditable)
      return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      keyboardGo(index + 1, target);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      keyboardGo(index - 1, target);
    }
    if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      keyboardGo(0, target);
    }
    if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      keyboardGo(data.slides.length - 1, target);
    }
    if (event.key === "Escape") {
      setEvidenceOpen(false);
      setContextOpen(false);
      setEditOpen(false);
    }
  };
  const patch = (field: "title" | "lead", value: string) =>
    onChange?.({
      ...data,
      slides: data.slides.map((s, i) =>
        i === index ? { ...s, [field]: value } : s,
      ),
    });
  return (
    <section
      className="ed-root"
      onKeyDown={keyboard}
      aria-label={data.title}
      contentEditable={false}
    >
      <header className="ed-topbar">
        <div className="ed-brand">
          <span className="ed-brand-mark" aria-hidden="true">
            ✳
          </span>
          <span>{data.title}</span>
        </div>
        <span className="ed-scope">{data.scope}</span>
      </header>
      <nav className="ed-navigation" role="tablist" aria-label="讲解章节">
        {data.slides.map((s, i) => (
          <button
            id={`${id}-tab-${i}`}
            type="button"
            role="tab"
            tabIndex={index === i ? 0 : -1}
            aria-selected={index === i}
            aria-controls={`${id}-panel`}
            onClick={() => go(i)}
            key={s.id}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {s.nav}
          </button>
        ))}
      </nav>
      <article
        className="ed-slide"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${index}`}
      >
        <div className="ed-heading" aria-live="polite">
          <span className="ed-kicker">{slide.kicker}</span>
          <h2>{slide.title}</h2>
          <p>{slide.lead}</p>
        </div>
        <div className="ed-diagram" key={slide.id}>
          <DiagramView diagram={slide.diagram} />
        </div>
        {slide.added.length > 0 && (
          <div className="ed-delta">
            <span className="ed-delta-label">本步新增上下文</span>
            <div>
              {slide.added.map((a, i) => (
                <strong key={i}>{a}</strong>
              ))}
            </div>
          </div>
        )}
        {slide.note && <p className="ed-note">{slide.note}</p>}
      </article>
      <footer className="ed-footer">
        <div className="ed-detail-actions">
          {slide.evidence.length > 0 && (
            <button
              type="button"
              className={evidenceOpen ? "is-open" : ""}
              aria-expanded={evidenceOpen}
              aria-controls={`${id}-evidence`}
              onClick={() => setEvidenceOpen((v) => !v)}
            >
              {evidenceOpen ? "收起实际调用" : "查看实际调用"}
              <span aria-hidden="true">{evidenceOpen ? "−" : "＋"}</span>
            </button>
          )}
          {slide.context.length > 0 && (
            <button
              type="button"
              aria-expanded={contextOpen}
              aria-controls={`${id}-context`}
              onClick={() => setContextOpen((v) => !v)}
            >
              {contextOpen ? "收起累计上下文" : "查看累计上下文"}
            </button>
          )}
          {!readOnly && onChange && (
            <button
              type="button"
              aria-expanded={editOpen}
              onClick={() => setEditOpen((v) => !v)}
            >
              编辑本屏
            </button>
          )}
        </div>
        <div className="ed-page-control">
          <span className="ed-page-number">
            {String(index + 1).padStart(2, "0")}{" "}
            <small>/ {String(data.slides.length).padStart(2, "0")}</small>
          </span>
          <button
            type="button"
            aria-label="上一屏"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            ←
          </button>
          <button
            type="button"
            className="ed-next"
            aria-label={
              index === data.slides.length - 1 ? "从头观看" : "下一屏"
            }
            onClick={() => go(index === data.slides.length - 1 ? 0 : index + 1)}
          >
            {index === data.slides.length - 1 ? "从头观看" : "下一屏"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </footer>
      {contextOpen && (
        <aside id={`${id}-context`} className="ed-detail-panel">
          <h3>本屏之前及本屏已取得的主要信息</h3>
          <ContextWindow facts={slide.context} />
          <p className="ed-note">
            累计表示本次取得过的信息；长会话压缩可能改变原文保留范围。
          </p>
        </aside>
      )}
      {evidenceOpen && (
        <aside
          id={`${id}-evidence`}
          className="ed-detail-panel"
          aria-label="实际调用与证据"
        >
          <div className="ed-detail-heading">
            <h3>实际调用与证据</h3>
            <button
              type="button"
              aria-label="关闭实际调用"
              onClick={() => setEvidenceOpen(false)}
            >
              关闭 ×
            </button>
          </div>
          {slide.evidence.map((e, i) => (
            <section className="ed-evidence" key={i}>
              <h4>{e.label}</h4>
              <Markdown
                data={{ content: e.explanation, fontSize: 15 }}
                readOnly={true}
              />
              {e.code && (
                <pre>
                  <code>{e.code}</code>
                </pre>
              )}
              {e.result && (
                <div className="ed-return">
                  <span>实际返回 / 依据</span>
                  <p>{e.result}</p>
                </div>
              )}
              {e.url && (
                <a href={e.url} target="_blank" rel="noopener noreferrer">
                  查看来源 ↗
                </a>
              )}
            </section>
          ))}
        </aside>
      )}
      {editOpen && (
        <div className="ed-edit">
          <label>
            本屏标题
            <input
              value={slide.title}
              maxLength={120}
              onChange={(e) => patch("title", e.target.value)}
            />
          </label>
          <label>
            本屏导语
            <textarea
              value={slide.lead}
              maxLength={300}
              onChange={(e) => patch("lead", e.target.value)}
            />
          </label>
        </div>
      )}
    </section>
  );
}
