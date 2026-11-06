import { useEffect, useState } from "react";
import { Cloud, Globe, Copy, RefreshCw, ExternalLink } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteMcp";
import type { RemoteMcpConfig, RemoteMcpStatus } from "../remote-mcp/types";
import { desktop, errorMessage } from "./bridge";
import "./remote-mcp-settings.css";

export default function RemoteMcpSettings() {
  const t = useTranslator(messages);
  const [state, setState] = useState<RemoteMcpStatus>();
  const [config, setConfig] = useState<RemoteMcpConfig>();
  const [token, setToken] = useState("");
  const [pair, setPair] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    let active = true;
    const read = (refresh = false) =>
      desktop
        .invoke<RemoteMcpStatus>("remoteMcp:status", { refresh })
        .then((value) => {
          if (!active) return;
          setState(value);
          setConfig((previous) => previous ?? value.config);
        })
        .catch((reason) => {
          if (active) setError(errorMessage(reason));
        });
    void read(true);
    const timer = setInterval(() => void read(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function action(name: string, args = {}) {
    setBusy(true);
    setError("");
    try {
      const value = await desktop.invoke<RemoteMcpStatus>(name, args);
      setState(value);
      if (name === "remoteMcp:start") {
        setToken("");
        setPair("");
      }
      if (name === "remoteMcp:stop") setPair("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string, id: string) {
    try {
      await desktop.invoke("clipboard:write", { text: value });
      setCopied(id);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  async function install() {
    setBusy(true);
    setError("");
    try {
      const executable = await desktop.invoke<string>(
        "remoteMcp:installCloudflare",
      );
      setConfig((previous) =>
        previous ? { ...previous, executable } : previous,
      );
      setState(
        await desktop.invoke<RemoteMcpStatus>("remoteMcp:status", {
          refresh: true,
        }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  if (!state || !config)
    return <p role={error ? "alert" : "status"}>{error || t("working")}</p>;
  const running = state.phase === "running" || state.phase === "starting";
  const locked = busy || running;
  const tailscale = config.provider === "tailscale";
  const tool = tailscale ? "tailscale" : "cloudflared";
  const executable =
    config.executable ||
    (tailscale ? state.executables.tailscale : state.executables.cloudflare);
  const update = (patch: Partial<RemoteMcpConfig>) => {
    setConfig({ ...config, ...patch });
    setError("");
  };
  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
  return (
    <div className="remote-mcp-settings" aria-busy={busy}>
      <div className="remote-mcp-status" aria-label={t("status")}>
        <div>
          <strong role="status">
            <i data-online={state.phase === "running" && state.reachable} />
            {t(state.phase)}
          </strong>
          {running && (
            <span>
              {t(
                state.reachable === true
                  ? "reachable"
                  : state.reachable === false
                    ? "unreachable"
                    : "unchecked",
              )}
            </span>
          )}
        </div>
        <button
          className="settings-button"
          disabled={busy || (!running && !config.projects.length)}
          onClick={() =>
            void action(
              running ? "remoteMcp:stop" : "remoteMcp:start",
              running ? {} : { config, token },
            )
          }
        >
          {t(running ? "stop" : "start")}
        </button>
      </div>
      {(error || state.error) && (
        <pre className="remote-mcp-error" role="alert">
          {error || state.error}
        </pre>
      )}
      {state.diagnostics && state.error && (
        <details className="remote-mcp-disclosure">
          <summary>{t("diagnostics")}</summary>
          <pre className="remote-mcp-error">{state.diagnostics}</pre>
        </details>
      )}
      <fieldset disabled={locked} className="remote-mcp-providers">
        <legend>{t("provider")}</legend>
        <button
          type="button"
          aria-pressed={!tailscale}
          onClick={() =>
            update({ provider: "cloudflare-quick", executable: "" })
          }
        >
          <Cloud size={22} />
          Cloudflare
        </button>
        <button
          type="button"
          aria-pressed={tailscale}
          onClick={() => update({ provider: "tailscale", executable: "" })}
        >
          <Globe size={22} />
          Tailscale
        </button>
      </fieldset>
      {!tailscale && (
        <div
          className="remote-mcp-modes"
          role="group"
          aria-label={t("cloudflare")}
        >
          {(["cloudflare-quick", "cloudflare"] as const).map((provider) => (
            <button
              key={provider}
              disabled={locked}
              aria-pressed={config.provider === provider}
              onClick={() => update({ provider })}
            >
              {t(provider === "cloudflare" ? "named" : "quick")}
            </button>
          ))}
        </div>
      )}
      {config.provider !== "cloudflare" && (
        <p className="settings-help">
          {t(tailscale ? "tailscaleNote" : "quickNote")}
        </p>
      )}
      {config.provider === "cloudflare" && (
        <fieldset disabled={locked} className="remote-mcp-fields">
          <label>
            {t("url")}
            <input
              type="url"
              value={config.publicUrl}
              placeholder="https://showai.example.com"
              onChange={(e) => update({ publicUrl: e.target.value })}
            />
          </label>
          <label>
            {t("token")}
            <input
              type="password"
              autoComplete="off"
              value={token}
              placeholder={t(state.tokenSaved ? "tokenSaved" : "tokenEmpty")}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
        </fieldset>
      )}
      <div className="remote-mcp-tool">
        <span>
          {executable
            ? t(config.executable ? "selectedTool" : "detected", { tool })
            : t("missing", { tool })}
        </span>
        <button
          className="settings-button"
          disabled={busy}
          onClick={() => void action("remoteMcp:status", { refresh: true })}
        >
          <RefreshCw size={13} />
          {t("refresh")}
        </button>
      </div>
      {!tailscale && !executable && (
        <button
          className="settings-button"
          disabled={locked}
          onClick={() => void install()}
        >
          {t(busy ? "working" : "downloadCloudflare")}
        </button>
      )}
      <details className="remote-mcp-disclosure">
        <summary>{t("advanced")}</summary>
        <fieldset disabled={locked} className="remote-mcp-fields">
          <label>
            {t("port")}
            <input
              type="number"
              min={1024}
              max={65535}
              value={config.port}
              onChange={(e) => update({ port: Number(e.target.value) })}
            />
          </label>
          <label>
            {t("executable")}
            <input
              value={config.executable}
              placeholder={t("auto")}
              onChange={(e) => update({ executable: e.target.value })}
            />
          </label>
          <button
            className="settings-button"
            onClick={() =>
              void desktop
                .invoke<string | null>("remoteMcp:chooseExecutable")
                .then((path) => {
                  if (path) update({ executable: path });
                })
                .catch((reason) => setError(errorMessage(reason)))
            }
          >
            {t("choose")}
          </button>
        </fieldset>
      </details>
      <section className="settings-group">
        <h2>{t("projects")}</h2>
        {!state.projects.length && (
          <p className="settings-help">{t("noProjects")}</p>
        )}
        {state.projects.map((project) => {
          const permission = config.projects.find((p) => p.id === project.id);
          return (
            <div className="remote-mcp-project" key={project.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={!!permission}
                  onChange={(e) =>
                    update({
                      projects: e.target.checked
                        ? [...config.projects, { id: project.id, write: false }]
                        : config.projects.filter((p) => p.id !== project.id),
                    })
                  }
                />
                {project.name}
              </label>
              <select
                aria-label={t("permission", { name: project.name })}
                disabled={locked || !permission}
                value={permission?.write ? "write" : "read"}
                onChange={(e) =>
                  update({
                    projects: config.projects.map((p) =>
                      p.id === project.id
                        ? { ...p, write: e.target.value === "write" }
                        : p,
                    ),
                  })
                }
              >
                <option value="read">{t("read")}</option>
                <option value="write">{t("write")}</option>
              </select>
            </div>
          );
        })}
      </section>
      {state.url && running && (
        <section className="settings-group">
          <h2>{t("address")}</h2>
          <div className="remote-mcp-copy">
            <code>{state.url}</code>
            <button
              className="settings-button"
              onClick={() => void copy(state.url!, "url")}
            >
              <Copy size={13} />
              {t(copied === "url" ? "copied" : "copy")}
            </button>
          </div>
          <button
            className="settings-button"
            disabled={busy}
            onClick={() => void action("remoteMcp:check")}
          >
            {t("check")}
          </button>
        </section>
      )}
      {state.phase === "running" && (
        <section className="settings-group">
          <h2>{t("pairing")}</h2>
          <button
            className="settings-button"
            onClick={() =>
              void desktop
                .invoke<{ code: string }>("remoteMcp:pair")
                .then((value) => {
                  setPair(value.code);
                  setCopied("");
                })
                .catch((reason) => setError(errorMessage(reason)))
            }
          >
            {t("generate")}
          </button>
          {pair && (
            <>
              <div className="remote-mcp-copy">
                <code>{pair}</code>
                <button
                  className="settings-button"
                  onClick={() => void copy(pair, "pair")}
                >
                  {t(copied === "pair" ? "copied" : "copy")}
                </button>
              </div>
              <p className="settings-help">{t("pairingNote")}</p>
            </>
          )}
          <h3>{t("clients")}</h3>
          {!state.clients.length && (
            <p className="settings-help">{t("noClients")}</p>
          )}
          {state.clients.map((client) => (
            <div className="remote-mcp-project" key={client.id}>
              <span>{client.name}</span>
              <button
                className="settings-button"
                disabled={busy}
                onClick={() =>
                  void action("remoteMcp:revoke", { id: client.id })
                }
              >
                {t("revoke")}
              </button>
            </div>
          ))}
          {state.lastCallAt && (
            <p className="settings-help">
              {t("lastCall", {
                time: new Date(state.lastCallAt).toLocaleString(),
              })}
            </p>
          )}
        </section>
      )}
      <details className="remote-mcp-disclosure" open={!executable}>
        <summary>{t("setup")}</summary>
        <ol>
          {(tailscale
            ? ["tailscale1", "tailscale2", "tailscale3"]
            : config.provider === "cloudflare"
              ? ["quick1", "named1", "named2", "named3"]
              : ["quick1", "quick2"]
          ).map((key) => (
            <li key={key}>{t(key as Parameters<typeof t>[0])}</li>
          ))}
        </ol>
        {config.provider === "cloudflare" && (
          <div className="remote-mcp-copy">
            <span>{t("route")}</span>
            <code>http://127.0.0.1:{config.port}</code>
            <button
              className="settings-button"
              onClick={() =>
                void copy(`http://127.0.0.1:${config.port}`, "route")
              }
            >
              {t(copied === "route" ? "copied" : "copy")}
            </button>
          </div>
        )}
        <div className="remote-mcp-links">
          {tailscale ? (
            <>
              {link("https://tailscale.com/download", t("installTailscale"))}
              {link(
                "https://login.tailscale.com/admin/dns",
                t("tailscaleAdmin"),
              )}
              {link(
                "https://tailscale.com/docs/features/tailscale-funnel",
                t("docs"),
              )}
            </>
          ) : (
            <>
              {link(
                "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/",
                t("installCloudflare"),
              )}
              {link("https://dash.cloudflare.com/", t("cloudDashboard"))}
            </>
          )}
        </div>
      </details>
      <details className="remote-mcp-disclosure">
        <summary>{t("chatgpt")}</summary>
        <ol>
          {(["chatgpt1", "chatgpt2", "chatgpt3", "chatgpt4"] as const).map(
            (key) => (
              <li key={key}>{t(key)}</li>
            ),
          )}
        </ol>
        {link("https://chatgpt.com/plugins", t("openChatgpt"))}
      </details>
      <details className="remote-mcp-disclosure">
        <summary>{t("other")}</summary>
        <p>{t("otherText")}</p>
      </details>
      <p className="settings-help">{t("onlineNote")}</p>
    </div>
  );
}
