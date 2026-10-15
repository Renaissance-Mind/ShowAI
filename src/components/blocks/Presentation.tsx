import { useEffect, useId, useRef, useState } from "react";
import type { BlockProps } from "./types";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Layers,
  Pencil,
  RotateCcw,
} from "../../ui/icons";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/presentation";
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
  tokens?: string[];
};
type Frame = {
  id: string;
  title: string;
  explanation: string;
  condition?: string;
  headline?: string;
  inputSummary?: string;
  outputSummary?: string;
  actionLabel?: string;
  nextHint?: string;
  states: State[];
  links: { from: string; to: string; label: string }[];
  sources?: Source[];
};
type Mechanism = {
  title: string;
  introduction?: string;
  parts: Part[];
  initialStates?: State[];
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
const statusNames: Record<State["status"], MessageKey<typeof messages>> = {
  changed: "status.changed",
  retained: "status.retained",
  fixed: "status.fixed",
};
function Sources({ sources = [] }: { sources?: Source[] }) {
  const t = useTranslator(messages);
  return sources.length ? (
    <p className="sp-sources">
      {t("sources")}
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
function MechanismState({
  part,
  state,
  output = false,
}: {
  part: Part;
  state?: State;
  output?: boolean;
}) {
  return (
    <div
      className={`ms-state${output && state?.status === "changed" ? " is-changed" : ""}`}
    >
      <h4>{part.label}</h4>
      {state && <p>{state.value}</p>}
      {!!state?.tokens?.length && (
        <ul className="ms-tokens" aria-label={part.label}>
          {state.tokens.map((token, i) => (
            <li key={i}>{token}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MechanismScene({
  parts,
  states = [],
  links = [],
  output = false,
}: {
  parts: Part[];
  states?: State[];
  links?: Frame["links"];
  output?: boolean;
}) {
  const t = useTranslator(messages);
  const linked = new Set(links.flatMap((link) => [link.from, link.to]));
  return (
    <>
      {!!links.length && (
        <div className="ms-relations" aria-label={t("links")}>
          {links.map((link, i) => (
            <div className="ms-relation" key={i}>
              <MechanismState
                part={parts.find((p) => p.id === link.from)!}
                state={states.find((s) => s.id === link.from)}
                output={output}
              />
              <div className="ms-relation-arrow">
                <span>{link.label}</span>
                <ArrowRight aria-hidden="true" />
              </div>
              <MechanismState
                part={parts.find((p) => p.id === link.to)!}
                state={states.find((s) => s.id === link.to)}
                output={output}
              />
            </div>
          ))}
        </div>
      )}
      <div className="ms-scene-states">
        {parts
          .filter((part) => !linked.has(part.id))
          .map((part) => (
            <MechanismState
              key={part.id}
              part={part}
              state={states.find((s) => s.id === part.id)}
              output={output}
            />
          ))}
      </div>
    </>
  );
}

function FrameView({ model, index }: { model: Mechanism; index: number }) {
  const t = useTranslator(messages);
  const frame = model.frames[index];
  const previous = model.frames[index - 1];
  const focusIds = new Set([
    ...frame.states.filter((s) => s.status !== "fixed").map((s) => s.id),
    ...frame.links.flatMap((link) => [link.from, link.to]),
  ]);
  const parts = focusIds.size
    ? model.parts.filter((p) => focusIds.has(p.id))
    : model.parts;
  const groups = (["changed", "retained", "fixed"] as const)
    .map((status) => ({
      status,
      parts: model.parts.filter(
        (part) => frame.states.find((s) => s.id === part.id)?.status === status,
      ),
    }))
    .filter((group) => group.parts.length);
  const icons = { changed: Pencil, retained: FileText, fixed: Layers };
  return (
    <article className="sp-frame ms-frame" data-mechanism-step={frame.id}>
      <header className="ms-frame-heading">
        <p className="ms-step-count">
          {t("mechanism.progress", {
            current: index + 1,
            total: model.frames.length,
          })}
        </p>
        <h3>{frame.headline ?? frame.title}</h3>
        <p className="ms-explanation">{frame.explanation}</p>
      </header>
      <div className="ms-transition">
        <section
          className="ms-scene ms-before"
          aria-label={t("mechanism.before")}
        >
          <h4 className="ms-scene-title">{t("mechanism.before")}</h4>
          <p className="ms-scene-summary">
            {frame.inputSummary ??
              previous?.outputSummary ??
              previous?.title ??
              t("mechanism.startingObjects")}
          </p>
          <MechanismScene
            parts={parts}
            states={previous?.states ?? model.initialStates}
          />
        </section>
        <div className="ms-action">
          <span>{frame.actionLabel ?? frame.title}</span>
          <ArrowRight aria-hidden="true" />
        </div>
        <section
          className="ms-scene ms-after"
          aria-label={t("mechanism.after")}
        >
          <h4 className="ms-scene-title">{t("mechanism.after")}</h4>
          <p className="ms-scene-summary">
            {frame.outputSummary ?? frame.title}
          </p>
          <MechanismScene
            parts={parts}
            states={frame.states}
            links={frame.links}
            output
          />
        </section>
      </div>
      <dl className="ms-summary">
        {groups.map(({ status, parts }) => {
          const Icon = icons[status];
          return (
            <div className={`ms-summary-group is-${status}`} key={status}>
              <Icon aria-hidden="true" />
              <div>
                <dt>{t(statusNames[status])}</dt>
                <dd>{parts.map((p) => p.label).join(" / ")}</dd>
                {status === "fixed" && (
                  <p>
                    {parts
                      .map(
                        (p) => frame.states.find((s) => s.id === p.id)!.value,
                      )
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </dl>
      {frame.condition && (
        <p className="sp-boundary">
          <strong>{t("condition")}</strong>
          {frame.condition}
        </p>
      )}
      <Sources sources={frame.sources} />
    </article>
  );
}

export function MechanismStepsBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as Mechanism;
  const [selected, setSelected] = useState(model.frames[0]?.id ?? "");
  const [all, setAll] = useState(false);
  const stepButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();
  const index = Math.max(
    0,
    model.frames.findIndex((f) => f.id === selected),
  );
  const active = model.frames[index];
  const next = model.frames[index + 1];
  useEffect(() => {
    if (!model.frames.some((f) => f.id === selected))
      setSelected(model.frames[0]?.id ?? "");
  }, [model.frames, selected]);
  function selectStep(i: number) {
    setSelected(model.frames[i].id);
    setAll(false);
  }
  return (
    <section className="sp-block sp-mechanism" aria-label={model.title}>
      <header>
        <h2>{model.title}</h2>
        {model.introduction && <p>{model.introduction}</p>}
      </header>
      {!active ? (
        <p className="sp-empty">{t("mechanism.empty")}</p>
      ) : (
        <>
          <nav className="ms-controls" aria-label={t("mechanism.steps")}>
            <ol className="ms-step-list">
              {model.frames.map((frame, i) => (
                <li
                  key={frame.id}
                  className={
                    i < index ? "is-complete" : i === index ? "is-current" : ""
                  }
                >
                  <button
                    type="button"
                    ref={(el) => {
                      stepButtons.current[i] = el;
                    }}
                    aria-current={i === index ? "step" : undefined}
                    aria-pressed={i === index}
                    aria-controls={uid}
                    onClick={() => selectStep(i)}
                    onKeyDown={(event) => {
                      const target =
                        event.key === "ArrowRight"
                          ? Math.min(i + 1, model.frames.length - 1)
                          : event.key === "ArrowLeft"
                            ? Math.max(i - 1, 0)
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? model.frames.length - 1
                                : undefined;
                      if (target === undefined) return;
                      event.preventDefault();
                      selectStep(target);
                      stepButtons.current[target]?.focus();
                    }}
                  >
                    <span className="ms-step-dot">
                      {i < index ? <Check aria-hidden="true" /> : i + 1}
                    </span>
                    <span>{frame.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div
            id={uid}
            className={all ? "sp-current sp-all" : "sp-current"}
            aria-live="polite"
          >
            {(all ? model.frames.map((_, i) => i) : [index]).map((i) => (
              <FrameView key={model.frames[i].id} model={model} index={i} />
            ))}
          </div>
          <footer className="ms-footer">
            <div className="ms-footer-secondary">
              <button
                type="button"
                className="ms-text-action"
                disabled={index === 0}
                onClick={() => selectStep(index - 1)}
              >
                <ArrowLeft aria-hidden="true" />
                {t("previousStep")}
              </button>
              <button
                type="button"
                className="ms-text-action"
                aria-pressed={all}
                onClick={() => setAll(!all)}
              >
                {all ? t("readStepByStep") : t("expandAllSteps")}
              </button>
              {index > 0 && (
                <button
                  type="button"
                  className="ms-reset"
                  aria-label={t("backToStart")}
                  title={t("backToStart")}
                  onClick={() => selectStep(0)}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="ms-next-hint">
              {active.nextHint ??
                (next
                  ? t("mechanism.nextHint", { title: next.title })
                  : t("mechanism.complete"))}
            </p>
            <button
              type="button"
              className="ms-next"
              disabled={!next && !all}
              onClick={() => (all ? setAll(false) : selectStep(index + 1))}
            >
              {all
                ? t("readStepByStep")
                : next
                  ? t("mechanism.next", { title: next.title })
                  : t("mechanism.complete")}
              <ArrowRight aria-hidden="true" />
            </button>
          </footer>
          <div className="sp-print">
            {model.frames.map((frame, i) => (
              <FrameView key={frame.id} model={model} index={i} />
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
  const t = useTranslator(messages);
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
            <dd>{item.values[d.id] ?? t("notProvided")}</dd>
          </div>
        ))}
      </dl>
      <p className="sp-boundary">
        <strong>{t("boundary")}</strong>
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
  const t = useTranslator(messages);
  const dates = evidenceTimeBuckets(items, scale);
  const undated = t("undated");
  const buckets = items.some((i) => !i.date) ? [...dates, undated] : dates;
  const categories = [...new Set(items.map((i) => i.category))];
  const bucket = (item: Evidence) =>
    item.date?.slice(0, scale === "year" ? 4 : 7) ?? undated;
  return (
    <div
      className="sp-timeline-wrap"
      tabIndex={0}
      aria-label={t("timeline.label")}
    >
      <table className="sp-timeline">
        <caption>{t("timeline.caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("topic")}</th>
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
                          aria-label={t("itemWithDate", {
                            title: item.title,
                            dateLabel: item.dateLabel ?? t("dateNotProvided"),
                            date: item.date ?? "",
                          })}
                          data-evidence-id={item.id}
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
                            aria-label={t("addNamedToComparison", {
                              title: item.title,
                            })}
                          />
                          {t("addToComparison")}
                        </label>
                      </div>
                    ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p>{t("noMatches")}</p>}
    </div>
  );
}

export function EvidenceExplorerBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as Explorer;
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(model.items[0]?.id ?? "");
  const [view, setView] = useState<"overview" | "compare" | "detail">(
    "overview",
  );
  const [pinned, setPinned] = useState<string[]>([]);
  const root = useRef<HTMLElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const restoreSelection = useRef<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setNarrow(entries[0].contentRect.width < 650),
    );
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  const uid = useId();
  const visible = selectEvidence(model.items, category, query);
  const active = visible.find((i) => i.id === selected) ?? visible[0];
  useEffect(() => {
    if (view === "detail") returnButton.current?.focus();
    else if (view === "overview" && restoreSelection.current) {
      const target = [
        ...(root.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-evidence-id]",
        ) ?? []),
      ].find(
        (button) => button.dataset.evidenceId === restoreSelection.current,
      );
      target?.focus();
      restoreSelection.current = null;
    }
  }, [view, selected]);
  function returnToOverview() {
    restoreSelection.current = active?.id ?? null;
    setView("overview");
  }
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
  }
  return (
    <section
      ref={root}
      className="sp-block sp-evidence"
      aria-label={model.title}
      onKeyDown={(event) => {
        if (event.key === "Escape" && view === "detail") {
          event.preventDefault();
          event.stopPropagation();
          returnToOverview();
        }
      }}
    >
      <header>
        <h2>{model.title}</h2>
        {view !== "detail" && model.introduction && <p>{model.introduction}</p>}
      </header>
      {!model.items.length ? (
        <p className="sp-empty">{t("evidence.empty")}</p>
      ) : (
        <>
          {view === "detail" ? (
            <div className="sp-controls">
              <button
                type="button"
                ref={returnButton}
                onClick={returnToOverview}
              >
                {t("backToOverview")}
              </button>
            </div>
          ) : (
            <div className="sp-controls">
              <div className="sp-buttons">
                <button
                  type="button"
                  aria-pressed={view === "overview"}
                  onClick={() => setView("overview")}
                >
                  {t("overviewAndDetail")}
                </button>
                <button
                  type="button"
                  aria-pressed={view === "compare"}
                  onClick={() => setView("compare")}
                >
                  {pinned.length
                    ? t("compareByDimensionCount", { count: pinned.length })
                    : t("compareByDimension")}
                </button>
                <button type="button" onClick={reset}>
                  {t("resetView")}
                </button>
              </div>
              <div className="sp-filters">
                <label>
                  {t("topic")}
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">{t("allTopics")}</option>
                    {[...new Set(model.items.map((i) => i.category))].map(
                      (c) => (
                        <option key={c}>{c}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  {t("find")}
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("findPlaceholder")}
                  />
                </label>
                <output aria-live="polite">
                  {t("showingCount", {
                    shown: visible.length,
                    count: model.items.length,
                  })}
                </output>
              </div>
            </div>
          )}
          <div className="sp-screen">
            {view === "detail" ? (
              <div id={uid} role="region" aria-label={t("detailRegion")}>
                {active && (
                  <EvidenceDetail item={active} dimensions={model.dimensions} />
                )}
              </div>
            ) : view === "compare" ? (
              <div
                className="sp-table-wrap"
                tabIndex={0}
                aria-label={t("comparisonTable")}
              >
                <table>
                  <caption>
                    {pinned.length
                      ? t("comparison.pinned")
                      : t("comparison.filtered")}
                  </caption>
                  <thead>
                    <tr>
                      <th>{t("dimension")}</th>
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
                          <td key={i.id}>
                            {i.values[d.id] ?? t("notProvided")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">{t("boundaryRow")}</th>
                      {comparison.map((i) => (
                        <td key={i.id}>{i.boundary}</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">{t("sourcesRow")}</th>
                      {comparison.map((i) => (
                        <td key={i.id}>
                          <Sources sources={i.sources} />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                {!comparison.length && <p>{t("noMatches")}</p>}
              </div>
            ) : model.layout === "timeline" && !narrow ? (
              <div className="sp-time-overview">
                <EvidenceTimeline
                  items={visible}
                  scale={model.timeScale ?? "month"}
                  selected={active?.id}
                  detailId={uid}
                  onSelect={(id) => {
                    setSelected(id);
                    setView("detail");
                  }}
                  pinned={pinned}
                  onPin={pin}
                />
              </div>
            ) : (
              <div className="sp-overview">
                <ol className="sp-index" aria-label={t("evidenceItems")}>
                  {visible.map((item) => (
                    <li
                      key={item.id}
                      className={item.id === active?.id ? "is-selected" : ""}
                    >
                      <button
                        type="button"
                        data-evidence-id={item.id}
                        aria-pressed={item.id === active?.id}
                        aria-controls={uid}
                        onClick={() => {
                          setSelected(item.id);
                          if (narrow) setView("detail");
                        }}
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
                        {t("addToComparison")}
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
                    <p className="sp-empty">{t("noMatches")}</p>
                  )}
                </div>
              </div>
            )}
            <details className="sp-static">
              <summary>{t("readAll", { count: model.items.length })}</summary>
              {model.items.map((item) => (
                <EvidenceDetail
                  key={item.id}
                  item={item}
                  dimensions={model.dimensions}
                />
              ))}
            </details>
          </div>
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
