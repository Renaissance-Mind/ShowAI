/**
 * Shared problem presentation (audit levels L1–L4):
 *   toast  – L1, short notice with at most one action
 *   banner – L2, attached to a page, component, project row or conversation
 *   dialog – L3, content of a dialog the caller owns
 *   page   – L4, recovery page (crash, library unavailable)
 * Parts: 发生了什么 / 内容是否安全 / 原因 / 操作 / 技术详情 (collapsed, 复制详情) / 报告问题.
 */
import {
  Children,
  isValidElement,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { problemReportText } from "./report-text";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/errors";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Flag,
  Info,
  TriangleAlert,
  X,
} from "../../ui/icons";
import {
  actionLabel,
  safetyText,
  type ProblemActionId,
  type ProblemDescription,
} from "./describe";
import { dispatchReportProblem } from "./report-event";
import "./problems.css";

export type ProblemLevel = "toast" | "banner" | "dialog" | "page";
export type ProblemTone = "error" | "warning" | "info";

export interface ProblemAction {
  label: string;
  onSelect: () => void;
  primary?: boolean;
  /** Destructive actions always render last; confirm them in the handler. */
  destructive?: boolean;
}

/**
 * Keeps the suggested actions the caller can perform, in suggestion order.
 * The first becomes primary unless the caller marks one.
 */
export function bindProblemActions(
  suggested: readonly ProblemActionId[],
  handlers: Partial<Record<ProblemActionId, () => void>>,
): ProblemAction[] {
  return suggested.flatMap((id) => {
    const onSelect = handlers[id];
    return onSelect ? [{ label: actionLabel(id), onSelect }] : [];
  });
}

/** One primary, at most two secondary, destructive last. */
export function arrangeProblemActions(actions: readonly ProblemAction[]) {
  const safe = actions.filter((item) => !item.destructive);
  const destructive = actions.filter((item) => item.destructive);
  const primaryIndex = Math.max(
    0,
    safe.findIndex((item) => item.primary),
  );
  const ordered = [
    ...safe.slice(primaryIndex, primaryIndex + 1),
    ...safe.filter((_, index) => index !== primaryIndex),
    ...destructive,
  ].slice(0, 3);
  // A destructive action is never dropped in favour of a later safe one.
  if (destructive.length && !ordered.some((item) => item.destructive))
    ordered.splice(ordered.length - 1, 1, destructive[0]);
  return ordered.map((item, index) => ({
    ...item,
    primary: index === 0 && !item.destructive,
  }));
}

async function writeClipboard(text: string) {
  if (window.showai) await window.showai.invoke("clipboard:write", { text });
  else await navigator.clipboard.writeText(text);
}

export { problemReportText };

function ToneIcon({ tone, size = 16 }: { tone: ProblemTone | "success"; size?: number }) {
  if (tone === "success") return <CircleCheck size={size} aria-hidden />;
  if (tone === "warning") return <TriangleAlert size={size} aria-hidden />;
  if (tone === "info") return <Info size={size} aria-hidden />;
  return <CircleAlert size={size} aria-hidden />;
}

export interface ProblemNoticeProps {
  problem: ProblemDescription;
  level?: ProblemLevel;
  tone?: ProblemTone;
  actions?: readonly ProblemAction[];
  /** Banners and toasts show a close button when given. */
  onDismiss?: () => void;
  /** How many times the same problem occurred. */
  count?: number;
  /** Hide 报告问题, e.g. for expected conditions such as a busy library. */
  reportable?: boolean;
  className?: string;
  /** Ordering inside a NoticeStack; higher shows first. */
  "data-priority"?: number;
}

export function ProblemNotice({
  problem,
  level = "banner",
  tone = "error",
  actions = [],
  onDismiss,
  count = 1,
  reportable = true,
  className,
}: ProblemNoticeProps) {
  const t = useTranslator(messages);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const arranged = arrangeProblemActions(actions);
  const copy = () => {
    setCopyError("");
    writeClipboard(problemReportText(problem)).then(
      () => setCopied(true),
      (error: unknown) => setCopyError(String((error as Error)?.message ?? error)),
    );
  };
  const report = () =>
    dispatchReportProblem({
      source: problem.source,
      code: problem.code,
      message: problemReportText(problem),
      at: problem.at,
      ...(problem.action ? { action: problem.action } : {}),
    });
  const Title = level === "page" ? "h1" : "strong";
  if (level === "toast")
    return (
      <div
        className={`problem-notice is-toast tone-${tone}${className ? ` ${className}` : ""}`}
        role={tone === "info" ? "status" : "alert"}
      >
        <ToneIcon tone={tone} size={15} />
        <span className="problem-notice-title">{problem.title}</span>
        {arranged[0] && (
          <button className="problem-notice-link" onClick={arranged[0].onSelect}>
            {arranged[0].label}
          </button>
        )}
        {onDismiss && (
          <button className="problem-notice-close" aria-label={t("dismiss")} onClick={onDismiss}>
            <X size={14} />
          </button>
        )}
      </div>
    );
  return (
    <div
      className={`problem-notice is-${level} tone-${tone}${className ? ` ${className}` : ""}`}
      role={level === "banner" ? (tone === "info" ? "status" : "alert") : undefined}
    >
      <span className="problem-notice-icon">
        <ToneIcon tone={tone} size={level === "page" ? 28 : 16} />
      </span>
      <div className="problem-notice-body">
        <Title className="problem-notice-title">
          {problem.title}
          {count > 1 && (
            <span className="problem-notice-count">{t("repeated", { count })}</span>
          )}
        </Title>
        {problem.safety && (
          <p className={`problem-notice-safety is-${problem.safety}`}>
            {safetyText(problem.safety)}
          </p>
        )}
        {problem.cause && <p className="problem-notice-cause">{problem.cause}</p>}
        {!!arranged.length && (
          <div className="problem-notice-actions">
            {arranged.map((item) => (
              <button
                key={item.label}
                className={
                  item.primary ? "is-primary" : item.destructive ? "is-destructive" : undefined
                }
                onClick={item.onSelect}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        <details className="problem-notice-details">
          <summary>{t("technicalDetails")}</summary>
          <pre>{problem.details}</pre>
          <div className="problem-notice-detail-actions">
            <button onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t("detailsCopied") : t("copyDetails")}
            </button>
            {reportable && (
              <button onClick={report}>
                <Flag size={13} />
                {t("reportProblem")}
              </button>
            )}
            {copyError && (
              <span className="problem-notice-copy-error" title={copyError}>
                {t("copyFailed")}
              </span>
            )}
          </div>
        </details>
      </div>
      {onDismiss && level === "banner" && (
        <button className="problem-notice-close" aria-label={t("dismiss")} onClick={onDismiss}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/**
 * One position, many notices: shows the highest-priority child (children
 * declare `data-priority`, higher first; ties keep their order) and folds the
 * rest under 「还有 N 项」.
 */
export function NoticeStack({ children }: { children: ReactNode }) {
  const t = useTranslator(messages);
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children)
    .filter((child): child is ReactElement<Record<string, unknown>> => isValidElement(child))
    .map((child, index) => ({
      child,
      index,
      priority: Number(child.props["data-priority"] ?? 0),
    }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .map((item) => item.child);
  useEffect(() => {
    if (items.length <= 1) setOpen(false);
  }, [items.length]);
  if (!items.length) return null;
  const hidden = items.length - 1;
  return (
    <div className="notice-stack">
      {open ? items : items[0]}
      {hidden > 0 && (
        <button
          className="notice-stack-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("collapse") : t("more", { count: hidden })}
        </button>
      )}
    </div>
  );
}

export type ToastKind = "success" | "info" | "warning";

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: { label: string; onSelect: () => void };
}

/** Bottom-centre toasts; warnings stay until dismissed. */
export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const t = useTranslator(messages);
  if (!toasts.length) return null;
  return (
    <div className="studio-toast-stack">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`studio-toast is-${toast.kind}`}
          role={toast.kind === "warning" ? "alert" : "status"}
        >
          <span className="studio-toast-icon">
            <ToneIcon tone={toast.kind} size={14} />
          </span>
          <span className="studio-toast-message">{toast.message}</span>
          {toast.action && (
            <button
              className="studio-toast-action"
              onClick={() => {
                toast.action!.onSelect();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          {toast.kind === "warning" && (
            <button
              className="studio-toast-close"
              aria-label={t("dismiss")}
              onClick={() => onDismiss(toast.id)}
            >
              <X size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
