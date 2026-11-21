import { useEffect, useState } from "react";
import type { AgentConnectionRecord } from "../../agent/mcp-connections";
import { appIconForTheme } from "../../design/app-icon";
import { useAppearanceTheme } from "../../design/useAppearanceTheme";
import { supportChannels } from "../../core/support-channels";
import type { DesktopInfo } from "../../host/protocol";
import type { PluginInstallation } from "../../plugin/desktop-install";
import { getLocale } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/feedback";
import {
  BookOpen,
  Check,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  Flag,
  FolderOpen,
  Info,
  Loader2,
} from "../../ui/icons";
import { desktop, errorMessage } from "../../host/bridge";
import { workbenchCapabilities } from "../capabilities";
import { useFailureReason, verifyState } from "../PluginInstallSettings";
import type { ReportProblemDetail } from "../../problems/report-event";
import { pluginHostNames, usePluginHosts } from "../usePluginHosts";
import { useAppUpdate } from "../useAppUpdate";
import { AGENT_TROUBLESHOOTING } from "../AgentReadiness";
import {
  modeLine,
  platformLine,
  runtimeLine,
  versionLine,
} from "./diagnostics";
import { DiagnosticsPreview, useDiagnostics } from "./DiagnosticsPreview";
import { ReportProblemForm } from "./ReportProblemForm";
import {
  readSessionDraft,
  useSessionDraft,
  writeSessionDraft,
} from "../session-draft";
import "./feedback.css";

export interface FeedbackRequest {
  id: number;
  view: "about" | "report" | "diagnostics";
  context?: ReportProblemDetail;
}

async function writeClipboard(text: string) {
  if (window.showai) await desktop.invoke("clipboard:write", { text });
  else await navigator.clipboard.writeText(text);
}

function timeText(at: string) {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? at
    : date.toLocaleString(getLocale(), {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const t = useTranslator(messages);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="settings-row feedback-info-row">
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        <button
          type="button"
          className="settings-icon-button"
          aria-label={
            copied ? t("info.copied", { label }) : t("info.copy", { label })
          }
          title={
            copied ? t("info.copied", { label }) : t("info.copy", { label })
          }
          disabled={value === "—"}
          onClick={() =>
            void writeClipboard(`${label}: ${value}`).then(
              () => setCopied(true),
              (reason: unknown) => console.error("ShowAI copy", reason),
            )
          }
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
        </button>
      </dd>
    </div>
  );
}

function ProductUpdateControl() {
  const t = useTranslator(messages);
  const { state, run } = useAppUpdate();
  const [failure, setFailure] = useState<string>();
  if (!state?.supported) {
    return (
      <div className="feedback-product-update">
        <p className="feedback-update-status" role="status">
          {state ? t("update.unsupported") : t("update.checking")}
        </p>
        <div className="feedback-product-update-actions">
          <button type="button" className="settings-button" disabled>
            {t("update.check")}
          </button>
        </div>
      </div>
    );
  }
  const act = (...args: Parameters<typeof run>) => {
    setFailure(undefined);
    void run(...args).catch((reason: unknown) =>
      setFailure(errorMessage(reason)),
    );
  };
  const busy = state.phase === "checking" || state.phase === "downloading";
  const text =
    state.phase === "checking"
      ? t("update.checking")
      : state.phase === "current"
        ? t("update.current", { time: timeText(state.checkedAt!) })
        : state.phase === "available"
          ? t("update.available", { version: state.version! })
          : state.phase === "downloading"
            ? t("update.downloading", {
                version: state.version!,
                percent: String(state.percent ?? 0),
              })
            : state.phase === "ready"
              ? t("update.ready", { version: state.version! })
              : state.phase === "failed"
                ? t("update.failed", { message: state.error! })
                : t("update.idle");
  const retry = state.phase === "failed" && state.retryDownload;
  const button = retry
    ? {
        label: t("update.retryDownload"),
        action: "appUpdate:download" as const,
      }
    : state.phase === "available"
      ? { label: t("update.download"), action: "appUpdate:download" as const }
      : state.phase === "ready"
        ? { label: t("update.restart"), action: "appUpdate:install" as const }
        : { label: t("update.check"), action: "appUpdate:check" as const };
  const hasError = state.phase === "failed" || !!failure;
  return (
    <div className="feedback-product-update">
      <p
        className={
          hasError
            ? "feedback-update-status feedback-error-inline"
            : "feedback-update-status"
        }
        role={hasError ? "alert" : "status"}
      >
        {failure ? t("update.failed", { message: failure }) : text}
        {retry && state.version && ` · ${state.version}`}
      </p>
      <div className="feedback-product-update-actions">
        {!busy ? (
          <button
            type="button"
            className={`settings-button${state.phase === "ready" || state.phase === "available" ? " feedback-primary" : ""}`}
            onClick={() => act(button.action)}
          >
            {button.label}
          </button>
        ) : (
          <Loader2 size={15} className="studio-spin" aria-hidden="true" />
        )}
        {retry && (
          <button
            className="settings-button"
            type="button"
            onClick={() => act("appUpdate:check")}
          >
            {t("update.check")}
          </button>
        )}
      </div>
    </div>
  );
}

function PluginRows({ home }: { home: string }) {
  const t = useTranslator(messages);
  const failureReason = useFailureReason();
  const plugins = usePluginHosts(home);
  const [records, setRecords] = useState<AgentConnectionRecord[]>([]);
  useEffect(() => {
    let stopped = false;
    desktop
      .invoke<{ connections: AgentConnectionRecord[] }>("agent:onboarding")
      .then(
        (value) => {
          if (!stopped) setRecords(value.connections);
        },
        (reason: unknown) => console.error("ShowAI connection records", reason),
      );
    return () => {
      stopped = true;
    };
  }, [home]);
  const describe = (host: PluginInstallation) => {
    const install = !host.executable
      ? t("host.notFound")
      : host.installed
        ? [
            t("host.installed", { version: host.version ?? "" }).trim(),
            !host.enabled && t("host.disabled"),
            host.current === false && t("host.outdated"),
          ]
            .filter(Boolean)
            .join(" · ")
        : host.installedPath
          ? t("host.staged")
          : host.otherSources.length
            ? t("host.otherSource")
            : t("host.notInstalled");
    if (!host.executable) return install;
    const state = verifyState(host, records);
    const connection =
      state.kind === "failed"
        ? t("conn.failedReason", {
            time: timeText(state.at),
            reason: failureReason(state.code),
          })
        : state.kind === "called"
          ? t("conn.called", { time: timeText(state.at) })
          : state.kind === "connected"
            ? t("conn.connected", { time: timeText(state.at) })
            : state.kind === "notSinceInstall"
              ? t("conn.notSinceInstall")
              : t("conn.waiting");
    return host.installed || host.installedPath
      ? `${install} · ${connection}`
      : install;
  };
  if (plugins.error)
    return (
      <div className="settings-row feedback-info-row">
        <dt>{t("info.plugins")}</dt>
        <dd className="feedback-error-inline">
          {t("plugins.unavailable", { message: plugins.error })}
        </dd>
      </div>
    );
  if (!plugins.scanned)
    return (
      <div className="settings-row feedback-info-row">
        <dt>{t("info.plugins")}</dt>
        <dd>{t("plugins.checking")}</dd>
      </div>
    );
  return (
    <>
      {plugins.hosts.map((host) => (
        <InfoRow
          key={host.host}
          label={pluginHostNames[host.host]}
          value={describe(host)}
        />
      ))}
    </>
  );
}

export function AboutFeedback({
  info,
  request,
  onOpenDocs,
  onOpenFaq,
  onOpenPlugins,
}: {
  info: DesktopInfo | null;
  request?: FeedbackRequest;
  onOpenDocs?: () => void;
  onOpenFaq?: () => void;
  onOpenPlugins?: () => void;
}) {
  const t = useTranslator(messages);
  const appIcon = appIconForTheme(useAppearanceTheme());
  const [shownView, setView] = useState<"about" | "report">("about");
  const hasDraft =
    !!readSessionDraft("feedback.report.summary", "").trim() ||
    !!readSessionDraft("feedback.report.steps", "").trim();
  const [shownContext, setContext] = useSessionDraft<
    ReportProblemDetail | undefined
  >("feedback.context", undefined);
  const opening =
    request && readSessionDraft("feedback.request", 0) !== request.id
      ? request
      : undefined;
  const view = opening
    ? opening.view === "report"
      ? "report"
      : "about"
    : shownView;
  const context = opening ? opening.context : shownContext;
  useEffect(() => {
    if (!opening) return;
    writeSessionDraft("feedback.request", opening.id);
    setView(opening.view === "report" ? "report" : "about");
    setContext(opening.context);
  }, [opening]);
  const diagnostics = useDiagnostics(info, view === "about");
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();
  const channels = supportChannels();
  const desktopLogs = !!window.showai?.openLogFolder;
  const localPlugins =
    !!info && workbenchCapabilities(info.platform).localPlugins;
  const done = (text: string) => setStatus({ text });
  const fail = (reason: unknown) =>
    setStatus({
      text: t("report.failed", { message: errorMessage(reason) }),
      error: true,
    });
  if (view === "report")
    return (
      <ReportProblemForm
        info={info}
        context={context}
        onContextChange={setContext}
        onBack={() => {
          setContext(undefined);
          setView("about");
        }}
      />
    );
  const exportDiagnostics = (text: string) => {
    if (window.showai?.exportDiagnostics)
      return window.showai.exportDiagnostics(text).then((result) => {
        if (result) done(t("diag.exported", { path: result.path }));
      });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    link.download = `showai-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    done(t("diag.downloaded"));
    return Promise.resolve();
  };
  const faq = () => {
    if (onOpenFaq) onOpenFaq();
    else window.open(AGENT_TROUBLESHOOTING, "_blank", "noopener");
  };
  return (
    <div className="feedback-about">
      <div id="feedback-product-card" className="settings-card feedback-product-card">
        <div className="settings-product">
          <img
            className="settings-product-symbol"
            src={appIcon}
            alt=""
            draggable={false}
          />
          <div>
            <h3>ShowAI</h3>
            <p>{versionLine(info)}</p>
          </div>
        </div>
        <ProductUpdateControl />
      </div>

      <section className="settings-group" aria-labelledby="feedback-help-title">
        <h2 id="feedback-help-title">{t("help.title")}</h2>
        <div className="feedback-cards">
          <button type="button" className="feedback-card" onClick={faq}>
            <ExternalLink size={16} aria-hidden="true" />
            <strong>{t("help.faq")}</strong>
            <span>{t("help.faqDetail")}</span>
          </button>
          <button
            type="button"
            className="feedback-card"
            onClick={() => {
              if (!hasDraft) setContext(undefined);
              setView("report");
            }}
          >
            <Flag size={16} aria-hidden="true" />
            <strong>{t(hasDraft ? "resumeReport" : "help.report")}</strong>
            <span>{t("help.reportDetail")}</span>
          </button>
          {onOpenDocs && (
            <button
              type="button"
              className="feedback-card"
              onClick={onOpenDocs}
            >
              <BookOpen size={16} aria-hidden="true" />
              <strong>{t("help.docs")}</strong>
              <span>{t("help.docsDetail")}</span>
            </button>
          )}
          {channels.email && (
            <a className="feedback-card" href={`mailto:${channels.email}`}>
              <Info size={16} aria-hidden="true" />
              <strong>{t("help.email")}</strong>
              <span>{channels.email}</span>
            </a>
          )}
          {channels.community && (
            <a
              className="feedback-card"
              href={channels.community.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} aria-hidden="true" />
              <strong>{t("help.community")}</strong>
              <span>{channels.community.label}</span>
            </a>
          )}
        </div>
      </section>

      <section
        className="settings-group settings-about"
        aria-labelledby="feedback-technical-title"
      >
        <div className="settings-group-heading">
          <h2 id="feedback-technical-title">{t("technicalInfo")}</h2>
          {onOpenPlugins && localPlugins && (
            <button
              type="button"
              className="settings-button"
              onClick={onOpenPlugins}
            >
              {t("openPluginSettings")}
            </button>
          )}
        </div>
        <dl className="settings-card feedback-info-list">
          <InfoRow label={t("info.version")} value={versionLine(info)} />
          <InfoRow label={t("info.platform")} value={platformLine(info)} />
          <InfoRow label={t("info.runtime")} value={runtimeLine(info)} />
          <InfoRow
            label={t("info.mode")}
            value={
              info
                ? `${
                    info.mode === "browser"
                      ? t("mode.browser")
                      : info.packaged
                        ? t("mode.packaged")
                        : t("mode.development")
                  } (${modeLine(info)})`
                : "—"
            }
          />
          {info && localPlugins && <PluginRows home={info.home} />}
        </dl>
      </section>

      <section
        className="settings-group"
        aria-labelledby="feedback-diagnostics-title"
      >
        <div className="settings-group-heading">
          <div>
            <h2 id="feedback-diagnostics-title">{t("diag.title")}</h2>
            <p className="settings-group-desc">{t("diag.privacy")}</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card-section">
            <DiagnosticsPreview
              text={diagnostics.text}
              error={diagnostics.error}
            />
            <div className="feedback-actions">
              <button
                type="button"
                className="settings-button feedback-primary"
                disabled={!diagnostics.text}
                onClick={() =>
                  void writeClipboard(diagnostics.text!).then(
                    () => done(t("diag.copied")),
                    fail,
                  )
                }
              >
                <Copy size={14} aria-hidden="true" />
                {t("diag.copy")}
              </button>
              {desktopLogs && (
                <button
                  type="button"
                  className="settings-button"
                  onClick={() =>
                    void window.showai!.openLogFolder!().catch(fail)
                  }
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  {t("diag.openLogs")}
                </button>
              )}
              <button
                type="button"
                className="settings-button"
                disabled={!diagnostics.text}
                onClick={() =>
                  void exportDiagnostics(diagnostics.text!).catch(fail)
                }
              >
                <Download size={14} aria-hidden="true" />
                {t("diag.export")}
              </button>
            </div>
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
      </section>
    </div>
  );
}
