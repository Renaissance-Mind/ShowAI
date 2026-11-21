import { useEffect, useState, useRef } from "react";
import { desktop, errorMessage } from "../host/bridge";
import type { AgentDestination } from "../agent-host/remote-protocol";
import type { ConnectorSettings } from "../agent-host/remote-connector";
import { useTranslator } from "../i18n/react";
import common from "../i18n/messages/common";
import messages from "../i18n/messages/agentExecution";
import Dialog from "../ui/Dialog";
import Select from "../ui/Select";
import { NearbyMacs } from "./LanPairing";
import {
  ArrowRight,
  CircleAlert,
  Folder,
  Globe,
  Laptop,
  RefreshCw,
  Tablet,
} from "../ui/icons";

export const remoteExecution = () =>
  document.documentElement.dataset.native === "ios";

export function AgentExecutionPicker({
  projectId,
  onChange,
  disabled = false,
}: {
  projectId?: string | null;
  onChange?: (changed?: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslator(messages);
  const [context, setContext] = useState<{
    connections: { id: string; name: string }[];
    connectionId: string;
    destinationId: string;
    destinations: AgentDestination[];
    error?: string;
  } | null>(null);
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const loadGeneration = useRef(0),
    selectionGeneration = useRef(0);
  const load = async (refresh = true) => {
    const generation = ++loadGeneration.current;
    try {
      for (const cached of refresh ? [true, false] : [true]) {
        const next = await desktop.invoke<NonNullable<typeof context>>(
          "agent:execution",
          { projectId, cached, refresh: !cached },
        );
        if (generation === loadGeneration.current) {
          setContext(next);
          setError(next.error ?? "");
        } else return;
      }
    } catch (reason) {
      if (generation === loadGeneration.current) setError(errorMessage(reason));
    }
  };
  useEffect(() => {
    if (!remoteExecution()) return;
    void load();
    const selected = () => void load(false);
    window.addEventListener("showai-agent-execution-change", selected);
    return () => {
      loadGeneration.current++;
      selectionGeneration.current++;
      window.removeEventListener("showai-agent-execution-change", selected);
    };
  }, [projectId]);
  if (!remoteExecution()) return null;
  const change = async (value: Record<string, string>, propagate = false) => {
    const generation = ++selectionGeneration.current;
    loadGeneration.current++;
    setSelecting(true);
    setError("");
    try {
      const selected = await desktop.invoke<NonNullable<typeof context>>(
        "agent:selectExecution",
        { projectId, ...value },
      );
      if (generation !== selectionGeneration.current) return;
      setContext(selected);
      onChange?.(true);
      window.dispatchEvent(new Event("showai-agent-execution-change"));
    } catch (reason) {
      if (generation === selectionGeneration.current)
        setError(errorMessage(reason));
      if (propagate) throw reason;
    } finally {
      if (generation === selectionGeneration.current) setSelecting(false);
    }
  };
  return (
    <div className="agent-execution-picker">
      <label className="agent-runtime-choice">
        <span>{t("runAgentOn")}</span>
        <div className="agent-runtime-select">
          {context?.destinationId && context.destinationId !== "cloud" ? (
            <Laptop size={17} />
          ) : (
            <Globe size={17} />
          )}
          <Select
            aria-label={t("runAgentOn")}
            disabled={disabled || selecting || !context}
            value={context?.destinationId ?? "cloud"}
            onChange={(e) => void change({ destinationId: e.target.value })}
          >
            {(
              context?.destinations ?? [
                {
                  id: "cloud",
                  name: "ShowAI Cloud",
                  kind: "cloud",
                  online: false,
                },
              ]
            )
              .filter((d) => d.kind !== "cloud" || !!context?.connectionId)
              .map((d) => (
                <option key={d.id} value={d.id} disabled={!d.online}>
                  {d.name}
                  {!d.online
                    ? d.kind === "cloud"
                      ? t("unavailable")
                      : t("offline")
                    : ""}
                </option>
              ))}
          </Select>
        </div>
      </label>
      <button
        type="button"
        className="settings-button agent-connect-mac"
        disabled={disabled || selecting}
        onClick={() => setPairing(true)}
      >
        <Laptop size={16} />
        {selecting ? t("connecting") : t("pairANearbyMac")}
      </button>
      {pairing && (
        <NearbyMacs
          onClose={() => setPairing(false)}
          onPaired={async (id) => {
            await change({ destinationId: id }, true);
            setPairing(false);
          }}
        />
      )}
      {error && (
        <p role="alert" className="agent-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function RemoteDeviceSettings({
  onAccounts,
}: {
  onAccounts?: () => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const [state, setState] = useState<{
    settings: ConnectorSettings;
    online: boolean;
    error: string;
    pendingClients: { id: string; name: string; code?: string }[];
    lan?: {
      online: boolean;
      error: string;
      trusted: { id: string; name: string }[];
    };
    connections: { id: string; name: string }[];
    projects: { id: string; name?: string; connectionId: string }[];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [crossNetworkOpen, setCrossNetworkOpen] = useState(false);
  const refresh = (preserveDraft = false) =>
    desktop
      .invoke<NonNullable<typeof state>>("agent:remoteDevice")
      .then((next) => {
        setState((current) =>
          preserveDraft && current
            ? {
                ...next,
                settings: {
                  ...current.settings,
                  trustedClients: next.settings.trustedClients,
                },
              }
            : next,
        );
        setError("");
      })
      .catch((reason) => setError(errorMessage(reason)));
  useEffect(() => {
    if (remoteExecution()) return;
    void refresh();
    const timer = setInterval(() => {
      void desktop
        .invoke<NonNullable<typeof state>>("agent:remoteDevice")
        .then((next) =>
          setState((current) =>
            current
              ? {
                  ...current,
                  online: next.online,
                  error: next.error,
                  pendingClients: next.pendingClients,
                  lan: next.lan,
                }
              : next,
          ),
        )
        .catch((reason) => setError(errorMessage(reason)));
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  if (remoteExecution()) return null;
  if (!state)
    return (
      <section
        id="agent-device-settings"
        className="settings-group agent-device-settings"
        aria-labelledby="agent-device-heading"
      >
        <h2 id="agent-device-heading">{t("useThisComputerFromIPad")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              {error ? (
                <p role="alert" className="agent-error">
                  {error}
                </p>
              ) : (
                <p role="status">{t("readingDeviceConnection")}</p>
              )}
            </div>
            <button
              type="button"
              className="settings-button"
              onClick={() => void refresh()}
            >
              {t("refresh")}
            </button>
          </div>
        </div>
      </section>
    );
  const change = (value: Partial<ConnectorSettings>) =>
    setState({ ...state, settings: { ...state.settings, ...value } });
  const save = async (settings = state.settings) => {
    setBusy(true);
    setError("");
    try {
      await desktop.invoke("agent:shareDevice", { settings });
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const crossNetworkPending = state.pendingClients.filter(
    (client) => !client.id.startsWith("lan:"),
  );
  const trustedDevices = [
    ...(state.settings.trustedClients ?? []),
    ...(state.lan?.trusted ?? []),
  ];
  const selectedConnection = state.connections.find(
    (c) => c.id === state.settings.connectionId,
  );
  return (
    <>
      <section
        id="agent-device-settings"
        className="settings-group agent-device-settings"
        aria-labelledby="agent-device-heading"
      >
        <h2 id="agent-device-heading">{t("useThisComputerFromIPad")}</h2>
        <div className="settings-card">
          <div className="settings-card-section">
            <div className="settings-row settings-row-compact">
              <div className="settings-row-text">
                <h3>
                  {t("lanDiscoveryTitle")}
                  <span
                    className="settings-badge"
                    data-tone={state.lan?.online ? "ok" : undefined}
                    role="status"
                  >
                    {state.lan?.online
                      ? t("discoverableOnLAN")
                      : t("lanOffline")}
                  </span>
                </h3>
                <p>{t("nearbyHelp")}</p>
              </div>
            </div>
            {state.lan?.error && (
              <div className="settings-callout" data-tone="error" role="alert">
                <CircleAlert size={15} aria-hidden="true" />
                <span>{state.lan.error}</span>
              </div>
            )}
          </div>

          <div className="settings-card-section">
            <div className="settings-row settings-row-compact">
              <div className="settings-row-text">
                <h3>
                  {t("acrossNetworks")}
                  <span
                    className="settings-badge"
                    data-tone={
                      state.online
                        ? "ok"
                        : state.settings.enabled
                          ? "warn"
                          : undefined
                    }
                    role="status"
                  >
                    {t(
                      state.online
                        ? "connected"
                        : state.settings.enabled
                          ? "reconnecting"
                          : "notConfigured",
                    )}
                  </span>
                </h3>
                <p>
                  {state.settings.enabled && selectedConnection
                    ? t("crossNetworkConnectedSummary", {
                        account: selectedConnection.name,
                        count: state.settings.projectIds.length,
                      })
                    : t(
                        "connectThisComputerToShowAICloudOverWSSDevicesSignedIntoTheSameServerAccountCanRunTasksHereKeepShowAIRunningAndTheComputerAwake",
                      )}
                </p>
              </div>
              <button
                type="button"
                className="settings-button"
                onClick={() => {
                  setError("");
                  setCrossNetworkOpen(true);
                }}
              >
                {t("configureCrossNetwork")}
              </button>
            </div>
            {(error || state.error) && !crossNetworkOpen && (
              <div className="settings-callout" data-tone="error" role="alert">
                <CircleAlert size={15} aria-hidden="true" />
                <span>{error || state.error}</span>
              </div>
            )}
          </div>

          {crossNetworkPending.length > 0 && (
            <div
              className="settings-card-section"
              aria-label={t("pendingDevices")}
            >
              <h3 className="settings-section-heading">{t("pendingDevices")}</h3>
              {crossNetworkPending.map((client) => (
                <div className="settings-row settings-row-compact" key={client.id}>
                  <span className="agent-device-client-name">
                    <Laptop size={15} aria-hidden="true" />
                    {client.name} · <code>{client.code ?? client.id.slice(-6)}</code>
                  </span>
                  <div className="library-space-actions">
                    <button
                      type="button"
                      className="settings-button settings-primary-button"
                      onClick={() =>
                        void desktop
                          .invoke("agent:approveRemoteClient", {
                            id: client.id,
                            approve: true,
                          })
                          .then(() => refresh(true))
                          .catch((reason) => setError(errorMessage(reason)))
                      }
                    >
                      {t("allowDevice")}
                    </button>
                    <button
                      type="button"
                      className="settings-button"
                      onClick={() =>
                        void desktop
                          .invoke("agent:approveRemoteClient", {
                            id: client.id,
                            approve: false,
                          })
                          .then(() => refresh(true))
                          .catch((reason) => setError(errorMessage(reason)))
                      }
                    >
                      {t("reject")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {trustedDevices.length > 0 && (
            <div
              className="settings-card-section"
              aria-label={t("trustedDevices")}
            >
              <div className="settings-row-text">
                <h3>{t("trustedDevices")}</h3>
                <p>{t("trustedDevicesHelp")}</p>
              </div>
              <div className="agent-trusted-list">
                {trustedDevices.map((client) => (
                  <div
                    className="settings-row settings-row-compact"
                    key={client.id}
                  >
                    <span className="agent-device-client-name">
                      <Laptop size={15} aria-hidden="true" />
                      {client.name} · <code>{client.id.slice(-6)}</code>
                    </span>
                    <button
                      type="button"
                      className="settings-button settings-danger-button"
                      onClick={() =>
                        void desktop
                          .invoke("agent:approveRemoteClient", {
                            id: client.id,
                            approve: false,
                          })
                          .then(() => refresh(true))
                          .catch((reason) => setError(errorMessage(reason)))
                      }
                    >
                      {t("revokeDevice")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {crossNetworkOpen &&
        (() => {
          const candidateProjects = state.projects.filter(
            (project) => project.connectionId === state.settings.connectionId,
          );
          const allowedSet = new Set(state.settings.projectIds);
          const selectedCount = candidateProjects.filter((project) =>
            allowedSet.has(project.id),
          ).length;
          const allSelected =
            candidateProjects.length > 0 &&
            selectedCount === candidateProjects.length;
          const toggleProject = (projectId: string, checked: boolean) => {
            change({
              projectIds: checked
                ? [...new Set([...state.settings.projectIds, projectId])]
                : state.settings.projectIds.filter((id) => id !== projectId),
            });
          };
          return (
            <Dialog
              title={t("acrossNetworks")}
              wide
              onClose={() => {
                if (!busy) setCrossNetworkOpen(false);
              }}
            >
              <div className="studio-dialog-body agent-cross-dialog">
                <div className="agent-cross-banner">
                  <div className="agent-cross-flow" aria-hidden="true">
                    <span className="agent-cross-node">
                      <Tablet size={15} />
                      <span>iPad</span>
                    </span>
                    <span className="agent-cross-edge">
                      <span className="agent-cross-edge-pill">
                        {t("crossTopologyEdge")}
                      </span>
                      <ArrowRight size={13} />
                    </span>
                    <span className="agent-cross-node is-host">
                      <Laptop size={15} />
                      <span>{state.settings.name.trim() || "Mac"}</span>
                    </span>
                  </div>
                  <div className="agent-cross-banner-status">
                    <span
                      className="settings-badge"
                      data-tone={
                        state.online
                          ? "ok"
                          : state.settings.enabled
                            ? "warn"
                            : undefined
                      }
                      role="status"
                    >
                      {t(
                        state.online
                          ? "connected"
                          : state.settings.enabled
                            ? "reconnecting"
                            : "notEnabled",
                      )}
                    </span>
                    {state.settings.enabled && (
                      <button
                        type="button"
                        className="settings-icon-button"
                        aria-label={t("refreshConnectionStatus")}
                        title={t("refreshConnectionStatus")}
                        disabled={busy}
                        onClick={() => void refresh(true)}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="agent-cross-grid">
                  <div className="agent-cross-section">
                    <div className="agent-cross-section-head">
                      <label htmlFor="agent-device-name">{t("deviceName")}</label>
                    </div>
                    <input
                      id="agent-device-name"
                      className="showai-input"
                      value={state.settings.name}
                      onChange={(e) => change({ name: e.target.value })}
                    />
                    <p className="agent-cross-hint">{t("deviceNameHint")}</p>
                  </div>

                  <div className="agent-cross-section">
                    <div className="agent-cross-section-head">
                      <label htmlFor="agent-device-account">
                        {t("serverAccount")}
                      </label>
                    </div>
                    {state.connections.length === 0 ? (
                      <div className="agent-cross-empty-account">
                        <div className="agent-cross-empty-account-text">
                          <strong>{t("noAccountTitle")}</strong>
                          <p>{t("noAccountHint")}</p>
                        </div>
                        {onAccounts && (
                          <button
                            type="button"
                            className="settings-button"
                            onClick={() => {
                              setCrossNetworkOpen(false);
                              onAccounts();
                            }}
                          >
                            {t("openAccounts")}
                          </button>
                        )}
                      </div>
                    ) : (
                      <Select
                        id="agent-device-account"
                        value={state.settings.connectionId}
                        onChange={(e) =>
                          change({
                            connectionId: e.target.value,
                            projectIds: [],
                          })
                        }
                      >
                        <option value="">{t("chooseAccount")}</option>
                        {state.connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </div>

                <div className="agent-cross-section">
                  <div className="agent-cross-section-head">
                    <div className="agent-cross-section-title">
                      <span>{t("allowedProjects")}</span>
                      {candidateProjects.length > 0 && (
                        <span className="settings-badge">
                          {t("selectedProjectsCount", {
                            selected: selectedCount,
                            total: candidateProjects.length,
                          })}
                        </span>
                      )}
                    </div>
                    {candidateProjects.length > 0 && (
                      <button
                        type="button"
                        className="settings-button"
                        disabled={busy}
                        onClick={() =>
                          change({
                            projectIds: allSelected
                              ? []
                              : candidateProjects.map((project) => project.id),
                          })
                        }
                      >
                        {t(
                          allSelected
                            ? "clearAllProjects"
                            : "selectAllProjects",
                        )}
                      </button>
                    )}
                  </div>

                  {candidateProjects.length === 0 ? (
                    <div className="agent-project-checklist-empty">
                      <p>
                        {state.settings.connectionId
                          ? t("syncTheRequiredProjectsOnThisComputerFirst")
                          : t("chooseAnAccountToShowSynchronizedProjects")}
                      </p>
                    </div>
                  ) : (
                    <div
                      className="agent-project-checklist"
                      role="group"
                      aria-label={t("allowedProjects")}
                    >
                      {candidateProjects.map((project) => {
                        const checked = allowedSet.has(project.id);
                        return (
                          <label
                            key={project.id}
                            className={`agent-project-check-row${checked ? " is-checked" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy}
                              onChange={(event) =>
                                toggleProject(project.id, event.target.checked)
                              }
                            />
                            <Folder size={14} aria-hidden="true" />
                            <span>{project.name ?? project.id}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {(error || state.error) && (
                  <div
                    className="settings-callout"
                    data-tone="error"
                    role="alert"
                  >
                    <CircleAlert size={15} aria-hidden="true" />
                    <span>{error || state.error}</span>
                  </div>
                )}

                <div className="studio-dialog-actions agent-cross-footer">
                  <div className="agent-cross-footer-left">
                    {state.settings.enabled && (
                      <button
                        type="button"
                        className="settings-button settings-danger-button"
                        disabled={busy}
                        onClick={() =>
                          void save({ ...state.settings, enabled: false }).then(
                            () => setCrossNetworkOpen(false),
                          )
                        }
                      >
                        {t("disableCrossNetwork")}
                      </button>
                    )}
                  </div>
                  <div className="agent-cross-footer-right">
                    <button
                      type="button"
                      className="settings-button"
                      disabled={busy}
                      onClick={() => setCrossNetworkOpen(false)}
                    >
                      {tc("cancel")}
                    </button>
                    <button
                      type="button"
                      className="settings-button settings-primary-button"
                      disabled={
                        busy ||
                        !state.settings.connectionId ||
                        !state.settings.projectIds.length
                      }
                      onClick={() =>
                        void save({ ...state.settings, enabled: true }).then(
                          () => setCrossNetworkOpen(false),
                        )
                      }
                    >
                      {t(
                        state.settings.enabled
                          ? "saveCrossNetwork"
                          : "enableCrossNetwork",
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </Dialog>
          );
        })()}
    </>
  );
}
