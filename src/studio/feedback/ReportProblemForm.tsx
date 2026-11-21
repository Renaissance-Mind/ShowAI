import { useEffect, useId, useState } from "react";
import type { DesktopInfo } from "../../host/protocol";
import { getLocale } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/feedback";
import {
  Check,
  ChevronLeft,
  CircleAlert,
  Copy,
  ExternalLink,
  X,
} from "../../ui/icons";
import { desktop, errorMessage } from "../../host/bridge";
import type { ReportProblemDetail } from "../../problems/report-event";
import { gatherDiagnostics, platformLine, versionLine } from "./diagnostics";
import {
  DiagnosticsPreview,
  logAvailable,
  useDiagnostics,
} from "./DiagnosticsPreview";
import { issueUrl, reportText, type ReportKind } from "./issue-url";
import { useSessionDraft } from "../session-draft";
import "./feedback.css";

const CONTEXT_MESSAGE_LIMIT = 1200;

async function writeClipboard(text: string) {
  if (window.showai) await desktop.invoke("clipboard:write", { text });
  else await navigator.clipboard.writeText(text);
}

function timeText(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const today = new Date().toDateString() === date.toDateString();
  return date.toLocaleString(getLocale(), {
    ...(today ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReportProblemForm({
  info: givenInfo,
  context: initialContext,
  onContextChange,
  onBack,
}: {
  info?: DesktopInfo | null;
  context?: ReportProblemDetail;
  onContextChange?: (context: ReportProblemDetail | undefined) => void;
  onBack?: () => void;
}) {
  const t = useTranslator(messages);
  const id = useId();
  const [loadedInfo, setLoadedInfo] = useState<DesktopInfo | null>(null);
  const info = givenInfo === undefined ? loadedInfo : givenInfo;
  useEffect(() => {
    if (givenInfo !== undefined || !window.showai) return;
    let stopped = false;
    desktop.invoke<DesktopInfo>("app:info").then(
      (value) => {
        if (!stopped) setLoadedInfo(value);
      },
      (reason: unknown) => console.error("ShowAI app information", reason),
    );
    return () => {
      stopped = true;
    };
  }, [givenInfo]);
  const [kind, setKind] = useSessionDraft<ReportKind>(
    "feedback.report.kind",
    "problem",
  );
  const [summary, setSummary] = useSessionDraft("feedback.report.summary", "");
  const [steps, setSteps] = useSessionDraft("feedback.report.steps", "");
  const [context, setContextState] = useState(initialContext);
  useEffect(() => setContextState(initialContext), [initialContext]);
  const setContext = (value: ReportProblemDetail | undefined) => {
    setContextState(value);
    onContextChange?.(value);
  };
  const diagnostics = useDiagnostics(info);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const sourceKey = context
    ? (`source.${context.source}` as Parameters<typeof t>[0])
    : undefined;
  const sourceName = context
    ? (context.action ??
      (t(sourceKey!).startsWith("feedback.") ? context.source : t(sourceKey!)))
    : "";
  const chip = context
    ? t("report.context", {
        source: sourceName,
        code: context.code,
        time: timeText(context.at),
      })
    : "";
  const contextText = context
    ? [
        chip,
        context.message.length > CONTEXT_MESSAGE_LIMIT
          ? `${context.message.slice(0, CONTEXT_MESSAGE_LIMIT)}…`
          : context.message,
      ]
        .filter(Boolean)
        .join("\n")
    : undefined;
  const draft = {
    kind,
    summary,
    steps,
    context: contextText,
    version: versionLine(info),
    platform: platformLine(info),
    mode: info?.mode ?? (info ? ("desktop" as const) : undefined),
  };
  const fullDiagnostics = async () =>
    diagnostics.text ??
    (await gatherDiagnostics({
      info,
      includeLibraryPath: false,
      includeLog: logAvailable(),
    }));
  const run = (work: () => Promise<string>) => {
    if (!summary.trim()) {
      setStatus({ text: t("report.needSummary"), error: true });
      return;
    }
    setBusy(true);
    setStatus(undefined);
    work()
      .then(
        (text) => setStatus({ text }),
        (reason: unknown) =>
          setStatus({
            text: t("report.failed", { message: errorMessage(reason) }),
            error: true,
          }),
      )
      .finally(() => setBusy(false));
  };
  const submit = () =>
    run(async () => {
      const text = await fullDiagnostics();
      if (text) await writeClipboard(text);
      const opened = window.open(
        issueUrl({ ...draft, logs: text ? t("report.logsHint") : "" }),
        "_blank",
      );
      if (opened) opened.opener = null;
      else if (draft.mode !== "desktop") throw new Error(t("report.notOpened"));
      return text ? t("report.githubOpened") : t("report.githubOpenedPlain");
    });
  const copyAll = () =>
    run(async () => {
      const text = await fullDiagnostics();
      await writeClipboard(
        reportText(
          draft,
          {
            kind: `${t("report.kind")}: ${t(`kind.${kind}`)}`,
            summary: t("report.summary"),
            steps: t("report.steps"),
            version: t("info.version"),
            platform: t("info.platform"),
          },
          text,
        ),
      );
      return t("report.copied");
    });
  return (
    <div className="feedback-report">
      {onBack ? (
        <header className="settings-subpage-bar">
          <button
            type="button"
            className="settings-button settings-back-button"
            onClick={onBack}
          >
            <ChevronLeft size={15} aria-hidden="true" />
            {t("report.back")}
          </button>
          <strong className="settings-subpage-title">{t("report.title")}</strong>
        </header>
      ) : (
        <header className="feedback-standalone-header">
          <h2 className="feedback-report-title">{t("report.title")}</h2>
          <p className="feedback-muted">{t("report.intro")}</p>
        </header>
      )}

      <div className="settings-card feedback-report-card">
        <div className="settings-card-section feedback-form-section">
          <div
            className="feedback-kind-field"
            role="radiogroup"
            aria-labelledby={`${id}-kind-label`}
          >
            <span id={`${id}-kind-label`} className="feedback-field">
              {t("report.kind")}
            </span>
            <div className="feedback-kind">
              {(["problem", "suggestion", "docs"] as const).map((item) => (
                <label
                  key={item}
                  className={kind === item ? "selected" : undefined}
                >
                  <input
                    className="showai-radio"
                    type="radio"
                    name={`${id}-kind`}
                    value={item}
                    checked={kind === item}
                    onChange={() => setKind(item)}
                  />
                  {t(`kind.${item}`)}
                </label>
              ))}
            </div>
          </div>

          <div className="feedback-field-group">
            <label className="feedback-field" htmlFor={`${id}-summary`}>
              {t("report.summary")}
            </label>
            <textarea
              id={`${id}-summary`}
              className="showai-textarea feedback-input"
              rows={4}
              placeholder={t("report.summaryHint")}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>

          <div className="feedback-field-group">
            <label className="feedback-field" htmlFor={`${id}-steps`}>
              {t("report.steps")}
            </label>
            <textarea
              id={`${id}-steps`}
              className="showai-textarea feedback-input"
              rows={3}
              placeholder={t("report.stepsHint")}
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
            />
          </div>

          {context && (
            <div className="feedback-context">
              <span title={context.message}>{chip}</span>
              <button
                type="button"
                aria-label={t("report.removeContext")}
                title={t("report.removeContext")}
                onClick={() => setContext(undefined)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div className="settings-card-section feedback-form-section">
          <div className="feedback-diag-header">
            <h3>{t("diag.title")}</h3>
            <p className="feedback-muted">{t("diag.privacy")}</p>
          </div>
          <DiagnosticsPreview
            text={diagnostics.text}
            error={diagnostics.error}
          />
          <div className="feedback-actions">
            <button
              type="button"
              className="settings-button feedback-primary"
              disabled={busy}
              onClick={submit}
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t("report.github")}
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={busy}
              onClick={copyAll}
            >
              {status && !status.error && status.text === t("report.copied") ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              {t("report.copyAll")}
            </button>
          </div>
          <p className="feedback-muted">{t("report.githubNote")}</p>
          {status && (
            <div
              className="settings-callout feedback-callout"
              data-tone={status.error ? "error" : "ok"}
              role={status.error ? "alert" : "status"}
            >
              {status.error && <CircleAlert size={15} aria-hidden="true" />}
              <span>{status.text}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
