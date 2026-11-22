import { useEffect, useState } from "react";
import type { McpCallCursor, McpCallPage } from "../agent/mcp-call-history";
import type { McpLogSettings } from "../agent/mcp-log-settings";
import type { RuntimeRegistrationStatus } from "../agent/runtime";
import { desktop, errorMessage } from "../host/bridge";
import { MCP_LOG_RETENTION_DAYS, type DesktopInfo } from "../host/protocol";
import { getLocale } from "../i18n";
import messages from "../i18n/messages/mcpSettings";
import { useTranslator } from "../i18n/react";
import {
  launchSnippet,
  type LaunchSnippetKind,
  type McpLaunch,
} from "../plugin/launch-snippets";
import { useNotify } from "../problems/toast-context";
import type { RemoteMcpStatus } from "../remote-mcp/types";
import { RefreshCw } from "../ui/icons";
import Select from "../ui/Select";
import { RuntimeRegistration } from "./PluginInstallSettings";
import { SettingsPath } from "./SettingsPath";

function CallHistory({
  transport,
  onTransport,
}: {
  transport: string;
  onTransport: (value: string) => void;
}) {
  const t = useTranslator(messages);
  const [cursors, setCursors] = useState<McpCallCursor[]>([]);
  const [page, setPage] = useState<McpCallPage>();
  const [error, setError] = useState("");
  const before = cursors.at(-1);
  useEffect(() => {
    let active = true;
    setPage(undefined);
    setError("");
    void desktop
      .invoke<McpCallPage>("mcp:callHistory", {
        ...(transport && { transport }),
        ...(before && { before }),
      })
      .then(
        (result) => {
          if (active) setPage(result);
        },
        (reason) => {
          if (active) setError(errorMessage(reason));
        },
      );
    return () => {
      active = false;
    };
  }, [transport, before]);
  const time = new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "short",
    timeStyle: "medium",
  });
  const duration = new Intl.NumberFormat(getLocale(), {
    maximumFractionDigits: 1,
    style: "unit",
    unit: "millisecond",
    unitDisplay: "narrow",
  });
  return (
    <section className="settings-group" aria-labelledby="settings-mcp-history">
      <div className="settings-group-heading">
        <h2 id="settings-mcp-history">{t("history")}</h2>
        <Select
          aria-label={t("transport")}
          value={transport}
          onChange={(event) => onTransport(event.target.value)}
        >
          <option value="">{t("all")}</option>
          <option value="stdio">{t("local")}</option>
          <option value="http">{t("http")}</option>
        </Select>
      </div>
      <div className="settings-card mcp-history" aria-busy={!error && !page}>
        {error ? (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        ) : !page ? (
          <p role="status">{t("loading")}</p>
        ) : !page.records.length ? (
          <p>{t(transport ? "filteredEmpty" : "empty")}</p>
        ) : (
          <div
            className="mcp-history-scroll"
            role="region"
            aria-labelledby="settings-mcp-history"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  {(
                    ["time", "tool", "client", "result", "duration"] as const
                  ).map((key) => (
                    <th key={key} scope="col">
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.records.map((call) => (
                  <tr key={call.callId}>
                    <td>
                      <time dateTime={call.at}>
                        {time.format(new Date(call.at))}
                      </time>
                    </td>
                    <td>
                      <code>{call.tool}</code>
                      {call.action && <small>{call.action}</small>}
                    </td>
                    <td>
                      {call.client ?? t("unknownClient")}
                      <small>
                        {call.transport === "stdio" ? "stdio" : "HTTP"}
                      </small>
                    </td>
                    <td>
                      <span
                        className="mcp-call-result"
                        data-status={call.status}
                      >
                        {t(call.status)}
                      </span>
                      {call.errorCode && <small>{call.errorCode}</small>}
                    </td>
                    <td>
                      {call.durationMs === undefined
                        ? "—"
                        : duration.format(call.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {(before || page?.next) && (
        <div className="mcp-history-pages">
          <button
            type="button"
            className="settings-button"
            disabled={!before}
            onClick={() => setCursors((previous) => previous.slice(0, -1))}
          >
            {t("newer")}
          </button>
          <button
            type="button"
            className="settings-button"
            disabled={!page?.next}
            onClick={() => {
              if (page?.next) setCursors([...cursors, page.next]);
            }}
          >
            {t("older")}
          </button>
        </div>
      )}
    </section>
  );
}

export default function McpSettings({
  info,
  onRemote,
}: {
  info: DesktopInfo;
  onRemote: () => void;
}) {
  const t = useTranslator(messages);
  const notify = useNotify();
  const [revision, setRevision] = useState(0);
  const [transport, setTransport] = useState("");
  const [runtime, setRuntime] = useState<RuntimeRegistrationStatus>();
  const [logs, setLogs] = useState<McpLogSettings>();
  const [remote, setRemote] = useState<RemoteMcpStatus>();
  const [remoteError, setRemoteError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<LaunchSnippetKind>("json");
  useEffect(() => {
    let active = true;
    setError("");
    void Promise.all([
      desktop.invoke<RuntimeRegistrationStatus>("plugins:runtime"),
      desktop.invoke<McpLogSettings>("mcp:settings"),
    ]).then(
      ([status, settings]) => {
        if (active) {
          setRuntime(status);
          setLogs(settings);
        }
      },
      (reason) => {
        if (active) setError(errorMessage(reason));
      },
    );
    if (info.mode === "desktop") {
      setRemoteError("");
      void desktop.invoke<RemoteMcpStatus>("remoteMcp:status").then(
        (result) => {
          if (active) setRemote(result);
        },
        (reason) => {
          if (active) setRemoteError(errorMessage(reason));
        },
      );
    }
    return () => {
      active = false;
    };
  }, [info.mode, revision]);

  async function change(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  const refresh = () => setRevision((previous) => previous + 1);
  const phases =
    remote?.connections?.map((connection) => connection.phase) ??
    (remote ? [remote.phase] : []);
  const running = phases.filter((phase) => phase === "running").length;
  const failed = phases.filter((phase) => phase === "error").length;
  return (
    <>
      <section className="settings-group" aria-labelledby="settings-mcp-status">
        <div className="settings-group-heading">
          <h2 id="settings-mcp-status">{t("status")}</h2>
          <button
            type="button"
            className="settings-button"
            disabled={busy}
            onClick={refresh}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {t("check")}
          </button>
        </div>
        <div className="settings-card">
          {runtime && runtime.state !== "current" ? (
            <RuntimeRegistration
              runtime={runtime}
              busy={busy}
              onRepair={() =>
                void change(async () => {
                  setRuntime(
                    await desktop.invoke<RuntimeRegistrationStatus>(
                      "plugins:repairRuntime",
                    ),
                  );
                })
              }
            />
          ) : (
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>
                  {t("runtime")}{" "}
                  {runtime && (
                    <span className="settings-badge" data-tone="ok">
                      {t("ready")}
                    </span>
                  )}
                </h3>
                <p>
                  {runtime
                    ? `v${runtime.current.version} · ${t("onDemand")}`
                    : error || t("loading")}
                </p>
              </div>
            </div>
          )}
          {info.mode === "desktop" && (
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>{t("remote")}</h3>
                <p>
                  {remoteError ? (
                    <span role="alert">{remoteError}</span>
                  ) : !remote ? (
                    t("loading")
                  ) : (
                    [
                      running
                        ? t("running", { count: running })
                        : phases.includes("starting")
                          ? t("starting")
                          : t("stopped"),
                      failed ? t("remoteErrors", { count: failed }) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  )}
                </p>
              </div>
              <button
                type="button"
                className="settings-button"
                onClick={onRemote}
              >
                {t("manage")}
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="settings-group" aria-labelledby="settings-mcp-basics">
        <h2 id="settings-mcp-basics">{t("basics")}</h2>
        <div className="settings-card">
          <div className="settings-card-section">
            <h3 className="settings-section-heading">{t("library")}</h3>
            <SettingsPath
              value={info.home}
              copyLabel={t("copyPath")}
              copiedLabel={t("copied")}
              onCopy={() =>
                desktop
                  .invoke("clipboard:write", { text: info.home })
                  .catch((reason) => {
                    setError(errorMessage(reason));
                    return false;
                  })
              }
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{t("launch")}</h3>
            </div>
            <div className="settings-row-actions">
              <Select
                aria-label={t("format")}
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as LaunchSnippetKind)
                }
              >
                <option value="json">JSON</option>
                <option value="codex">Codex TOML</option>
                <option value="claude">Claude Code CLI</option>
                <option value="opencode">OpenCode JSON</option>
              </Select>
              <button
                type="button"
                className="settings-button"
                disabled={busy}
                onClick={() =>
                  void change(async () => {
                    const launch = await desktop.invoke<McpLaunch>(
                      "plugins:launchConfig",
                    );
                    await desktop.invoke("clipboard:write", {
                      text: launchSnippet(format, launch, info.platform),
                    });
                    notify(t("copied"));
                  })
                }
              >
                {t("copy")}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3 id="mcp-retention-label">{t("retention")}</h3>
              {logs?.recording === false && <p>{t("loggingOff")}</p>}
            </div>
            {logs && (
              <Select
                aria-labelledby="mcp-retention-label"
                value={String(logs.retentionDays)}
                disabled={busy}
                onChange={(event) => {
                  const days = Number(event.target.value);
                  void change(async () => {
                    setLogs(
                      await desktop.invoke<McpLogSettings>(
                        "mcp:setLogRetention",
                        { days },
                      ),
                    );
                    refresh();
                    notify(t("saved"));
                  });
                }}
              >
                {MCP_LOG_RETENTION_DAYS.map((days) => (
                  <option key={days} value={days}>
                    {t("days", { count: days })}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <CallHistory
        key={revision + transport}
        transport={transport}
        onTransport={setTransport}
      />
    </>
  );
}
