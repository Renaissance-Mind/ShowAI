import { useState } from "react";
import { desktop, errorMessage } from "./bridge";
import type { ResolvedResource } from "../sync/accounts";
import type { ServerConnection } from "../sync/protocol";
import type { AgentHostStatus, ModelSource } from "../agent-host/types";
export default function ServerResources({
  selected,
  disabled,
  update,
}: {
  selected?: ModelSource;
  disabled: boolean;
  update: (status: AgentHostStatus) => void;
}) {
  const [resources, setResources] = useState<ResolvedResource[] | null>(null),
    [servers, setServers] = useState<Omit<ServerConnection, "token">[]>([]);
  const [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="agent-server-resources">
      <div className="settings-row">
        <div className="settings-row-text">
          <h3>服务器上的模型资源</h3>
          <p>
            检索已登录服务的 API Key 和 ChatGPT
            授权，选择后由来源服务器提供凭据。
          </p>
        </div>
        <button
          type="button"
          className="settings-button"
          disabled={disabled || busy}
          onClick={() =>
            void run(async () => {
              const status = await desktop.invoke<{
                connections: Omit<ServerConnection, "token">[];
                federation: { errors: Record<string, string> };
              }>("sync:status");
              setServers(
                status.connections.filter((item) =>
                  item.capabilities?.includes("account-federation-v1"),
                ),
              );
              setResources(
                await desktop.invoke<ResolvedResource[]>(
                  "agent:serverResources",
                ),
              );
              const refreshed = await desktop.invoke<{
                federation: { errors: Record<string, string> };
              }>("sync:status");
              if (Object.keys(refreshed.federation.errors).length)
                setMessage("部分服务暂时不可用，恢复连接后可重新检索。");
            })
          }
        >
          检索服务器资源
        </button>
      </div>
      {error && (
        <p className="sync-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="sync-message" role="status">
          {message}
        </p>
      )}
      {resources?.map((resource) => (
        <div className="settings-row" key={resource.id}>
          <div className="settings-row-text">
            <h3>{resource.name}</h3>
            <p>
              {resource.source.serverName} · {resource.source.user.name} ·{" "}
              {resource.source.url}
            </p>
            <p>
              {resource.credential === "chatgpt"
                ? `ChatGPT 授权${resource.account ? ` · ${resource.account}` : ""}`
                : "API Key"}
              {resource.available ? "" : " · 来源暂时离线"}
            </p>
          </div>
          <button
            type="button"
            className="settings-button"
            disabled={
              disabled || busy || !resource.available || !resource.connected
            }
            onClick={() =>
              void run(async () => {
                update(
                  await desktop.invoke<AgentHostStatus>(
                    "agent:addServerResource",
                    { id: resource.id },
                  ),
                );
                setMessage("已添加来源，可以选择模型并使用。");
              })
            }
          >
            使用此资源
          </button>
        </div>
      ))}
      {resources?.length === 0 && (
        <p className="settings-help">没有检索到模型资源。</p>
      )}
      {selected?.hosted && (
        <p className="settings-help">
          当前来源：{selected.hosted.serverName} · {selected.hosted.url}
        </p>
      )}
      {selected && !selected.hosted && resources !== null && (
        <div className="sync-form">
          <label>
            将当前来源保存到服务器
            <select
              aria-label="模型资源保存服务器"
              value={target}
              disabled={disabled || busy}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">选择来源服务器</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} · {server.user.name}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-help">
            保存后，本设备和其他绑定设备都会通过该服务器使用此资源。ChatGPT
            的授权刷新也由该服务器负责。
          </p>
          <button
            type="button"
            className="settings-button"
            disabled={disabled || busy || !target}
            onClick={() =>
              void run(async () => {
                update(
                  await desktop.invoke<AgentHostStatus>("agent:publishSource", {
                    id: selected.id,
                    connectionId: target,
                  }),
                );
                setResources(await desktop.invoke("agent:serverResources"));
                setMessage(
                  "已保存到来源服务器，其他绑定设备现在可以检索使用。",
                );
              })
            }
          >
            保存到来源服务器
          </button>
        </div>
      )}
    </div>
  );
}
