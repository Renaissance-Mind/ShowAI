import { useEffect, useId, useRef, useState } from "react";
import type { BlockProps } from "./types";
import {
  evidenceTimeBuckets,
  selectEvidence,
} from "./presentation-contract.mjs";
import "./presentation.css";

type Source = { label: string; url: string };
type Part = { id: string; label: string };
type State = {
  id: string;
  value: string;
  status: "changed" | "retained" | "fixed";
};
type Frame = {
  id: string;
  title: string;
  explanation: string;
  condition?: string;
  states: State[];
  links: { from: string; to: string; label: string }[];
  sources?: Source[];
};
type Mechanism = {
  title: string;
  introduction?: string;
  parts: Part[];
  frames: Frame[];
};
type Evidence = {
  id: string;
  title: string;
  label?: string;
  category: string;
  date?: string;
  dateLabel?: string;
  claim: string;
  boundary: string;
  values: Record<string, string>;
  sources?: Source[];
};
type Explorer = {
  title: string;
  introduction?: string;
  dimensions: Part[];
  items: Evidence[];
  layout?: "list" | "timeline";
  timeScale?: "month" | "year";
};
const statusNames = {
  changed: "本步改变",
  retained: "承接保留",
  fixed: "保持固定",
};
function Sources({ sources = [] }: { sources?: Source[] }) {
  return sources.length ? (
    <p className="sp-sources">
      依据：
      {sources.map((s, i) => (
        <a
          key={`${s.url}-${i}`}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {s.label}
        </a>
      ))}
    </p>
  ) : null;
}
function FrameView({ frame, parts }: { frame: Frame; parts: Part[] }) {
  return (
    <article className="sp-frame">
      <h3>{frame.title}</h3>
      <div
        className="sp-parts"
        style={{
          gridTemplateColumns: `repeat(${Math.min(parts.length, 4)}, minmax(0, 1fr))`,
        }}
      >
        {parts.map((part) => {
          const state = frame.states.find((s) => s.id === part.id)!;
          return (
            <div className={`sp-part sp-${state.status}`} key={part.id}>
              <div className="sp-state">{statusNames[state.status]}</div>
              <h4>{part.label}</h4>
              <p>{state.value}</p>
            </div>
          );
        })}
      </div>
      {frame.links.length > 0 && (
        <ol className="sp-links" aria-label="作用关系">
          {frame.links.map((l, i) => (
            <li key={i}>
              <strong>{parts.find((p) => p.id === l.from)?.label}</strong>
              <span aria-hidden="true"> → </span>
              <span>{l.label}</span>
              <span aria-hidden="true"> → </span>
              <strong>{parts.find((p) => p.id === l.to)?.label}</strong>
            </li>
          ))}
        </ol>
      )}
      <p className="sp-explanation">{frame.explanation}</p>
      {frame.condition && (
        <p className="sp-boundary">
          <strong>成立条件：</strong>
          {frame.condition}
        </p>
      )}
      <Sources sources={frame.sources} />
    </article>
  );
}

export function MechanismStepsBlock({ data }: BlockProps) {
  const model = data as unknown as Mechanism;
  const [selected, setSelected] = useState(model.frames[0]?.id ?? "");
  const [all, setAll] = useState(false);
  const uid = useId();
  const index = Math.max(
    0,
    model.frames.findIndex((f) => f.id === selected),
  );
  useEffect(() => {
    if (!model.frames.some((f) => f.id === selected))
      setSelected(model.frames[0]?.id ?? "");
  }, [model.frames, selected]);
  return (
    <section className="sp-block sp-mechanism" aria-label={model.title}>
      <header>
        <h2>{model.title}</h2>
        {model.introduction && <p>{model.introduction}</p>}
      </header>
      {!model.frames.length ? (
        <p className="sp-empty">
          尚未填写机制。为同一组对象添加连续状态、变化原因与成立条件。
        </p>
      ) : (
        <>
          <nav className="sp-controls" aria-label="机制步骤">
            <div className="sp-step-list">
              {model.frames.map((frame, i) => (
                <button
                  type="button"
                  key={frame.id}
                  aria-pressed={selected === frame.id}
                  aria-controls={uid}
                  onClick={() => {
                    setSelected(frame.id);
                    setAll(false);
                  }}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {frame.title}
                </button>
              ))}
            </div>
            <div className="sp-buttons">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  setSelected(model.frames[index - 1].id);
                  setAll(false);
                }}
              >
                上一步
              </button>
              <button
                type="button"
                disabled={index === model.frames.length - 1}
                onClick={() => {
                  setSelected(model.frames[index + 1].id);
                  setAll(false);
                }}
              >
                下一步
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(model.frames[0].id);
                  setAll(false);
                }}
              >
                回到起点
              </button>
              <button
                type="button"
                aria-pressed={all}
                onClick={() => setAll(!all)}
              >
                {all ? "逐步阅读" : "展开全部步骤"}
              </button>
            </div>
          </nav>
          <div
            id={uid}
            className={all ? "sp-current sp-all" : "sp-current"}
            aria-live="polite"
          >
            {(all ? model.frames : [model.frames[index]]).map((frame) => (
              <FrameView key={frame.id} frame={frame} parts={model.parts} />
            ))}
          </div>
          <div className="sp-print">
            {model.frames.map((frame) => (
              <FrameView key={frame.id} frame={frame} parts={model.parts} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function EvidenceDetail({
  item,
  dimensions,
}: {
  item: Evidence;
  dimensions: Part[];
}) {
  return (
    <article className="sp-detail">
      <div className="sp-category">
        {item.category}
        {item.date ? ` · ${item.dateLabel} ${item.date}` : ""}
      </div>
      <h3>{item.title}</h3>
      <p className="sp-explanation">{item.claim}</p>
      <dl>
        {dimensions.map((d) => (
          <div key={d.id}>
            <dt>{d.label}</dt>
            <dd>{item.values[d.id] ?? "资料未提供"}</dd>
          </div>
        ))}
      </dl>
      <p className="sp-boundary">
        <strong>解释边界：</strong>
        {item.boundary}
      </p>
      <Sources sources={item.sources} />
    </article>
  );
}
function EvidenceTimeline({
  items,
  scale,
  selected,
  detailId,
  onSelect,
  pinned,
  onPin,
}: {
  items: Evidence[];
  scale: "month" | "year";
  selected?: string;
  detailId: string;
  onSelect: (id: string) => void;
  pinned: string[];
  onPin: (id: string, checked: boolean) => void;
}) {
  const dates = evidenceTimeBuckets(items, scale);
  const buckets = items.some((i) => !i.date) ? [...dates, "未标日期"] : dates;
  const categories = [...new Set(items.map((i) => i.category))];
  const bucket = (item: Evidence) =>
    item.date?.slice(0, scale === "year" ? 4 : 7) ?? "未标日期";
  return (
    <div
      className="sp-timeline-wrap"
      tabIndex={0}
      aria-label="按主题与时间定位证据，可横向滚动"
    >
      <table className="sp-timeline">
        <caption>
          按条目标注日期排列；空格表示本报告未收录，不能推断该时期没有进展。选择条目打开依据与条件，关闭后回到当前位置。
        </caption>
        <thead>
          <tr>
            <th scope="col">主题</th>
            {buckets.map((date) => (
              <th scope="col" key={date}>
                {date}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category}>
              <th scope="row">{category}</th>
              {buckets.map((date) => (
                <td key={date}>
                  {items
                    .filter(
                      (i) => i.category === category && bucket(i) === date,
                    )
                    .map((item) => (
                      <div className="sp-timeline-item" key={item.id}>
                        <button
                          type="button"
                          aria-label={`${item.title} · ${item.dateLabel ?? "日期未提供"} ${item.date ?? ""}`}
                          aria-pressed={item.id === selected}
                          aria-controls={detailId}
                          onClick={() => onSelect(item.id)}
                        >
                          <span className="sp-event-dot" aria-hidden="true" />
                          <span>{item.label ?? item.title}</span>
                        </button>
                        <label className="sp-pin">
                          <input
                            type="checkbox"
                            checked={pinned.includes(item.id)}
                            onChange={(e) => onPin(item.id, e.target.checked)}
                            aria-label={`将${item.title}加入比较`}
                          />
                          加入比较
                        </label>
                      </div>
                    ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p>没有符合条件的条目。可重置视图。</p>}
    </div>
  );
}

export function EvidenceExplorerBlock({ data }: BlockProps) {
  const model = data as unknown as Explorer;
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(model.items[0]?.id ?? "");
  const [view, setView] = useState<"overview" | "compare">("overview");
  const [pinned, setPinned] = useState<string[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const visible = selectEvidence(model.items, category, query);
  const active = visible.find((i) => i.id === selected) ?? visible[0];
  useEffect(() => {
    if (detailOpen && active && !dialog.current?.open)
      dialog.current?.showModal();
    if ((!detailOpen || !active) && dialog.current?.open)
      dialog.current.close();
  }, [detailOpen, active]);
  const comparison = pinned.length
    ? model.items.filter((i) => pinned.includes(i.id))
    : visible;
  useEffect(() => {
    setPinned((current) => {
      const next = current.filter((id) =>
        model.items.some((item) => item.id === id),
      );
      return next.length === current.length ? current : next;
    });
  }, [model.items]);
  function pin(id: string, checked: boolean) {
    setPinned((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((value) => value !== id),
    );
  }
  function reset() {
    setCategory("");
    setQuery("");
    setPinned([]);
    setView("overview");
    setSelected(model.items[0]?.id ?? "");
    setDetailOpen(false);
  }
  return (
    <section className="sp-block sp-evidence" aria-label={model.title}>
      <header>
        <h2>{model.title}</h2>
        {model.introduction && <p>{model.introduction}</p>}
      </header>
      {!model.items.length ? (
        <p className="sp-empty">
          尚未填写证据。添加有来源的条目、共同比较维度和解释边界。
        </p>
      ) : (
        <>
          <div className="sp-controls">
            <div className="sp-buttons">
              <button
                type="button"
                aria-pressed={view === "overview"}
                onClick={() => setView("overview")}
              >
                总览与详情
              </button>
              <button
                type="button"
                aria-pressed={view === "compare"}
                onClick={() => setView("compare")}
              >
                按共同维度比较{pinned.length ? `（${pinned.length}）` : ""}
              </button>
              <button type="button" onClick={reset}>
                重置视图
              </button>
            </div>
            <div className="sp-filters">
              <label>
                主题
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">全部主题</option>
                  {[...new Set(model.items.map((i) => i.category))].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                查找
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="名称、结论或条件"
                />
              </label>
              <output aria-live="polite">
                显示 {visible.length} / {model.items.length} 项
              </output>
            </div>
          </div>
          <div className="sp-screen">
            {view === "compare" ? (
              <div
                className="sp-table-wrap"
                tabIndex={0}
                aria-label="证据比较表，可横向滚动"
              >
                <table>
                  <caption>
                    {pinned.length ? "已选条目（跨主题保留）" : "当前筛选结果"}
                    ；缺失资料保留标记
                  </caption>
                  <thead>
                    <tr>
                      <th>比较维度</th>
                      {comparison.map((i) => (
                        <th key={i.id}>{i.title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {model.dimensions.map((d) => (
                      <tr key={d.id}>
                        <th scope="row">{d.label}</th>
                        {comparison.map((i) => (
                          <td key={i.id}>{i.values[d.id] ?? "资料未提供"}</td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">解释边界</th>
                      {comparison.map((i) => (
                        <td key={i.id}>{i.boundary}</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">依据</th>
                      {comparison.map((i) => (
                        <td key={i.id}>
                          <Sources sources={i.sources} />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                {!comparison.length && <p>没有符合条件的条目。可重置视图。</p>}
              </div>
            ) : model.layout === "timeline" ? (
              <div className="sp-time-overview">
                <EvidenceTimeline
                  items={visible}
                  scale={model.timeScale ?? "month"}
                  selected={active?.id}
                  detailId={uid}
                  onSelect={(id) => {
                    setSelected(id);
                    setDetailOpen(true);
                  }}
                  pinned={pinned}
                  onPin={pin}
                />
              </div>
            ) : (
              <div className="sp-overview">
                <ol className="sp-index" aria-label="证据条目">
                  {visible.map((item) => (
                    <li
                      key={item.id}
                      className={item.id === active?.id ? "is-selected" : ""}
                    >
                      <button
                        type="button"
                        aria-pressed={item.id === active?.id}
                        aria-controls={uid}
                        onClick={() => setSelected(item.id)}
                      >
                        {item.date && (
                          <span className="sp-date">
                            {item.dateLabel} {item.date}
                          </span>
                        )}
                        <strong>{item.title}</strong>
                        <span>{item.claim}</span>
                      </button>
                      <label className="sp-pin">
                        <input
                          type="checkbox"
                          checked={pinned.includes(item.id)}
                          onChange={(e) =>
                            setPinned(
                              e.target.checked
                                ? [...pinned, item.id]
                                : pinned.filter((id) => id !== item.id),
                            )
                          }
                        />
                        加入比较
                      </label>
                    </li>
                  ))}
                </ol>
                <div id={uid} aria-live="polite">
                  {active ? (
                    <EvidenceDetail
                      item={active}
                      dimensions={model.dimensions}
                    />
                  ) : (
                    <p className="sp-empty">没有符合条件的条目。可重置视图。</p>
                  )}
                </div>
              </div>
            )}
            <details className="sp-static">
              <summary>连续阅读全部条目与来源（{model.items.length}）</summary>
              {model.items.map((item) => (
                <EvidenceDetail
                  key={item.id}
                  item={item}
                  dimensions={model.dimensions}
                />
              ))}
            </details>
          </div>
          {model.layout === "timeline" && (
            <dialog
              id={uid}
              ref={dialog}
              className="sp-block sp-evidence-dialog"
              onClose={() => setDetailOpen(false)}
              aria-label="证据详情与来源"
            >
              <div className="sp-dialog-controls">
                <button type="button" onClick={() => setDetailOpen(false)}>
                  返回总览
                </button>
              </div>
              {active && (
                <EvidenceDetail item={active} dimensions={model.dimensions} />
              )}
            </dialog>
          )}
          <div className="sp-print">
            {model.items.map((item) => (
              <EvidenceDetail
                key={item.id}
                item={item}
                dimensions={model.dimensions}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
