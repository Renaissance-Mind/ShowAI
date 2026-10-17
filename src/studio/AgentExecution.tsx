import { useEffect, useState, useRef } from "react";
import { desktop } from "./bridge";
import type { AgentDestination } from "../agent-host/remote-protocol";
import type { ConnectorSettings } from "../agent-host/remote-connector";
import { translator } from "../i18n";
import messages from "../i18n/messages/agentExecution";

import { NearbyMacs } from "./LanPairing";
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
  const [pairId, setPairId] = useState<string>();
  const [error, setError] = useState("");
  const loadGeneration = useRef(0),
    selectionGeneration = useRef(0);
  const load = () => {
    const generation = ++loadGeneration.current;
    return desktop
      .invoke<NonNullable<typeof context>>("agent:execution", { projectId })
      .then((next) => {
        if (generation === loadGeneration.current) {
          setContext(next);
          setError(next.error ?? "");
        }
      })
      .catch((reason) => {
        if (generation === loadGeneration.current) setError(reason.message);
      });
  };
  useEffect(() => {
    if (remoteExecution()) void load();
  }, [projectId]);
  if (!remoteExecution()) return null;
  const change = async (value: Record<string, string>) => {
    const generation = ++selectionGeneration.current;
    loadGeneration.current++;
    setError("");
    try {
      await desktop.invoke("agent:selectExecution", { projectId, ...value });
      if (generation !== selectionGeneration.current) return;
      await load();
      if (generation !== selectionGeneration.current) return;
      onChange?.(true);
      window.dispatchEvent(new Event("showai-agent-execution-change"));
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  return (
    <div className="agent-execution-picker">
      <label>
        {t("serverAccount")}
        <select
          disabled={disabled}
          value={context?.connectionId ?? ""}
          onChange={(e) => void change({ connectionId: e.target.value })}
        >
          <option value="">{t("chooseAccount")}</option>
          {context?.connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("runAgentOn")}
        <select
          disabled={disabled || !context?.connectionId}
          value={context?.destinationId ?? "cloud"}
          onChange={(e) => {
            const id = e.target.value;
            void change({ destinationId: id });
          }}
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
          ).map((d) => (
            <option key={d.id} value={d.id} disabled={!d.online}>
              {d.name}
              {d.online
                ? ""
                : d.kind === "cloud"
                  ? t("unavailable")
                  : t("offline")}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="settings-button"
        disabled={disabled}
        onClick={() => void load().then(() => onChange?.(false))}
      >
        {t("refreshDevices")}
      </button>
      <button
        type="button"
        className="settings-button"
        disabled={disabled}
        onClick={() => {
          setPairId(undefined);
          setPairing(true);
        }}
      >
        {t("pairANearbyMac")}
      </button>
      {pairing && (
        <NearbyMacs
          initialId={pairId}
          onClose={() => setPairing(false)}
          onPaired={(id) => {
            setPairing(false);
            void change({ destinationId: id });
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
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await desktop.invoke("agent:shareDevice", { settings: state.settings });
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
      {state.pendingClients.map((client) => (
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
      <div className="settings-row">
        <span role="status">
          {state.lan?.online ? t("discoverableOnLAN") : ""}
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
        <button
          type="button"
          className="settings-button"
          onClick={() => void refresh()}
        >
          {t("refresh")}
        </button>
      </div>
      {(error || state.error) && (
        <p role="alert" className="agent-error">
          {error || state.error}
        </p>
      )}
    </section>
  );
}
