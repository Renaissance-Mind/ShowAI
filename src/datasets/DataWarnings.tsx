import { useEffect, useId, useRef, useState } from "react";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/datasets";
import { errorMessage } from "../host/bridge";
import { CircleAlert, Info, TriangleAlert } from "../ui/icons";
import type { WarningAction, WarningLevel } from "./warnings.mjs";
import { topLevel, type WarningEntry } from "./warning-entries";

/** Carries out one action of an entry; resolves with a short result to show. */
export type RunWarningAction = (
  action: WarningAction,
  entry: WarningEntry,
) => Promise<"copied" | void>;
/** Labels that replace an action's default, e.g. copying instead of asking. */
export type ActionLabels = Partial<Record<WarningAction, string>>;

const icons = { error: CircleAlert, warning: TriangleAlert, info: Info };

function LevelIcon({ level }: { level: WarningLevel }) {
  const Icon = icons[level];
  return <Icon size={13} aria-hidden="true" />;
}

/** Buttons for an entry's actions, with the busy state and error of the last run. */
function ActionButtons({
  entry,
  run,
  labels,
  primary,
}: {
  entry: WarningEntry;
  run: RunWarningAction;
  labels?: ActionLabels;
  primary?: boolean;
}) {
  const t = useTranslator(messages);
  const [busy, setBusy] = useState<WarningAction | null>(null);
  const [done, setDone] = useState<WarningAction | null>(null);
  const [error, setError] = useState("");
  const actions = primary ? entry.actions.slice(0, 1) : entry.actions;
  if (!actions.length) return null;
  const start = async (action: WarningAction) => {
    setBusy(action);
    setError("");
    setDone(null);
    try {
      if ((await run(action, entry)) === "copied") setDone(action);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <span className="dataset-warning-actions">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={!!busy}
            aria-busy={busy === action || undefined}
            onClick={() => void start(action)}
          >
            {done === action
              ? t("copied")
              : (labels?.[action] ?? t(`action.${action}`))}
          </button>
        ))}
      </span>
      {error && (
        <span className="dataset-warning-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * The warning surface of a bound block: a badge in its shared data row that
 * opens the list of entries with their actions. `stale` marks a value that
 * is shown although the source cannot be read now.
 */
export function DataWarningBadge({
  entries,
  stale,
  readOnlyLabel,
  run,
  labels,
}: {
  entries: WarningEntry[];
  stale: boolean;
  /** The label when the only entries say what cannot be changed. */
  readOnlyLabel?: string;
  run: RunWarningAction;
  labels?: ActionLabels;
}) {
  const t = useTranslator(messages);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const level = topLevel(entries);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target))
        setOpen(false);
    };
    // Focus may stay in the page editor after clicking the badge; Escape still closes.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  useEffect(() => {
    if (!entries.length) setOpen(false);
  }, [entries.length]);
  if (!level && !stale) return null;
  const transient = entries.find((entry) => entry.transient);
  const onlyReadOnly =
    !!readOnlyLabel &&
    entries.every((entry) => entry.code === "READ_ONLY" && !entry.transient);
  const label = transient
    ? transient.title
    : stale
      ? t("staleBadge")
      : onlyReadOnly
        ? readOnlyLabel
        : t("warningCount", { count: entries.length });
  return (
    <span className="dataset-warning-anchor">
      <button
        ref={button}
        type="button"
        className={`dataset-warning-badge is-${level ?? "warning"}${stale ? " is-stale" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <LevelIcon level={level ?? "warning"} />
        <span role={transient ? "status" : undefined}>{label}</span>
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className="dataset-warning-popover"
          role="dialog"
          aria-label={t("warningsLabel")}
          tabIndex={-1}
        >
          <ul>
            {entries.map((entry) => (
              <li key={entry.key} className={`is-${entry.level}`}>
                <strong>
                  <LevelIcon level={entry.level} />
                  {entry.title}
                </strong>
                <span className="dataset-warning-meta">
                  {[
                    entry.dataset,
                    entry.stage ? t(`stage.${entry.stage}`) : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {entry.detail && entry.detail !== entry.title && (
                  <span className="dataset-warning-detail">{entry.detail}</span>
                )}
                <ActionButtons
                  entry={entry}
                  run={async (action, target) => {
                    const result = await run(action, target);
                    // Actions that continue elsewhere leave the list; a copied request stays to say so.
                    if (
                      action === "packaging" ||
                      (action === "ask-agent" && result !== "copied")
                    )
                      setOpen(false);
                    return result;
                  }}
                  labels={labels}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

/**
 * The body of a bound block without data: the main warning and its first
 * action, or all of its actions (`allActions`) where nothing else offers them.
 */
export function DataEmptyState({
  entry,
  run,
  labels,
  allActions,
}: {
  entry: WarningEntry | undefined;
  run: RunWarningAction;
  labels?: ActionLabels;
  allActions?: boolean;
}) {
  const t = useTranslator(messages);
  return (
    <div className="dataset-empty" role="status">
      <strong>
        {entry ? <LevelIcon level={entry.level} /> : null}
        {entry?.title ?? t("emptyTitle")}
      </strong>
      {entry?.dataset && (
        <span className="dataset-warning-meta">
          {entry.datasetId
            ? t("sourceLabel", { name: entry.dataset })
            : entry.dataset}
        </span>
      )}
      {entry?.detail && entry.detail !== entry.title && allActions && (
        <span className="dataset-warning-detail">{entry.detail}</span>
      )}
      {entry && (
        <ActionButtons
          entry={entry}
          run={run}
          labels={labels}
          primary={!allActions}
        />
      )}
    </div>
  );
}
