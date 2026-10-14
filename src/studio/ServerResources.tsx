import { useState } from "react";
import { desktop, errorMessage } from "./bridge";
import type { ResolvedResource } from "../sync/accounts";
import type { ServerConnection } from "../sync/protocol";
import type { AgentHostStatus, ModelSource } from "../agent-host/types";
import { useTranslator } from "../i18n/react";
import strings from "../i18n/messages/agentSettings";
export default function ServerResources({
  selected,
  disabled,
  update,
}: {
  selected?: ModelSource;
  disabled: boolean;
  update: (status: AgentHostStatus) => void;
}) {
  const t = useTranslator(strings);
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
          <h3>{t("resources.title")}</h3>
          <p>{t("resources.help")}</p>
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
                setMessage(t("resources.partial"));
            })
          }
        >
          {t("resources.search")}
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
                ? `${t("resources.chatgpt")}${resource.account ? ` · ${resource.account}` : ""}`
                : t("resources.apiKey")}
              {resource.available ? "" : ` · ${t("resources.offline")}`}
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
                setMessage(t("resources.added"));
              })
            }
          >
            {t("resources.use")}
          </button>
        </div>
      ))}
      {resources?.length === 0 && (
        <p className="settings-help">{t("resources.none")}</p>
      )}
      {selected?.hosted && (
        <p className="settings-help">
          {t("resources.current", {
            server: selected.hosted.serverName,
            url: selected.hosted.url,
          })}
        </p>
      )}
      {selected && !selected.hosted && resources !== null && (
        <div className="sync-form">
          <label>
            {t("resources.saveTo")}
            <select
              aria-label={t("resources.saveServer")}
              value={target}
              disabled={disabled || busy}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">{t("resources.chooseServer")}</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} · {server.user.name}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-help">{t("resources.saveHelp")}</p>
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
                setMessage(t("resources.saved"));
              })
            }
          >
            {t("resources.save")}
          </button>
        </div>
      )}
    </div>
  );
}
