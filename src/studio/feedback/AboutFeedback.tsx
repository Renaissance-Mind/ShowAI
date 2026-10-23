import { useEffect, useState } from "react";
import type { AgentConnectionRecord } from "../../agent/mcp-connections";
import { supportChannels } from "../../core/support-channels";
import type { DesktopInfo } from "../../desktop/bridge";
import type { PluginInstallation } from "../../plugin/desktop-install";
import { getLocale } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/feedback";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  Flag,
  FolderOpen,
  Info,
} from "../../ui/icons";
import { desktop, errorMessage } from "../bridge";
import { workbenchCapabilities } from "../capabilities";
import { verifyState } from "../PluginInstallSettings";
import type { ReportProblemDetail } from "../problems/report-event";
import { pluginHostNames, usePluginHosts } from "../usePluginHosts";
import { AGENT_TROUBLESHOOTING } from "../AgentReadiness";
import {
  modeLine,
  platformLine,
  runtimeLine,
  versionLine,
} from "./diagnostics";
import {
  DiagnosticsPreview,
  logAvailable,
  useDiagnostics,
  type DiagnosticsOptions,
} from "./DiagnosticsPreview";
import { ReportProblemForm } from "./ReportProblemForm";
import "./feedback.css";

/** What opened 关于与反馈: the page itself, the report form or the diagnostics preview. */
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
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
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
          title={copied ? t("info.copied", { label }) : t("info.copy", { label })}
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

/** Install state and the latest connection result of each Agent host. */
function PluginRows({ home }: { home: string }) {
  const t = useTranslator(messages);
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
        ? t("conn.failed", { code: state.code, time: timeText(state.at) })
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
        <dd className="feedback-error">
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

/**
 * Settings → 关于与反馈: app information that can be copied line by line,
 * where to get help, and redacted diagnostics. The browser workbench shows
 * the same page without the desktop-only log actions.
 */
export function AboutFeedback({
  info,
  request,
  onOpenDocs,
  onOpenFaq,
}: {
  info: DesktopInfo | null;
  request?: FeedbackRequest;
  /** Absent where the built-in documentation is not available. */
  onOpenDocs?: () => void;
  onOpenFaq?: () => void;
}) {
  const t = useTranslator(messages);
  const [view, setView] = useState<"about" | "report">(
    request?.view === "report" ? "report" : "about",
  );
  const [context, setContext] = useState(request?.context);
  const [previewOpen, setPreviewOpen] = useState(
    request?.view === "diagnostics",
  );
  useEffect(() => {
    if (!request) return;
    setView(request.view === "report" ? "report" : "about");
    setContext(request.context);
    if (request.view === "diagnostics") setPreviewOpen(true);
  }, [request]);
  const [options, setOptions] = useState<DiagnosticsOptions>({
    includeLibraryPath: false,
    includeLog: logAvailable(),
  });
  const diagnostics = useDiagnostics(info, options, previewOpen);
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
    // Browser workbench: the browser saves the file in its download folder.
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
      <div className="settings-product">
        <span className="settings-product-symbol" aria-hidden="true">
          ✳
        </span>
        <div>
          <h2>ShowAI</h2>
        </div>
      </div>
      <section
        className="settings-group settings-about"
        aria-labelledby="feedback-info-title"
      >
        <h2 id="feedback-info-title">{t("info.title")}</h2>
        <dl>
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
        aria-labelledby="feedback-help-title"
      >
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
              setContext(undefined);
              setView("report");
            }}
          >
            <Flag size={16} aria-hidden="true" />
            <strong>{t("help.report")}</strong>
            <span>{t("help.reportDetail")}</span>
          </button>
          {onOpenDocs && (
            <button type="button" className="feedback-card" onClick={onOpenDocs}>
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
        className="settings-group"
        aria-labelledby="feedback-diagnostics-title"
      >
        <h2 id="feedback-diagnostics-title">{t("diag.title")}</h2>
        <p className="feedback-muted">{t("diag.privacy")}</p>
        <div className="feedback-actions">
          <button
            type="button"
            className="settings-button feedback-primary"
            aria-expanded={previewOpen}
            onClick={() => {
              setStatus(undefined);
              setPreviewOpen(true);
            }}
          >
            <Copy size={14} aria-hidden="true" />
            {t("diag.copy")}
          </button>
          {desktopLogs && (
            <button
              type="button"
              className="settings-button"
              onClick={() => void window.showai!.openLogFolder!().catch(fail)}
            >
              <FolderOpen size={14} aria-hidden="true" />
              {t("diag.openLogs")}
            </button>
          )}
          <button
            type="button"
            className="settings-button"
            onClick={() => {
              setStatus(undefined);
              if (diagnostics.text)
                void exportDiagnostics(diagnostics.text).catch(fail);
              else setPreviewOpen(true);
            }}
          >
            <Download size={14} aria-hidden="true" />
            {t("diag.export")}
          </button>
        </div>
        {previewOpen && (
          <>
            <DiagnosticsPreview
              options={options}
              onOptionsChange={setOptions}
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
                {t("diag.copyNow")}
              </button>
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
              <button
                type="button"
                className="settings-button"
                onClick={() => setPreviewOpen(false)}
              >
                {t("diag.close")}
              </button>
            </div>
          </>
        )}
        {status && (
          <p
            className={status.error ? "feedback-error" : "feedback-status"}
            role={status.error ? "alert" : "status"}
          >
            {status.text}
          </p>
        )}
      </section>
    </div>
  );
}
