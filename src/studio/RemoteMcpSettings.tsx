import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Check,
  ExternalLink,
  Folder,
  FolderOpen,
  Eye,
  Pencil,
  FilePlus2,
  Laptop,
  Network,
  Power,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  X,
} from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteConnections";
import {
  remoteMcpProviders,
  type RemoteMcpConfig,
  type RemoteMcpProvider,
  type RemoteMcpStatus,
  type RemoteMcpConnectionSummary,
} from "../remote-mcp/types";
import { isTailscaleProvider } from "../remote-mcp/client-setup";
import { desktop, errorMessage } from "../host/bridge";
import Dialog from "../ui/Dialog";
import RemoteMcpClientSetup from "./RemoteMcpClientSetup";
import {
  RemoteBrand,
  RemoteCopyField,
  RemoteIconButton,
  RemoteSelect,
  remoteProviderKeys,
} from "./RemoteConnectionControls";
import "./remote-mcp-settings.css";

type Tab = "network" | "permissions" | "clients";
export default function RemoteMcpSettings() {
  const t = useTranslator(messages);
  const [selected, setSelected] = useState<RemoteMcpProvider>(),
    [tab, setTab] = useState<Tab>("network"),
    [state, setState] = useState<RemoteMcpStatus>(),
    [connections, setConnections] = useState<RemoteMcpConnectionSummary[]>([]),
    [drafts, setDrafts] = useState<
      Partial<Record<RemoteMcpProvider, RemoteMcpConfig>>
    >({}),
    [tokens, setTokens] = useState<Partial<Record<RemoteMcpProvider, string>>>(
      {},
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [modal, setModal] = useState<"diagnostics" | "plugin" | null>(null),
    [pluginLink, setPluginLink] = useState(""),
    [exported, setExported] = useState("");
  const current = useRef(selected),
    opening = useRef<RemoteMcpProvider | undefined>(undefined);
  current.current = selected;
  const previousConfigs = useRef<
    Partial<Record<RemoteMcpProvider, RemoteMcpConfig>>
  >({});
  const name = (provider: RemoteMcpProvider) => t(remoteProviderKeys[provider]);
  const active = state?.phase === "running" || state?.phase === "starting",
    ready = state?.phase === "running" && state.reachable === true;
  const config = selected ? drafts[selected] : undefined,
    token = selected ? (tokens[selected] ?? "") : "";
  const dirty =
    !!config &&
    !!state &&
    (JSON.stringify(config) !== JSON.stringify(state.config) || !!token);
  const valid =
    !!config &&
    (config.provider !== "lan" ||
      !!state?.addresses.some((item) => item.address === config.bindAddress)) &&
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
          reachable: value.reachable,
        },
      ],
    );
    if (!current.current || value.config.provider === current.current)
      setState(value);
    if (current.current && value.config.provider === current.current) {
      const provider = current.current;
      if (value.phase !== "running" || !value.reachable)
        setTab((tab) => (tab === "clients" ? "network" : tab));
      const previousConfig = previousConfigs.current[provider];
      previousConfigs.current[provider] = value.config;
      setDrafts((previous) =>
        previous[provider]
          ? {
              ...previous,
              [provider]: {
                ...previous[provider]!,
                port:
                  !previousConfig ||
                  previous[provider]!.port === previousConfig.port
                    ? value.config.port
                    : previous[provider]!.port,
                httpsPort:
                  !previousConfig ||
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
        setTab("clients");
      }
    }
  }
  async function refresh(refresh = false) {
    const value = await desktop.invoke<RemoteMcpStatus>("remoteMcp:status", {
      provider: current.current,
      refresh,
    });
    apply(value);
  }
  useEffect(() => {
    let mounted = true,
      reading = false;
    const read = async (refresh = false) => {
      if (reading) return;
      reading = true;
      try {
        let value = await desktop.invoke<RemoteMcpStatus>("remoteMcp:status", {
          provider: selected,
          refresh,
        });
        if (
          mounted &&
          refresh &&
          selected === "cloudflare" &&
          value.phase === "stopped" &&
          !value.config.port
        ) {
          await desktop.invoke("remoteMcp:prepare", { config: value.config });
          value = await desktop.invoke<RemoteMcpStatus>("remoteMcp:stop", {
            provider: selected,
          });
        }
        if (mounted) apply(value);
      } catch (error) {
        if (mounted) setError(errorMessage(error));
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
      setSaved(false);
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
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function choose(provider: RemoteMcpProvider) {
    opening.current = undefined;
    setSelected(provider);
    setTab("network");
    setState(undefined);
    setError("");
    setSaved(false);
    setExported("");
  }
  function back() {
    opening.current = undefined;
    setSelected(undefined);
    setTab("network");
    setError("");
  }
  const copy = (text: string) =>
    desktop.invoke<void>("clipboard:write", { text });
  async function start() {
    if (!selected || !config) return;
    const provider = selected;
    await run(async () => {
      if (active) await desktop.invoke("remoteMcp:stop", { provider });
      let next = { ...config };
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
    if (!selected || !config) return;
    const provider = selected,
      enabled = !!state?.resumeOnLaunch;
    await run(async () => {
      if (active || enabled)
        await desktop.invoke("remoteMcp:stop", { provider });
      let value = await desktop.invoke<RemoteMcpStatus>("remoteMcp:configure", {
        config,
        token,
      });
      if (enabled)
        value = await desktop.invoke<RemoteMcpStatus>("remoteMcp:start", {
          config: value.config,
        });
      setDrafts((previous) => ({ ...previous, [provider]: value.config }));
      setTokens((previous) => ({ ...previous, [provider]: "" }));
      apply(value);
      setSaved(true);
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
  async function exportPlugin() {
    if (!selected) return;
    await run(async () => {
      const value = await desktop.invoke<{ path: string } | null>(
        "remoteMcp:exportPlugin",
        { provider: selected, connection: pluginLink },
      );
      if (value) {
        setExported(value.path);
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
  return (
    <section
      className="remote-settings"
      data-remote-view={selected ? "detail" : "overview"}
      data-remote-provider={selected}
      data-remote-phase={state?.phase}
      data-remote-tab={tab}
    >
      {!selected ? (
        <>
          <header className="settings-heading">
            <h2>{t("title")}</h2>
          </header>
          {[remoteMcpProviders.slice(0, 2), remoteMcpProviders.slice(2)].map(
            (providers, index) => (
              <section className="rm-route-group" key={index}>
                <h3>{t(index ? "publicGroup" : "localGroup")}</h3>
                <div className="rm-route-list">
                  {providers.map((provider) => {
                    const value = connections.find(
                        (value) => value.provider === provider,
                      ),
                      label = statusKey(
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
                            {name(provider)}
                            <span className={`rm-status ${label}`}>
                              <span />
                              {t(label)}
                            </span>
                          </span>
                          {value?.url && <code>{value.url}</code>}
                        </div>
                        {toggle(provider, !!value?.enabled)}
                        <RemoteIconButton
                          label={t("configure", { name: name(provider) })}
                          onClick={() => choose(provider)}
                        >
                          <ChevronRight size={16} />
                        </RemoteIconButton>
                      </div>
                    );
                  })}
                </div>
              </section>
            ),
          )}
        </>
      ) : (
        <>
          <header className="rm-page-header">
            <RemoteIconButton label={t("back")} onClick={back}>
              <ChevronLeft size={19} />
            </RemoteIconButton>
            <h2>{name(selected)}</h2>
            <span
              className={`rm-status ${statusKey(state ?? { phase: "stopped" })}`}
            >
              <span />
              {t(statusKey(state ?? { phase: "stopped" }))}
            </span>
            {toggle(
              selected,
              !!state?.resumeOnLaunch ||
                state?.phase === "starting" ||
                state?.phase === "running",
            )}
          </header>
          <nav className="rm-tabs" role="tablist" aria-label={name(selected)}>
            {(
              [
                ["network", Network],
                ["permissions", ShieldCheck],
                ["clients", Laptop],
              ] as const
            ).map(([value, Icon]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                disabled={value === "clients" && !ready}
                onClick={() => setTab(value)}
              >
                <Icon size={16} />
                {t(value)}
              </button>
            ))}
          </nav>
          {config && state ? (
            <div className="rm-detail-body">
              <div
                role="tabpanel"
                aria-label={t("network")}
                className="rm-tab-panel"
                hidden={tab !== "network"}
              >
                {state.phase === "starting" ? (
                  <div className="rm-starting" role="status">
                    <RefreshCw className="rm-spin" size={22} />
                    <span>{t("starting")}</span>
                    <RemoteIconButton
                      label={t("cancel")}
                      onClick={() => void stop(selected)}
                    >
                      <X size={16} />
                    </RemoteIconButton>
                  </div>
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void start();
                    }}
                  >
                    {(state.error || error) && (
                      <div className="rm-error" role="alert">
                        <CircleAlert size={17} />
                        <span>{state.error || error}</span>
                        <RemoteIconButton
                          label={t("diagnostics")}
                          onClick={() => setModal("diagnostics")}
                        >
                          <Settings2 size={16} />
                        </RemoteIconButton>
                      </div>
                    )}
                    {selected === "lan" ? (
                      <div className="rm-field">
                        <label htmlFor="remote-bind-address">
                          {t("address")}
                        </label>
                        <div className="rm-input-action">
                          <RemoteSelect
                            id="remote-bind-address"
                            value={config.bindAddress ?? ""}
                            disabled={busy}
                            onChange={(event) =>
                              change({ bindAddress: event.target.value })
                            }
                          >
                            <option value="" disabled>
                              {t("noAddress")}
                            </option>
                            {config.bindAddress &&
                              !state.addresses.some(
                                (address) =>
                                  address.address === config.bindAddress,
                              ) && (
                                <option value={config.bindAddress} disabled>
                                  {config.bindAddress} ·{" "}
                                  {t("addressUnavailable")}
                                </option>
                              )}
                            {state.addresses.map((address) => (
                              <option
                                key={address.address}
                                value={address.address}
                              >
                                {address.address} · {address.name}
                              </option>
                            ))}
                          </RemoteSelect>
                          <RemoteIconButton
                            label={t("refresh")}
                            disabled={busy}
                            onClick={() => void run(() => refresh(true))}
                          >
                            <RefreshCw size={16} />
                          </RemoteIconButton>
                        </div>
                      </div>
                    ) : (
                      <>
                        {selected === "cloudflare" && (
                          <div className="rm-route-config">
                            <div className="rm-field">
                              <label htmlFor="remote-hostname">
                                {t("hostname")}
                              </label>
                              <input
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
                                id="remote-tunnel-token"
                                type="password"
                                autoComplete="off"
                                value={token}
                                placeholder={state.tokenSaved ? t("saved") : ""}
                                onChange={(event) =>
                                  setTokens((previous) => ({
                                    ...previous,
                                    [selected]: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            {state.localUrl || config.port ? (
                              <RemoteCopyField
                                label={t("localRoute")}
                                value={
                                  state.localUrl ||
                                  `http://127.0.0.1:${config.port}`
                                }
                                onCopy={copy}
                              />
                            ) : (
                              <button
                                className="rm-button"
                                type="button"
                                disabled={busy}
                                onClick={() => void prepareRoute()}
                              >
                                <Network size={16} />
                                {t("localRoute")}
                              </button>
                            )}
                            <a
                              className="rm-button rm-external"
                              href="https://dash.cloudflare.com/"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("cloudflare")}
                              <ExternalLink size={14} />
                            </a>
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
                                  (selected === "tailscale-private"
                                    ? 8443
                                    : 443)
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
                            <div className="rm-external-links">
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
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {ready && state.url && (
                      <RemoteCopyField
                        label={t("endpoint")}
                        value={state.url}
                        onCopy={copy}
                      />
                    )}
                    <details className="rm-advanced">
                      <summary>
                        <Settings2 size={14} />
                        {t("advanced")}
                      </summary>
                      <div className="rm-inset">
                        {(selected === "lan" || selected === "cloudflare") && (
                          <div className="rm-field rm-short-field">
                            <label htmlFor="remote-local-port">
                              {t("port")}
                            </label>
                            <input
                              id="remote-local-port"
                              type="number"
                              min={1024}
                              max={65535}
                              value={config.port || ""}
                              placeholder={t("auto")}
                              onChange={(event) =>
                                change({
                                  port: Number(event.target.value) || 0,
                                })
                              }
                            />
                          </div>
                        )}
                        {selected !== "lan" && (
                          <div className="rm-field">
                            <label htmlFor="remote-tool-path">
                              {t("tool")}
                            </label>
                            <div className="rm-input-action">
                              <input
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
                              <RemoteIconButton
                                label={t("chooseTool")}
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
                                <FolderOpen size={16} />
                              </RemoteIconButton>
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                    <footer className="rm-form-actions">
                      <button
                        className="rm-button"
                        type="button"
                        disabled={busy || !valid || !dirty}
                        onClick={() => void save()}
                      >
                        {saved ? <Check size={15} /> : <Save size={15} />}
                        {t(active ? "saveReconnect" : "save")}
                      </button>
                      {ready ? (
                        <button
                          className="rm-button primary"
                          type="button"
                          onClick={() => setTab("clients")}
                        >
                          <Laptop size={15} />
                          {t("addClient")}
                          <ChevronRight size={15} />
                        </button>
                      ) : (
                        <button
                          className="rm-button primary"
                          type="submit"
                          disabled={busy || !valid}
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
                    </footer>
                  </form>
                )}
              </div>
              <div
                role="tabpanel"
                aria-label={t("permissions")}
                className="rm-tab-panel"
                hidden={tab !== "permissions"}
              >
                <div className="rm-field">
                  <label>{t("scope")}</label>
                  <div className="rm-segmented">
                    <button
                      aria-pressed={config.access !== "selected"}
                      onClick={() => change({ access: "all" })}
                    >
                      <Folder size={15} />
                      {t("all")}
                    </button>
                    <button
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
                          (rule) => rule.id === project.id,
                        ),
                        value = rule ? (rule.write ? "write" : "read") : "none";
                      return (
                        <div className="rm-permission-project" key={project.id}>
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
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <footer className="rm-form-actions">
                  <button
                    className="rm-button primary"
                    disabled={
                      busy ||
                      !dirty ||
                      (config.access === "selected" && !config.projects.length)
                    }
                    onClick={() => void save()}
                  >
                    <Save size={15} />
                    {t(active ? "saveReconnect" : "save")}
                  </button>
                </footer>
              </div>
              <div
                role="tabpanel"
                aria-label={t("clients")}
                className="rm-tab-panel"
                hidden={tab !== "clients"}
              >
                {ready && state.url && (
                  <RemoteMcpClientSetup
                    key={selected}
                    state={state}
                    busy={busy}
                    onCopy={copy}
                    onRefresh={() => refresh()}
                    onExport={() => {
                      setPluginLink("");
                      setModal("plugin");
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="rm-loading" role="status">
              <RefreshCw className="rm-spin" size={20} />
            </div>
          )}
        </>
      )}
      {!selected && error && (
        <div role="alert" className="rm-error">
          <CircleAlert size={16} />
          {error}
        </div>
      )}
      {modal === "diagnostics" && (
        <Dialog title={t("diagnostics")} onClose={() => setModal(null)}>
          <pre className="rm-diagnostics">
            {[state?.error, state?.diagnostics, error]
              .filter(Boolean)
              .join("\n\n")}
          </pre>
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
                id="remote-plugin-link"
                value={pluginLink}
                onChange={(event) => setPluginLink(event.target.value)}
                placeholder="https://chatgpt.com/plugins/asdk_app_…"
              />
            </div>
            <div className="rm-form-actions">
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
      {exported && (
        <div role="status" className="rm-exported">
          <Check size={15} />
          {t("exported")}
          <code>{exported}</code>
        </div>
      )}
    </section>
  );
}
