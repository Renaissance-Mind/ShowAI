import { useEffect, useId, useRef, useState } from "react";
import type { BlockProps } from "./types";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/presentation";
import {
  evidenceTimeBuckets,
  selectEvidence,
} from "./presentation-contract.mjs";
import "./presentation.css";

type Source = { label: string; url: string };
type Part = { id: string; label: string };
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
