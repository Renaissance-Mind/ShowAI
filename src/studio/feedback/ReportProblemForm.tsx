import { useEffect, useId, useState } from "react";
import type { DesktopInfo } from "../../desktop/bridge";
import { getLocale } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/feedback";
import { Check, Copy, ExternalLink, X } from "../../ui/icons";
import { desktop, errorMessage } from "../bridge";
import type { ReportProblemDetail } from "../problems/report-event";
import { gatherDiagnostics, platformLine, versionLine } from "./diagnostics";
import {
  DiagnosticsPreview,
  logAvailable,
  useDiagnostics,
  type DiagnosticsOptions,
} from "./DiagnosticsPreview";
import { issueUrl, reportText, type ReportKind } from "./issue-url";
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

/**
 * The report form of 关于与反馈. Arriving from a problem notice, the Agent or
 * the crash page, the source, code and time are filled in and can be removed.
 * Nothing leaves the App by itself: 在 GitHub 提交 opens a prefilled issue in
 * the browser, and 复制全文 is for any other channel.
 */
export function ReportProblemForm({
  info: givenInfo,
  context: initialContext,
  onBack,
}: {
  /** Undefined: the form reads App information itself (crash page). */
  info?: DesktopInfo | null;
  context?: ReportProblemDetail;
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
  const [kind, setKind] = useState<ReportKind>("problem");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState("");
  const [context, setContext] = useState(initialContext);
  useEffect(() => setContext(initialContext), [initialContext]);
  const [attach, setAttach] = useState(true);
  const [preview, setPreview] = useState(false);
  const [options, setOptions] = useState<DiagnosticsOptions>({
    includeLibraryPath: false,
    includeLog: logAvailable(),
  });
  const diagnostics = useDiagnostics(info, options, attach && preview);
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
      includeLibraryPath: options.includeLibraryPath,
      includeLog: options.includeLog,
    }));
  const run = (work: () => Promise<string>) => {
    if (!summary.trim()) {
      setStatus({ text: t("report.needSummary"), error: true });
      return;
    }
    setBusy(true);
    setStatus(undefined);
    work().then(
      (text) => setStatus({ text }),
      (reason: unknown) =>
        setStatus({
          text: t("report.failed", { message: errorMessage(reason) }),
          error: true,
        }),
    ).finally(() => setBusy(false));
  };
  const submit = () =>
    run(async () => {
      const text = attach ? await fullDiagnostics() : "";
      if (text) await writeClipboard(text);
      window.open(
        issueUrl({ ...draft, logs: text ? t("report.logsHint") : "" }),
        "_blank",
        "noopener",
      );
      return text ? t("report.githubOpened") : t("report.githubOpenedPlain");
    });
  const copyAll = () =>
    run(async () => {
      const text = attach ? await fullDiagnostics() : undefined;
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
      {onBack && (
        <button type="button" className="feedback-back" onClick={onBack}>
          {t("report.back")}
        </button>
      )}
      <h2 className="feedback-report-title">{t("report.title")}</h2>
      <p className="feedback-muted">{t("report.intro")}</p>
      <fieldset className="feedback-kind">
        <legend>{t("report.kind")}</legend>
        {(["problem", "suggestion", "docs"] as const).map((item) => (
          <label key={item} className={kind === item ? "selected" : undefined}>
            <input
              type="radio"
              name={`${id}-kind`}
              value={item}
              checked={kind === item}
              onChange={() => setKind(item)}
            />
            {t(`kind.${item}`)}
          </label>
        ))}
      </fieldset>
      <label className="feedback-field" htmlFor={`${id}-summary`}>
        {t("report.summary")}
      </label>
      <textarea
        id={`${id}-summary`}
        className="feedback-input"
        rows={4}
        placeholder={t("report.summaryHint")}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
      />
      <label className="feedback-field" htmlFor={`${id}-steps`}>
        {t("report.steps")}
      </label>
      <textarea
        id={`${id}-steps`}
        className="feedback-input"
        rows={3}
        placeholder={t("report.stepsHint")}
        value={steps}
        onChange={(event) => setSteps(event.target.value)}
      />
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
      <div className="feedback-attach">
        <label>
          <input
            type="checkbox"
            checked={attach}
            onChange={(event) => setAttach(event.target.checked)}
          />
          {t("report.attach")}
          <span className="feedback-muted"> · {t("report.attachDetail")}</span>
        </label>
        {attach && (
          <button
            type="button"
            className="feedback-link"
            aria-expanded={preview}
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? t("report.hidePreview") : t("report.showPreview")}
          </button>
        )}
      </div>
      {attach && preview && (
        <DiagnosticsPreview
          options={options}
          onOptionsChange={setOptions}
          text={diagnostics.text}
          error={diagnostics.error}
        />
      )}
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
        <p
          className={status.error ? "feedback-error" : "feedback-status"}
          role={status.error ? "alert" : "status"}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
