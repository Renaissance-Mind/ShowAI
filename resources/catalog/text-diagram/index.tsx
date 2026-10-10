import { useEffect, useId, useMemo, useRef, useState } from "react";
import { inspect, renderDiagram, syntax, type DiagramData } from "./engine.js";
import "./style.css";
import "./diagram.css";

export const readData = inspect;
function preview(data: DiagramData, uid: string) {
  // A syntax error is a user-input boundary: retain the draft and show its cause.
  try {
    return { ...renderDiagram(data, uid), error: "" };
  } catch (error) {
    return {
      html: "",
      model: { warnings: [] },
      error:
        error instanceof Error
          ? `${"line" in error && error.line ? `第 ${error.line} 行：` : ""}${error.message}`
          : String(error),
    };
  }
}
export default function TextDiagram({
  data,
  onChange,
  readOnly = true,
}: {
  data: DiagramData;
  onChange?: (next: DiagramData) => void;
  readOnly?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [draft, setDraft] = useState<DiagramData | null>(null);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState("changes");
  const [help, setHelp] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const current = draft ?? data;
  const output = useMemo(() => preview(current, `sd-${uid}`), [current, uid]);
  useEffect(() => {
    setDraft(null);
    setZoom(1);
    setView("changes");
  }, [data]);
  const naturalWidth = Number(
    output.html.match(/<svg[^>]*width="([0-9]+)"/)?.[1] ?? 800,
  );
  const editing = !readOnly && !!onChange;
  const changed = output.html.includes("data-delta=");
  function cancel() {
    setDraft(null);
    editButton.current?.focus();
  }
  return (
    <section className="sd-diagram" aria-label={data.title || "文本关系图"}>
      <header className="sd-header">
        <div>
          <h3>{current.title || "文本关系图"}</h3>
          {current.description && <p>{current.description}</p>}
        </div>
        <div className="sd-controls" role="group" aria-label="图形操作">
          <button
            type="button"
            aria-label="缩小"
            disabled={zoom <= 0.5}
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          >
            −
          </button>
          <button
            type="button"
            aria-label="适应宽度"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="放大"
            disabled={zoom >= 3}
            onClick={() => setZoom(Math.min(3, zoom + 0.25))}
          >
            ＋
          </button>
          <button
            type="button"
            aria-expanded={sourceOpen}
            onClick={() => setSourceOpen(!sourceOpen)}
          >
            查看描述
          </button>
          {editing && !draft && (
            <button
              type="button"
              ref={editButton}
              onClick={() => {
                setDraft({ ...data });
                setHelp(false);
              }}
            >
              编辑图形
            </button>
          )}
        </div>
      </header>
      {draft && editing && (
        <form
          className="sd-editor"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!output.error) {
              onChange?.(draft);
              setDraft(null);
              editButton.current?.focus();
            }
          }}
        >
          <div className="sd-fields">
            <label>
              标题
              <input
                value={draft.title ?? ""}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              图形类型
              <select
                value={draft.type}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    type: e.target.value as DiagramData["type"],
                  })
                }
              >
                <option value="flow">结构关系图</option>
                <option value="sequence">时序图</option>
              </select>
            </label>
            {draft.type === "flow" ? (
              <label>
                排布方向
                <select
                  value={draft.direction ?? "TB"}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      direction: e.target.value as DiagramData["direction"],
                    })
                  }
                >
                  <option value="TB">从上到下</option>
                  <option value="LR">从左到右</option>
                  <option value="BT">从下到上</option>
                  <option value="RL">从右到左</option>
                </select>
              </label>
            ) : (
              <label className="sd-check">
                <input
                  type="checkbox"
                  checked={draft.numbered !== false}
                  onChange={(e) =>
                    setDraft({ ...draft, numbered: e.target.checked })
                  }
                />
                消息编号
              </label>
            )}
          </div>
          <label>
            图形描述
            <textarea
              autoFocus
              spellCheck={false}
              rows={8}
              maxLength={12000}
              value={draft.source}
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            />
          </label>
          <div className="sd-actions">
            <button
              type="button"
              aria-expanded={help}
              onClick={() => setHelp(!help)}
            >
              语法参考
            </button>
            <span />
            <button type="button" onClick={cancel}>
              取消
            </button>
            <button type="submit" disabled={!!output.error}>
              保存图形
            </button>
          </div>
          {help && <pre className="sd-source">{syntax[draft.type]}</pre>}
        </form>
      )}
      {output.error ? (
        <p className="sd-error" role="alert">
          {output.error}
        </p>
      ) : (
        <>
          {changed && (
            <div className="sd-views" role="group" aria-label="变更视图">
              {[
                ["before", "变更前"],
                ["changes", "变更"],
                ["after", "变更后"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div
            className={`sd-viewport am-view-${view}`}
            tabIndex={0}
            role="region"
            aria-label="图形，放大后可横向滚动"
          >
            {output.html ? (
              <div
                className="sd-drawing"
                style={{
                  width: `${zoom * 100}%`,
                  maxWidth: `${naturalWidth * 1.35 * zoom}px`,
                }}
                dangerouslySetInnerHTML={{ __html: output.html }}
              />
            ) : (
              <p className="sd-empty">写下节点之间的关系，即可生成图形。</p>
            )}
          </div>
          {output.model.warnings?.map((warning, i) => (
            <p key={i} className="sd-warning">
              第 {warning.line} 行：{warning.message}
            </p>
          ))}
        </>
      )}
      {sourceOpen && !draft && (
        <pre className="sd-source">{data.source || "暂无图形描述"}</pre>
      )}
    </section>
  );
}
