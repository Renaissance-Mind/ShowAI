import { useEffect, useId, useRef, useState } from "react";
import { appIconForTheme } from "../design/app-icon";
import { useAppearanceTheme } from "../design/useAppearanceTheme";
import { desktop, errorMessage } from "../host/bridge";
import commonMessages from "../i18n/messages/common";
import messages from "../i18n/messages/remoteConnections";
import { useLocale, useTranslator } from "../i18n/react";
import { useNotify } from "../problems/toast-context";
import {
  agentSetupPrompt,
  isTailscaleProvider,
} from "../remote-mcp/client-setup";
import {
  remoteMcpProviders,
  type RemoteMcpConfig,
  type RemoteMcpConnectionSummary,
  type RemoteMcpProvider,
  type RemoteMcpStatus,
} from "../remote-mcp/types";
import Dialog from "../ui/Dialog";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  CircleAlert,
  ExternalLink,
  Eye,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  KeyRound,
  Laptop,
  Network,
  Pencil,
  Power,
  Presentation,
  RefreshCw,
  Save,
  Settings2,
  Tablet,
  Unplug,
  X,
} from "../ui/icons";
import RemoteMcpClientSetup from "./RemoteMcpClientSetup";
import {
  RemoteBrand,
  RemoteCopyField,
  RemoteSelect,
  remoteProviderKeys,
} from "./RemoteConnectionControls";
import "./remote-mcp-settings.css";
import { useSessionDraft } from "./session-draft";

export default function RemoteMcpSettings({ home }: { home?: string }) {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const locale = useLocale();
  const notify = useNotify();
  const theme = useAppearanceTheme();
  const portErrorId = useId();
  const addressErrorId = useId();
  const [copiedPrompt, setCopiedPrompt] = useState("");
  useEffect(() => {
    if (!copiedPrompt) return;
    const timer = setTimeout(() => setCopiedPrompt(""), 2200);
    return () => clearTimeout(timer);
  }, [copiedPrompt]);

  const [selected, setSelected] = useState<RemoteMcpProvider>();
  const [state, setState] = useState<RemoteMcpStatus>();
  const [connections, setConnections] = useState<RemoteMcpConnectionSummary[]>(
    [],
  );
  const [drafts, setDrafts] = useSessionDraft<
    Partial<Record<RemoteMcpProvider, RemoteMcpConfig>>
  >(`remote-connections.drafts:${home ?? ""}`, {});
  const [tokens, setTokens] = useSessionDraft<
    Partial<Record<RemoteMcpProvider, string>>
  >(`remote-connections.tokens:${home ?? ""}`, {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"diagnostics" | "plugin" | null>(null);
  const [pluginLink, setPluginLink] = useState("");
  const current = useRef(selected);
  const opening = useRef<RemoteMcpProvider | undefined>(undefined);
  current.current = selected;
  const previousConfigs = useRef<
    Partial<Record<RemoteMcpProvider, RemoteMcpConfig>>
  >({});

  const name = (provider: RemoteMcpProvider) => t(remoteProviderKeys[provider]);
  const active = state?.phase === "running" || state?.phase === "starting";
  const ready = state?.phase === "running" && state.reachable === true;
  const config = selected ? drafts[selected] : undefined;
  const token = selected ? (tokens[selected] ?? "") : "";
  const permissionDirty =
    !!config &&
    !!state &&
    (config.access !== state.config.access ||
      JSON.stringify(config.projects) !==
        JSON.stringify(state.config.projects));
  const dirty =
    permissionDirty ||
    !!token ||
    (!!config &&
      !!state &&
      (
        [
          "port",
          "httpsPort",
          "bindAddress",
          "publicUrl",
          "executable",
          "privateAuth",
        ] as const
      ).some((key) => config[key] !== state.config[key]));

  const invalidPort =
    !!config?.port &&
    (!Number.isInteger(config.port) ||
      config.port < 1024 ||
      config.port > 65535);
  const availableAddress = state?.addresses.some((item) => item.address === config?.bindAddress);
  const missingAddress = !!config?.bindAddress && !availableAddress;
  const valid =
    !!config &&
    !invalidPort &&
    (config.provider !== "lan" || !!availableAddress) &&
    (config.provider !== "cloudflare" ||
      (/^https:\/\/[^/]+\/?$/.test(config.publicUrl) &&
        (!!token || !!state?.tokenSaved))) &&
    (config.access !== "selected" || config.projects.length > 0);

  const statusKey = (
    value: Pick<RemoteMcpStatus, "phase" | "reachable" | "configured">,
  ) =>
    value.phase === "error" ||
    (value.phase === "running" && value.reachable === false)
      ? "failed"
      : value.phase === "starting"
        ? "starting"
        : value.phase === "running"
          ? "on"
          : value.phase === "prepared"
            ? "prepared"
            : value.configured
              ? "off"
              : "unconfigured";

  function apply(value: RemoteMcpStatus) {
    setConnections(
      value.connections ?? [
        {
          provider: value.config.provider,
          phase: value.phase,
          configured: !!value.configured,
          enabled: !!value.resumeOnLaunch,
          config: value.config,
          url: value.url,
          clients: value.clients.length,
          clientList: value.clients,
          lastCallAt: value.lastCallAt,
          lastCallClientId: value.lastCallClientId,
          reachable: value.reachable,
          checkedAt: value.checkedAt,
          tokenSaved: value.tokenSaved,
        },
      ],
    );
    if (!current.current || value.config.provider === current.current)
      setState(value);
    if (current.current && value.config.provider === current.current) {
      const provider = current.current;
      const previousConfig = previousConfigs.current[provider];
      previousConfigs.current[provider] = value.config;
      setDrafts((previous) =>
        previous[provider]
          ? {
              ...previous,
              [provider]: {
                ...previous[provider]!,
                port:
                  previousConfig &&
                  previous[provider]!.port === previousConfig.port
                    ? value.config.port
                    : previous[provider]!.port,
                httpsPort:
                  previousConfig &&
                  previous[provider]!.httpsPort === previousConfig.httpsPort
                    ? value.config.httpsPort
                    : previous[provider]!.httpsPort,
              },
            }
          : {
              ...previous,
              [provider]: {
                ...value.config,
                projects: [...value.config.projects],
                bindAddress:
                  value.config.bindAddress ||
                  (provider === "lan"
                    ? value.addresses[0]?.address
                    : undefined),
              },
            },
      );
      if (
        opening.current === provider &&
        value.phase === "running" &&
        value.reachable
      ) {
        opening.current = undefined;
      }
    }
  }

  async function refresh(refreshStatus = false) {
    const value = await desktop.invoke<RemoteMcpStatus>("remoteMcp:status", {
      provider: current.current,
      refresh: refreshStatus,
    });
    apply(value);
  }

  useEffect(() => {
    let mounted = true;
    let reading = false;
    const read = async (refreshStatus = false) => {
      if (reading) return;
      reading = true;
      try {
        const value = await desktop.invoke<RemoteMcpStatus>(
          "remoteMcp:status",
          {
            provider: selected,
            refresh: refreshStatus,
          },
        );
        if (mounted) apply(value);
      } catch (err) {
        if (mounted) setError(errorMessage(err));
      } finally {
        reading = false;
      }
    };
    void read(true);
    const timer = setInterval(() => void read(), 1200);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selected]);

  function change(patch: Partial<RemoteMcpConfig>) {
    if (selected && config) {
      setDrafts((previous) => ({
        ...previous,
        [selected]: { ...config, ...patch },
      }));
    }
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function choose(provider: RemoteMcpProvider) {
    opening.current = undefined;
    setSelected(provider);
    setState(undefined);
    setError("");
  }

  function back() {
    opening.current = undefined;
    setSelected(undefined);
    setError("");
  }

  const copy = (text: string) =>
    desktop.invoke<void>("clipboard:write", { text });

  async function copyPrompt() {
    if (!ready || !state?.url) return;
    const invitation =
      state.config.provider === "lan"
        ? await desktop.invoke<{ code: string }>("remoteMcp:pair", {
            provider: "lan",
          })
        : undefined;
    await copy(
      agentSetupPrompt(state.url, state.config, locale, invitation?.code),
    );
    setCopiedPrompt(state.url);
  }

  async function start() {
    if (!selected || !config) return;
    const provider = selected;
    await run(async () => {
      const next = { ...config };
      if (
        provider !== "lan" &&
        !isTailscaleProvider(provider) &&
        !(next.executable || state?.executables.cloudflare)
      )
        next.executable = await desktop.invoke<string>(
          "remoteMcp:installCloudflare",
          { provider },
        );
      if (!next.executable && provider !== "lan")
        next.executable =
          (isTailscaleProvider(provider)
            ? state?.executables.tailscale
            : state?.executables.cloudflare) ?? "";
      opening.current = provider;
      const value = await desktop.invoke<RemoteMcpStatus>("remoteMcp:start", {
        config: next,
        token,
        replace: active,
      });
      setDrafts((previous) => ({ ...previous, [provider]: value.config }));
      setTokens((previous) => ({ ...previous, [provider]: "" }));
      apply(value);
    });
  }

  async function stop(provider: RemoteMcpProvider) {
    opening.current = undefined;
    await run(async () => {
      apply(
        await desktop.invoke<RemoteMcpStatus>("remoteMcp:stop", { provider }),
      );
    });
  }

  async function save() {
    if (!selected || !config || !state) return;
    const provider = selected;
    await run(async () => {
      const value = await desktop.invoke<RemoteMcpStatus>(
        "remoteMcp:configure",
        {
          config,
          token,
          restart: true,
        },
      );
      setDrafts((previous) => ({
        ...previous,
        [provider]: value.config,
      }));
      setTokens((previous) => ({ ...previous, [provider]: "" }));
      apply(value);
      notify(t(value.phase === "starting" ? "savingReconnect" : "saved"));
    });
  }

  async function prepareRoute() {
    if (config)
      await run(async () => {
        const value = await desktop.invoke<RemoteMcpStatus>(
          "remoteMcp:prepare",
          { config },
        );
        setDrafts((previous) => ({
          ...previous,
          [value.config.provider]: value.config,
        }));
        apply(value);
      });
  }

  function power(provider: RemoteMcpProvider, enabled: boolean) {
    if (enabled) void stop(provider);
    else if (current.current === provider) void start();
    else {
      const saved = connections.find(
        (connection) => connection.provider === provider,
      );
      if (
        !saved?.configured ||
        (provider === "lan" && !saved.config.bindAddress) ||
        (provider === "cloudflare" && !saved.config.publicUrl)
      )
        choose(provider);
      else
        void run(async () => {
          apply(
            await desktop.invoke<RemoteMcpStatus>("remoteMcp:start", {
              config: saved.config,
            }),
          );
        });
    }
  }

  const access = (projectId: string, value: "none" | "read" | "write") =>
    change({
      projects: [
        ...config!.projects.filter((project) => project.id !== projectId),
        ...(value === "none"
          ? []
          : [{ id: projectId, write: value === "write" }]),
      ],
    });

  async function revokeOverviewClient(
    provider: RemoteMcpProvider,
    id: string,
    clientName: string,
  ) {
    await run(async () => {
      await desktop.invoke("remoteMcp:revoke", { provider, id });
      await refresh();
      notify(t("accessRevoked", { name: clientName }));
    });
  }

  async function exportPlugin() {
    if (!selected) return;
    await run(async () => {
      const value = await desktop.invoke<{ path: string } | null>(
        "remoteMcp:exportPlugin",
        { provider: selected, connection: pluginLink },
      );
      if (value) {
        notify(t("exported"), {
          duration: 10000,
          action: {
            label: t("copyPath"),
            onSelect: () => {
              void desktop.invoke("clipboard:write", { text: value.path }).then(
                () => notify(tc("copied")),
                (reason) =>
                  notify(errorMessage(reason), {
                    kind: "warning",
                    duration: 8000,
                  }),
              );
            },
          },
        });
        setModal(null);
        await refresh();
      }
    });
  }

  const toggle = (provider: RemoteMcpProvider, enabled: boolean) => (
    <button
      type="button"
      className="rm-switch"
      role="switch"
      aria-checked={enabled}
      aria-label={t(enabled ? "disable" : "enable", { name: name(provider) })}
      title={t(enabled ? "disable" : "enable", { name: name(provider) })}
      disabled={busy || (!enabled && selected === provider && !valid)}
      onClick={() => power(provider, enabled)}
    >
      <span />
    </button>
  );

  const authorizedClients = connections.flatMap((connection) =>
    (connection.clientList ?? []).map((client) => ({
      ...client,
      provider: connection.provider,
      routeLastCallAt: connection.lastCallAt,
      routeLastCallClientId: connection.lastCallClientId,
    })),
  );

  const guideLines = selected
    ? t(`guide.${remoteProviderKeys[selected]}` as never)
        .split("\n")
        .filter(Boolean)
    : [];

  const step1Done = valid;
  const step2Done =
    !!config && (config.access !== "selected" || config.projects.length > 0);
  const step3Done = ready && !!state?.url;
  const step4Done = !!state && state.clients.length > 0;

  return (
    <section
      className="remote-settings"
      data-remote-view={selected ? "detail" : "overview"}
      data-remote-provider={selected}
      data-remote-phase={state?.phase}
      data-remote-ready={ready ? "true" : "false"}
    >
      {!selected ? (
        <>
          <div
            className="settings-card rm-concept-card"
            role="region"
            aria-label={t("topoLabel")}
          >
            <div className="rm-topology">
              <div className="rm-topo-sources">
                <div className="rm-topo-source">
                  <span className="rm-topo-lead">
                    <Tablet size={15} aria-hidden="true" />
                    <strong>{t("topoDeviceLan")}</strong>
                  </span>
                  <span className="rm-topo-net is-lan">
                    <Network size={12} aria-hidden="true" />
                    <span>{t("topoNetLan")}</span>
                  </span>
                </div>
                <div className="rm-topo-source">
                  <span className="rm-topo-lead">
                    <Bot size={15} aria-hidden="true" />
                    <strong>{t("topoAgentTailscale")}</strong>
                  </span>
                  <span className="rm-topo-net is-tailscale">
                    <RemoteBrand provider="tailscale-private" />
                    <span>{t("topoNetTailscale")}</span>
                  </span>
                </div>
                <div className="rm-topo-source">
                  <span className="rm-topo-lead">
                    <Globe size={15} aria-hidden="true" />
                    <strong>{t("topoAgentPublic")}</strong>
                  </span>
                  <span className="rm-topo-net is-public">
                    <RemoteBrand provider="cloudflare" />
                    <span>{t("topoNetPublic")}</span>
                  </span>
                </div>
              </div>

              <div className="rm-topo-edge" aria-hidden="true">
                <span className="rm-concept-badge">{t("topoHubBadge")}</span>
                <ArrowRight size={15} />
              </div>

              <div className="rm-topo-hub">
                <span className="rm-topo-hub-icon" aria-hidden="true">
                  <img
                    src={appIconForTheme(theme)}
                    alt=""
                    draggable={false}
                  />
                </span>
                <strong>{t("topoHubTitle")}</strong>
                <span className="rm-topo-hub-sub">MCP</span>
              </div>

              <div className="rm-topo-edge" aria-hidden="true">
                <ArrowRight size={15} />
              </div>

              <div className="rm-topo-library">
                <span className="rm-topo-lib-icon" aria-hidden="true">
                  <Folder size={19} />
                </span>
                <strong>{t("topoLibTitle")}</strong>
                <div className="rm-topo-lib-items">
                  <span>
                    <FolderOpen size={11} aria-hidden="true" />
                    {t("topoLibProjects")}
                  </span>
                  <span>
                    <FileText size={11} aria-hidden="true" />
                    {t("topoLibPages")}
                  </span>
                  <span>
                    <Presentation size={11} aria-hidden="true" />
                    {t("topoLibBoards")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {[remoteMcpProviders.slice(0, 2), remoteMcpProviders.slice(2)].map(
            (providers, index) => (
              <section className="settings-group rm-route-group" key={index}>
                <h2>{t(index ? "publicGroup" : "localGroup")}</h2>
                <div className="settings-card rm-route-list">
                  {providers.map((provider) => {
                    const value = connections.find(
                      (item) => item.provider === provider,
                    );
                    const label = statusKey(
                      value ?? { phase: "stopped", configured: false },
                    );
                    return (
                      <div
                        className="rm-route-row"
                        key={provider}
                        data-connection={provider}
                      >
                        <RemoteBrand provider={provider} />
                        <div className="rm-route-open">
                          <span className="rm-route-name">
                            <span>{name(provider)}</span>
                            <span className={`rm-status ${label}`}>
                              <span />
                              {t(label)}
                            </span>
                          </span>
                          <p className="rm-route-desc">
                            {t(`desc.${remoteProviderKeys[provider]}`)}
                          </p>
                          {value?.url && <code>{value.url}</code>}
                          {value?.checkedAt && (
                            <small>
                              {t("checkedAt", {
                                time: new Date(value.checkedAt).toLocaleString(
                                  locale,
                                ),
                              })}
                            </small>
                          )}
                        </div>
                        <div className="rm-route-actions">
                          <button
                            type="button"
                            className="rm-button"
                            aria-label={t("configure", {
                              name: name(provider),
                            })}
                            onClick={() => choose(provider)}
                          >
                            {t(
                              value?.configured
                                ? "viewConfiguration"
                                : "configureAction",
                            )}
                          </button>
                          {value &&
                            (value.enabled ||
                              (value.configured &&
                                (provider !== "lan" ||
                                  !!value.config.bindAddress) &&
                                (provider !== "cloudflare" ||
                                  (!!value.config.publicUrl &&
                                    value.tokenSaved)))) &&
                            toggle(provider, value.enabled)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ),
          )}

          <section
            className="settings-group rm-overview-clients"
            aria-labelledby="rm-overview-clients-title"
          >
            <h2 id="rm-overview-clients-title">{t("clients")}</h2>
            <p className="settings-group-desc">{t("overviewClientsDesc")}</p>
            <div className="settings-card">
              {authorizedClients.length ? (
                <div className="rm-client-table">
                  <div className="rm-client-table-head">
                    <span>{t("clients")}</span>
                    <span>{t("clientStatus")}</span>
                    <span>{t("clientAccess")}</span>
                  </div>
                  {authorizedClients.map((client) => {
                    const lastCall =
                      client.lastCallAt ??
                      (client.routeLastCallClientId === client.id
                        ? client.routeLastCallAt
                        : undefined);
                    return (
                      <div
                        className="rm-client-record"
                        key={`${client.provider}:${client.id}`}
                        data-client-provider={client.provider}
                      >
                        <span className="rm-device-name">
                          <Laptop size={18} aria-hidden="true" />
                          <span className="rm-device-meta">
                            <span>{client.name}</span>
                            <span className="rm-provider-badge">
                              {name(client.provider)}
                            </span>
                          </span>
                        </span>
                        <span
                          className={`rm-tag${lastCall ? " success" : ""}`}
                        >
                          {lastCall ? (
                            <Check size={12} aria-hidden="true" />
                          ) : (
                            <KeyRound size={12} aria-hidden="true" />
                          )}
                          {t(lastCall ? "verifiedState" : "authorizedState")}
                          {lastCall && (
                            <time dateTime={lastCall} title={t("activity")}>
                              {new Date(lastCall).toLocaleString(locale)}
                            </time>
                          )}
                        </span>
                        <button
                          type="button"
                          className="rm-button rm-danger-action"
                          aria-label={t("revoke", { name: client.name })}
                          disabled={busy}
                          onClick={() =>
                            void revokeOverviewClient(
                              client.provider,
                              client.id,
                              client.name,
                            )
                          }
                        >
                          <Unplug size={16} aria-hidden="true" />
                          {t("revokeAccess")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rm-overview-clients-empty">
                  <span
                    className="rm-overview-clients-empty-icon"
                    aria-hidden="true"
                  >
                    <Laptop size={20} />
                  </span>
                  <strong>{t("overviewClientsEmpty")}</strong>
                  <p>{t("overviewClientsEmptyDetail")}</p>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <header className="settings-subpage-bar rm-subpage-bar">
            <button
              type="button"
              className="rm-button settings-back-button rm-return"
              onClick={back}
            >
              <ChevronLeft size={15} aria-hidden="true" />
              {t("back")}
            </button>
            <div className="rm-subpage-status">
              <RemoteBrand provider={selected} />
              <strong className="settings-subpage-title">
                {name(selected)}
              </strong>
              <span
                className={`rm-status ${statusKey(state ?? { phase: "stopped" })}`}
              >
                <span />
                {t(statusKey(state ?? { phase: "stopped" }))}
              </span>
              {(state?.resumeOnLaunch || active) && toggle(selected, true)}
            </div>
          </header>

          {(state?.error || error) && (
            <div
              className="settings-callout rm-error"
              data-tone="error"
              role="alert"
            >
              <CircleAlert size={16} aria-hidden="true" />
              <span>{error || state?.error}</span>
              {state?.error && valid && (
                <button
                  className="rm-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void start()}
                >
                  {t("retryConnection")}
                </button>
              )}
              <button
                type="button"
                className="rm-button"
                onClick={() => setModal("diagnostics")}
              >
                <Settings2 size={15} aria-hidden="true" />
                {t("diagnostics")}
              </button>
            </div>
          )}

          {config && state ? (
            <ol className="settings-card rm-step-flow">
              <li
                className={`rm-step${step1Done ? " done" : ""}`}
                data-remote-step="1"
              >
                <div className="rm-step-rail" aria-hidden="true">
                  <span className="rm-step-num">1</span>
                  <span className="rm-step-line" />
                </div>
                <div className="rm-step-body">
                  <h3 className="rm-step-title">{t("step1Title")}</h3>
                  <div className="rm-step-content">
                    <div className="rm-route-guide">
                      {guideLines.map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                      {(selected === "cloudflare" ||
                        isTailscaleProvider(selected)) && (
                        <div className="rm-external-links">
                          {selected === "cloudflare" ? (
                            <a
                              className="rm-button rm-external"
                              href="https://dash.cloudflare.com/"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("cloudflare")}
                              <ExternalLink size={14} />
                            </a>
                          ) : (
                            <>
                              <a
                                className="rm-button"
                                href="https://login.tailscale.com/admin"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {t("tailscale")}
                                <ExternalLink size={14} />
                              </a>
                              {!state.executables.tailscale && (
                                <a
                                  className="rm-button"
                                  href="https://tailscale.com/download"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t("downloadTailscale")}
                                  <ExternalLink size={14} />
                                </a>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {selected === "cloudflare" && (
                      <div className="rm-route-config">
                        {state.localUrl ||
                        (state.configured && state.config.port) ? (
                          <RemoteCopyField
                            label={t("localRoute")}
                            value={
                              state.localUrl ||
                              `http://127.0.0.1:${config.port}`
                            }
                            onCopy={copy}
                          />
                        ) : (
                          <div>
                            <button
                              className="rm-button"
                              type="button"
                              disabled={busy}
                              onClick={() => void prepareRoute()}
                            >
                              <Network size={16} />
                              {t("generateRoute")}
                            </button>
                          </div>
                        )}
                        <div className="rm-field">
                          <label htmlFor="remote-hostname">
                            {t("hostname")}
                          </label>
                          <input
                            className="showai-input"
                            id="remote-hostname"
                            type="url"
                            value={config.publicUrl}
                            placeholder="https://showai.example.com"
                            onChange={(event) =>
                              change({ publicUrl: event.target.value })
                            }
                          />
                        </div>
                        <div className="rm-field">
                          <label htmlFor="remote-tunnel-token">
                            {t("tunnelToken")}
                          </label>
                          <input
                            className="showai-input"
                            id="remote-tunnel-token"
                            type="password"
                            autoComplete="off"
                            value={token}
                            placeholder={state.tokenSaved ? t("saved") : ""}
                            onChange={(event) => {
                              setTokens((previous) => ({
                                ...previous,
                                [selected]: event.target.value,
                              }));
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="rm-network-fields">
                      {selected === "lan" && (
                        <div className="rm-field rm-address-field">
                          <label htmlFor="remote-bind-address">
                            {t("address")}
                          </label>
                          <div className="rm-input-action">
                            <RemoteSelect
                              id="remote-bind-address"
                              aria-invalid={missingAddress}
                              aria-describedby={missingAddress || !state.addresses.length ? addressErrorId : undefined}
                              value={config.bindAddress ?? ""}
                              disabled={busy}
                              onChange={(event) =>
                                change({ bindAddress: event.target.value })
                              }
                            >
                              <option value="" disabled>
                                {t("noAddress")}
                              </option>
                              {missingAddress && (
                                <option value={config.bindAddress} disabled>
                                  {config.bindAddress}
                                </option>
                              )}
                              {state.addresses.map((address) => (
                                <option
                                  key={address.address}
                                  value={address.address}
                                >
                                  {address.address}
                                </option>
                              ))}
                            </RemoteSelect>
                            <button
                              className="rm-button"
                              type="button"
                              aria-label={t("refresh")}
                              disabled={busy}
                              onClick={() => void run(() => refresh(true))}
                            >
                              <RefreshCw size={16} />
                              {t("refresh")}
                            </button>
                          </div>
                          {(missingAddress || !state.addresses.length) && (
                            <p className="settings-help" id={addressErrorId}>
                              {t(state.addresses.length ? "addressUnavailable" : "recoverAddress")}
                            </p>
                          )}
                        </div>
                      )}
                      {isTailscaleProvider(selected) && (
                        <>
                          <div className="rm-field rm-short-field">
                            <label htmlFor="remote-https-port">
                              {t("httpsPort")}
                            </label>
                            <RemoteSelect
                              id="remote-https-port"
                              value={
                                config.httpsPort ??
                                (selected === "tailscale-private" ? 8443 : 443)
                              }
                              onChange={(event) =>
                                change({
                                  httpsPort: Number(event.target.value),
                                })
                              }
                            >
                              {[443, 8443, 10000].map((port) => (
                                <option key={port} value={port}>
                                  {port}
                                </option>
                              ))}
                            </RemoteSelect>
                          </div>
                          {selected === "tailscale-private" && (
                            <div className="rm-field rm-short-field">
                              <label htmlFor="remote-private-auth">
                                {t("authentication")}
                              </label>
                              <RemoteSelect
                                id="remote-private-auth"
                                value={config.privateAuth ?? "oauth"}
                                onChange={(event) =>
                                  change({
                                    privateAuth: event.target.value as
                                      | "device"
                                      | "oauth",
                                  })
                                }
                              >
                                <option value="device">
                                  {t("sharedDevice")}
                                </option>
                                <option value="oauth">OAuth</option>
                              </RemoteSelect>
                            </div>
                          )}
                        </>
                      )}
                      {(selected === "lan" || selected === "cloudflare") && (
                        <div className="rm-field rm-short-field">
                          <label htmlFor="remote-local-port">{t("port")}</label>
                          <input
                            className="showai-input"
                            id="remote-local-port"
                            type="number"
                            min={1024}
                            max={65535}
                            value={config.port || ""}
                            placeholder={t("auto")}
                            aria-invalid={invalidPort}
                            aria-describedby={
                              invalidPort ? portErrorId : undefined
                            }
                            onChange={(event) =>
                              change({
                                port: Number(event.target.value) || 0,
                              })
                            }
                          />
                          {invalidPort && (
                            <p id={portErrorId} className="studio-form-error">
                              {t("invalidPort")}
                            </p>
                          )}
                        </div>
                      )}
                      {selected !== "lan" && (
                        <div className="rm-field rm-grow-field">
                          <label htmlFor="remote-tool-path">{t("tool")}</label>
                          <div className="rm-input-action">
                            <input
                              className="showai-input"
                              id="remote-tool-path"
                              value={config.executable}
                              placeholder={
                                (isTailscaleProvider(selected)
                                  ? state.executables.tailscale
                                  : state.executables.cloudflare) ||
                                t("notFound")
                              }
                              onChange={(event) =>
                                change({ executable: event.target.value })
                              }
                            />
                            <button
                              type="button"
                              className="rm-button"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const path = await desktop.invoke<
                                    string | null
                                  >("remoteMcp:chooseExecutable", {
                                    provider: selected,
                                  });
                                  if (path) change({ executable: path });
                                })
                              }
                            >
                              <FolderOpen size={16} aria-hidden="true" />
                              {t("chooseTool")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>

              <li
                className={`rm-step${step2Done ? " done" : ""}`}
                data-remote-step="2"
              >
                <div className="rm-step-rail" aria-hidden="true">
                  <span className="rm-step-num">2</span>
                  <span className="rm-step-line" />
                </div>
                <div className="rm-step-body">
                  <h3 className="rm-step-title">{t("step2Title")}</h3>
                  <div
                    className={config.access === "selected" ? "rm-step-content" : "rm-access-fields"}
                  >
                    <div className="rm-field">
                      <label>{t("scope")}</label>
                      <div className="rm-segmented">
                        <button
                          type="button"
                          aria-pressed={config.access !== "selected"}
                          onClick={() => change({ access: "all" })}
                        >
                          <Folder size={15} />
                          {t("all")}
                        </button>
                        <button
                          type="button"
                          aria-pressed={config.access === "selected"}
                          onClick={() => change({ access: "selected" })}
                        >
                          <FolderOpen size={15} />
                          {t("selected")}
                        </button>
                      </div>
                    </div>
                    {config.access !== "selected" ? (
                      <div className="rm-field">
                        <label>{t("operations")}</label>
                        <div className="rm-permission-capabilities">
                          {(
                            [
                              ["read", Eye],
                              ["edit", Pencil],
                              ["create", FilePlus2],
                            ] as const
                          ).map(([key, Icon]) => (
                            <span key={key}>
                              <Icon size={17} />
                              {t(key)}
                              <Check size={13} />
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rm-permission-table">
                        <div className="rm-permission-table-head">
                          <span>{t("project")}</span>
                          <span>{t("access")}</span>
                        </div>
                        {state.projects.map((project) => {
                          const rule = config.projects.find(
                            (item) => item.id === project.id,
                          );
                          const value = rule
                            ? rule.write
                              ? "write"
                              : "read"
                            : "none";
                          return (
                            <div
                              className="rm-permission-project"
                              key={project.id}
                            >
                              <span>
                                <Folder size={16} />
                                {project.name}
                              </span>
                              <div className="rm-permission-picker">
                                {(
                                  [
                                    ["none", X, "none"],
                                    ["read", Eye, "readOnly"],
                                    ["write", Pencil, "editable"],
                                  ] as const
                                ).map(([option, Icon, label]) => (
                                  <button
                                    type="button"
                                    key={option}
                                    aria-pressed={value === option}
                                    aria-label={t("setAccess", {
                                      name: project.name,
                                      access: t(label),
                                    })}
                                    title={t(label)}
                                    onClick={() => access(project.id, option)}
                                  >
                                    <Icon size={15} />
                                    <span>{t(label)}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </li>

              <li
                className={`rm-step${step3Done ? " done" : ""}`}
                data-remote-step="3"
              >
                <div className="rm-step-rail" aria-hidden="true">
                  <span className="rm-step-num">3</span>
                  <span className="rm-step-line" />
                </div>
                <div className="rm-step-body">
                  <div className="rm-step-heading">
                    <h3 className="rm-step-title">{t("step3Title")}</h3>
                    {state.phase === "starting" ? (
                      <div className="rm-starting" role="status">
                        <RefreshCw className="rm-spin" size={20} />
                        <span>{t("starting")}</span>
                        <button
                          type="button"
                          className="rm-button"
                          onClick={() => void stop(selected)}
                        >
                          <X size={16} aria-hidden="true" />
                          {t("cancel")}
                        </button>
                      </div>
                    ) : (
                      <div className="rm-form-actions">
                        <button
                          className="rm-button"
                          type="button"
                          disabled={busy || !valid || !dirty}
                          onClick={() => void save()}
                        >
                          <Save size={15} />
                          {t(active ? "saveReconnect" : "save")}
                        </button>
                        {ready ? (
                          <button
                            className="rm-button rm-danger-action"
                            type="button"
                            disabled={busy}
                            onClick={() => void stop(selected)}
                          >
                            <Power size={15} />
                            {t("stop")}
                          </button>
                        ) : (
                          <button
                            className="rm-button primary"
                            type="button"
                            disabled={busy || !valid}
                            onClick={() => void start()}
                          >
                            <Power size={15} />
                            {t(
                              state.phase === "error" ||
                                (state.reachable === false &&
                                  state.phase === "running")
                                ? "reconnect"
                                : selected !== "lan" &&
                                    !isTailscaleProvider(selected) &&
                                    !(
                                      config.executable ||
                                      state.executables.cloudflare
                                    )
                                  ? "installStart"
                                  : "start",
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {ready && state.url && (
                    <RemoteCopyField
                      label={t("endpoint")}
                      value={state.url}
                      onCopy={copy}
                    />
                  )}
                </div>
              </li>

              <li
                className={`rm-step${step4Done ? " done" : ""}${!ready ? " inactive" : ""}`}
                data-remote-step="4"
              >
                <div className="rm-step-rail" aria-hidden="true">
                  <span className="rm-step-num">4</span>
                </div>
                <div className="rm-step-body">
                  <h3 className="rm-step-title">{t("step4Title")}</h3>
                  <div className="rm-step-content">
                    {ready && state.url ? (
                      <RemoteMcpClientSetup
                        key={selected}
                        state={state}
                        busy={busy}
                        onCopy={copy}
                        onCopyPrompt={copyPrompt}
                        promptCopied={copiedPrompt === state.url}
                        onRefresh={() => refresh()}
                        onExport={() => {
                          setPluginLink("");
                          setModal("plugin");
                        }}
                        onBackToOverview={back}
                      />
                    ) : (
                      <p className="rm-step-placeholder">
                        {t("step4Inactive")}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            </ol>
          ) : (
            <div className="rm-loading" role="status">
              <RefreshCw className="rm-spin" size={20} />
            </div>
          )}
        </>
      )}

      {!selected && error && (
        <div
          role="alert"
          className="settings-callout rm-error"
          data-tone="error"
        >
          <CircleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {modal === "diagnostics" && (
        <Dialog title={t("diagnostics")} onClose={() => setModal(null)}>
          <pre className="rm-diagnostics">
            {[
              ...new Set(
                [
                  state?.error?.trim(),
                  state?.diagnostics?.trim(),
                  error.trim(),
                ].filter(Boolean),
              ),
            ].join("\n\n")}
          </pre>
          <div className="studio-dialog-body">
            <div className="studio-dialog-actions">
              <button
                className="settings-button"
                onClick={() => setModal(null)}
              >
                {tc("done")}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {modal === "plugin" && (
        <Dialog title={t("export")} onClose={() => setModal(null)}>
          <form
            className="rm-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void exportPlugin();
            }}
          >
            <div className="rm-field">
              <label htmlFor="remote-plugin-link">{t("binding")}</label>
              <input
                className="showai-input"
                id="remote-plugin-link"
                value={pluginLink}
                onChange={(event) => setPluginLink(event.target.value)}
                placeholder="https://chatgpt.com/plugins/asdk_app_…"
              />
            </div>
            <div className="rm-form-actions">
              <button
                type="button"
                className="rm-button"
                onClick={() => setModal(null)}
              >
                {tc("cancel")}
              </button>
              <button
                className="rm-button primary"
                disabled={busy || !/asdk_app_[A-Za-z0-9]+/.test(pluginLink)}
                type="submit"
              >
                <Save size={15} />
                {t("bindExport")}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
