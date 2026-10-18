import { useEffect, useState, useRef } from "react";
import { desktop, errorMessage } from "./bridge";
import type { AgentDestination } from "../agent-host/remote-protocol";
import type { ConnectorSettings } from "../agent-host/remote-connector";
import { translator } from "../i18n";
import messages from "../i18n/messages/agentExecution";

import { NearbyMacs } from "./LanPairing";
import { Laptop, Globe } from "../ui/icons";
const t = translator(messages);
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
      // Saved selection and authenticated LAN state do not depend on the cloud.
      // Render them before refreshing the remote device inventory.
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
          <select
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
          </select>
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
export function RemoteDeviceSettings() {
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
  const refresh = () =>
    desktop
      .invoke<NonNullable<typeof state>>("agent:remoteDevice")
      .then(setState)
      .catch((reason) => setError(reason.message));
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
        .catch((reason) => setError(reason.message));
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  if (remoteExecution()) return null;
  if (!state)
    return (
      <section className="settings-group agent-device-settings">
        <h2>{t("useThisComputerFromIPad")}</h2>
        {error ? (
          <p role="alert" className="agent-error">
            {error}
          </p>
        ) : (
          <p role="status">{t("readingDeviceConnection")}</p>
        )}
        <button className="settings-button" onClick={() => void refresh()}>
          {t("refresh")}
        </button>
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
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-group agent-device-settings">
      <h2>{t("useThisComputerFromIPad")}</h2>
      <p className="settings-help">{t("nearbyHelp")}</p>
      <label className="settings-row agent-nearby-toggle">
        <input
          type="checkbox"
          disabled={busy}
          checked={state.settings.nearbyEnabled ?? state.settings.enabled}
          onChange={(e) =>
            void save({ ...state.settings, nearbyEnabled: e.target.checked })
          }
        />
        {t("allowNearbyConnection")}
        <span className="settings-help" role="status">
          {state.lan?.online ? t("discoverableOnLAN") : t("nearbyOff")}
        </span>
      </label>
      <details className="agent-remote-advanced">
        <summary>{t("acrossNetworks")}</summary>
        <p className="settings-help">
          {t(
            "connectThisComputerToShowAICloudOverWSSDevicesSignedIntoTheSameServerAccountCanRunTasksHereKeepShowAIRunningAndTheComputerAwake",
          )}
        </p>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={state.settings.enabled}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          {t("allowRemoteExecution")}
        </label>
        <label className="settings-row">
          {t("deviceName")}
          <input
            value={state.settings.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <label className="settings-row">
          {t("serverAccount")}
          <select
            value={state.settings.connectionId}
            onChange={(e) =>
              change({ connectionId: e.target.value, projectIds: [] })
            }
          >
            <option value="">{t("chooseAccount")}</option>
            {state.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{t("allowedProjects")}</legend>
          {!state.projects.some(
            (p) => p.connectionId === state.settings.connectionId,
          ) && (
            <p className="settings-help">
              {state.settings.connectionId
                ? t("syncTheRequiredProjectsOnThisComputerFirst")
                : t("chooseAnAccountToShowSynchronizedProjects")}
            </p>
          )}
          {state.projects
            .filter((p) => p.connectionId === state.settings.connectionId)
            .map((p) => (
              <label className="settings-row" key={p.id}>
                <input
                  type="checkbox"
                  checked={state.settings.projectIds.includes(p.id)}
                  onChange={(e) =>
                    change({
                      projectIds: e.target.checked
                        ? [...state.settings.projectIds, p.id]
                        : state.settings.projectIds.filter((id) => id !== p.id),
                    })
                  }
                />
                {p.name ?? p.id}
              </label>
            ))}
        </fieldset>
        <div className="settings-row">
          <span role="status">
            {state.online ? t("connected") : t("disconnected")}
          </span>
          <button
            type="button"
            className="settings-button"
            disabled={busy}
            onClick={() => void save()}
          >
            {t("save")}
          </button>
        </div>
      </details>
      {state.pendingClients
        .filter((client) => !client.id.startsWith("lan:"))
        .map((client) => (
          <div className="settings-row" key={client.id}>
            <span>
              {client.name} · {client.code ?? client.id.slice(-6)}
            </span>
            <button
              className="settings-button"
              onClick={() =>
                void desktop
                  .invoke("agent:approveRemoteClient", {
                    id: client.id,
                    approve: true,
                  })
                  .then(refresh)
                  .catch((reason) => setError(reason.message))
              }
            >
              {t("allowDevice")}
            </button>
            <button
              className="settings-button"
              onClick={() =>
                void desktop
                  .invoke("agent:approveRemoteClient", {
                    id: client.id,
                    approve: false,
                  })
                  .then(refresh)
                  .catch((reason) => setError(reason.message))
              }
            >
              {t("reject")}
            </button>
          </div>
        ))}
      {[
        ...(state.settings.trustedClients ?? []),
        ...(state.lan?.trusted ?? []),
      ].map((client) => (
        <div className="settings-row" key={client.id}>
          <span>
            {client.name} · {client.id.slice(-6)}
          </span>
          <button
            className="settings-button"
            onClick={() =>
              void desktop
                .invoke("agent:approveRemoteClient", {
                  id: client.id,
                  approve: false,
                })
                .then(refresh)
                .catch((reason) => setError(reason.message))
            }
          >
            {t("revokeDevice")}
          </button>
        </div>
      ))}
      {(error || state.error) && (
        <p role="alert" className="agent-error">
          {error || state.error}
        </p>
      )}
    </section>
  );
}
