import { useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import messages from "../i18n/messages/packaging";
import type {
  PackagingChoice,
  PackagingDecisions,
  PackagingItem,
  PackagingKind,
  PackagingPlan,
} from "../core/packaging";

export type { PackagingPlan, PackagingDecisions };

const KINDS: PackagingKind[] = [
  "file-dataset",
  "transform-output",
  "file-resource",
  "url-dataset",
  "url-resource",
];

const CARRYING = new Set<PackagingChoice>([
  "bundle",
  "embed",
  "result",
  "inputs",
  "both",
]);

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** Bytes an item adds with a choice (as core/packaging counts them). */
function choiceBytes(item: PackagingItem, choice: PackagingChoice) {
  const own = item.bytes ?? 0;
  if (choice === "bundle" || choice === "embed" || choice === "result")
    return own;
  if (choice === "inputs") return item.inputBytes ?? 0;
  if (choice === "both") return own + (item.inputBytes ?? 0);
  return 0;
}

/**
 * Lists what an export or synchronization would carry from outside the
 * library, with sizes, so the person chooses each item; the total is held
 * against the limit of one export or synchronization.
 */
export function PackagingDialog({
  plan,
  purpose,
  focus,
  onDecide,
}: {
  plan: PackagingPlan;
  purpose: "export" | "sync";
  /** The id of an item to show and focus first. */
  focus?: string;
  /** The choice of every item, or null when the person cancels. */
  onDecide: (decisions: PackagingDecisions | null) => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const [choices, setChoices] = useState<PackagingDecisions>(() =>
    Object.fromEntries(plan.items.map((item) => [item.id, item.choice])),
  );
  const total = useMemo(
    () =>
      plan.items.reduce(
        (sum, item) => sum + choiceBytes(item, choices[item.id] ?? item.choice),
        0,
      ),
    [plan.items, choices],
  );
  const over = total > plan.limits.totalBytes;
  const focused = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    // After the dialog's own initial focus, move to the item asked for.
    const frame = requestAnimationFrame(() => {
      focused.current?.scrollIntoView({ block: "center" });
      focused.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  const label = (choice: PackagingChoice) =>
    choice === "bundle"
      ? t(purpose === "sync" ? "choice.sync.bundle" : "choice.export.bundle")
      : t(`choice.${choice}`);
  return (
    <Dialog
      title={t(purpose === "sync" ? "syncTitle" : "exportTitle")}
      onClose={() => onDecide(null)}
      wide
    >
      <div className="studio-form packaging-dialog">
        {KINDS.map((kind) => {
          const items = plan.items.filter((item) => item.kind === kind);
          if (!items.length) return null;
          return (
            <section key={kind} aria-label={t(`kind.${kind}`)}>
              <h3>{t(`kind.${kind}`)}</h3>
              <ul>
                {items.map((item) => {
                  const choice = choices[item.id] ?? item.choice;
                  // The size the item adds when carried, whatever is chosen now.
                  const carry = CARRYING.has(choice)
                    ? choice
                    : item.choices.find((option) => CARRYING.has(option));
                  const bytes = !carry
                    ? item.bytes
                    : item.bytes === null && carry !== "inputs"
                      ? null
                      : choiceBytes(item, carry);
                  const notes = [
                    bytes === null ? t("unknownSize") : formatSize(bytes),
                    item.blocks.length
                      ? t("blocks", { count: item.blocks.length })
                      : undefined,
                    item.bundled ? t("bundledCopy") : undefined,
                  ].filter(Boolean);
                  return (
                    <li
                      key={item.id}
                      className={
                        [
                          !item.available || item.tooLarge
                            ? "is-unavailable"
                            : "",
                          item.id === focus ? "is-focused" : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    >
                      <div className="packaging-item">
                        <strong title={item.name}>{item.name}</strong>
                        <span className="packaging-meta">
                          {notes.join(" · ")}
                        </span>
                        {(!item.available || item.tooLarge) && (
                          <span className="packaging-warning">
                            {item.tooLarge
                              ? t("tooLarge", {
                                  limit: formatSize(plan.limits.itemBytes),
                                })
                              : t("unavailable")}
                          </span>
                        )}
                      </div>
                      <select
                        ref={item.id === focus ? focused : undefined}
                        aria-label={t("choiceFor", { name: item.name })}
                        value={choice}
                        disabled={item.choices.length < 2}
                        onChange={(event) =>
                          setChoices({
                            ...choices,
                            [item.id]: event.target.value as PackagingChoice,
                          })
                        }
                      >
                        {item.choices.map((option) => (
                          <option key={option} value={option}>
                            {label(option)}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <div className={`packaging-total${over ? " is-over" : ""}`}>
          <span>
            {t("total", {
              size: formatSize(total),
              limit: formatSize(plan.limits.totalBytes),
            })}
          </span>
          <progress
            max={plan.limits.totalBytes}
            value={Math.min(total, plan.limits.totalBytes)}
          />
        </div>
        {over && (
          <p className="studio-form-error" role="alert">
            {t("overLimit")}
          </p>
        )}
        <footer>
          <button
            className="studio-button"
            type="button"
            onClick={() => onDecide(null)}
          >
            {tc("cancel")}
          </button>
          <button
            className="studio-button primary"
            type="button"
            disabled={over}
            onClick={() => onDecide(choices)}
          >
            {t(purpose === "sync" ? "save" : "export")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
