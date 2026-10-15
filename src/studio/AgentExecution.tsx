import { useEffect, useState } from "react";
import { desktop } from "./bridge";
import type { AgentDestination } from "../agent-host/remote-protocol";
import type { ConnectorSettings } from "../agent-host/remote-connector";
import { getLocale } from "../i18n";

const chinese = () => getLocale() === "zh-CN";
export const remoteExecution = () =>
  document.documentElement.dataset.native === "ios";
export function AgentExecutionPicker({
  projectId,
  onChange,
  disabled = false,
}: {
  projectId?: string | null;
  onChange?: () => void;
  disabled?: boolean;
}) {
  const [context, setContext] = useState<{
    connections: { id: string; name: string }[];
    connectionId: string;
    destinationId: string;
    destinations: AgentDestination[];
  } | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    desktop
      .invoke<NonNullable<typeof context>>("agent:execution", { projectId })
      .then(setContext)
      .catch((reason) => setError(reason.message));
  useEffect(() => {
    if (remoteExecution()) void load();
  }, [projectId]);
  if (!remoteExecution()) return null;
  const change = async (value: Record<string, string>) => {
    setError("");
    try {
      await desktop.invoke("agent:selectExecution", { projectId, ...value });
      await load();
      onChange?.();
      window.dispatchEvent(new Event("showai-agent-execution-change"));
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  return (
    <div className="agent-execution-picker">
      <label>
        {chinese() ? "服务器账号" : "Server account"}
        <select
          disabled={disabled}
          value={context?.connectionId ?? ""}
          onChange={(e) => void change({ connectionId: e.target.value })}
        >
          <option value="">{chinese() ? "选择账号" : "Choose account"}</option>
          {context?.connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {chinese() ? "运行位置" : "Run Agent on"}
        <select
          disabled={disabled || !context?.connectionId}
          value={context?.destinationId ?? "cloud"}
          onChange={(e) => void change({ destinationId: e.target.value })}
        >
          {(
            context?.destinations ?? [
              {
                id: "cloud",
                name: "ShowAI Cloud",
                kind: "cloud",
                online: true,
              },
            ]
          ).map((d) => (
            <option key={d.id} value={d.id} disabled={!d.online}>
              {d.name}
              {d.online ? "" : chinese() ? " · 离线" : " · Offline"}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="settings-button"
        disabled={disabled}
        onClick={() => void load()}
      >
        {chinese() ? "刷新设备" : "Refresh devices"}
      </button>
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
    pendingClients: { id: string; name: string }[];
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
                }
              : next,
          ),
        )
        .catch((reason) => setError(reason.message));
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  if (remoteExecution() || !state) return null;
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
    <section className="settings-group">
      <h2>
        {chinese() ? "让 iPad 使用这台电脑" : "Use this computer from iPad"}
      </h2>
      <p className="settings-help">
        {chinese()
          ? "设备通过 WSS 连接 ShowAI Cloud。iPad 使用同一服务器账号后，可将任务交给这台电脑。保持 ShowAI 运行并让电脑保持唤醒。"
          : "Connect this computer to ShowAI Cloud over WSS. Devices signed into the same server account can run tasks here. Keep ShowAI running and the computer awake."}
      </p>
      <label className="settings-row">
        <input
          type="checkbox"
          checked={state.settings.enabled}
          onChange={(e) => change({ enabled: e.target.checked })}
        />
        {chinese() ? "允许远程执行" : "Allow remote execution"}
      </label>
      <label className="settings-row">
        {chinese() ? "设备名称" : "Device name"}
        <input
          value={state.settings.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>
      <label className="settings-row">
        {chinese() ? "服务器账号" : "Server account"}
        <select
          value={state.settings.connectionId}
          onChange={(e) =>
            change({ connectionId: e.target.value, projectIds: [] })
          }
        >
          <option value="">{chinese() ? "选择账号" : "Choose account"}</option>
          {state.connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>{chinese() ? "允许访问的项目" : "Allowed projects"}</legend>
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
            {client.name} · {client.id.slice(-6)}
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
            {chinese() ? "允许此设备" : "Allow device"}
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
            {chinese() ? "拒绝" : "Reject"}
          </button>
        </div>
      ))}
      {state.settings.trustedClients?.map((client) => (
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
            {chinese() ? "撤销设备授权" : "Revoke device"}
          </button>
        </div>
      ))}
      <div className="settings-row">
        <span role="status">
          {state.online
            ? chinese()
              ? "已连接"
              : "Connected"
            : chinese()
              ? "未连接"
              : "Disconnected"}
        </span>
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={() => void save()}
        >
          {chinese() ? "保存" : "Save"}
        </button>
        <button
          type="button"
          className="settings-button"
          onClick={() => void refresh()}
        >
          {chinese() ? "刷新" : "Refresh"}
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
