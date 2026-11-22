import { useState } from "react";
import { desktop, errorMessage } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pluginInstall";
import { launchSnippet, type McpLaunch } from "../plugin/launch-snippets";
import { useNotify } from "../problems/toast-context";
import Dialog from "../ui/Dialog";
import AgentBrandIcon from "./AgentBrandIcon";
import { SettingsPath } from "./SettingsPath";

const hosts = [
  { id: "kimi", name: "Kimi Work", brand: "kimi-work", method: "package" },
  { id: "cursor", name: "Cursor Agents", brand: "cursor", method: "package" },
  { id: "cursor-ide", name: "Cursor IDE", brand: "cursor", method: "package" },
  { id: "trae", name: "TRAE IDE", brand: "trae", method: "package" },
  { id: "qoder", name: "Qoder", brand: "qoder", method: "package" },
  { id: "workbuddy", name: "WorkBuddy", brand: "workbuddy", method: "package" },
  { id: "kimi-code", name: "Kimi Code", brand: "kimi", method: "package" },
  { id: "gemini", name: "Gemini CLI", brand: "gemini", method: "json" },
  { id: "opencode", name: "OpenCode", brand: "opencode", method: "opencode" },
] as const;

type Host = (typeof hosts)[number];

export default function LocalPluginSetups() {
  const t = useTranslator(messages);
  const notify = useNotify();
  const [pending, setPending] = useState<Host["id"]>();
  const [prepared, setPrepared] = useState<{ host: Host; path: string }>();
  const [error, setError] = useState<{ host: Host["id"]; message: string }>();

  async function copyConfig(host: Host) {
    const launch = await desktop.invoke<McpLaunch>("plugins:launchConfig");
    const method = host.method === "opencode" ? "opencode" : "json";
    const env = {
      ...launch.env, SHOWAI_LINKED_WORKBENCH: "1",
      ...((host.id === "trae" || host.id === "kimi-code") && { SHOWAI_HOST_DISPLAY: "fragment-file" }),
      ...(host.id === "trae" && { SHOWAI_LOCAL_PAGE_REFERENCES: "1" }),
    };
    await desktop.invoke("clipboard:write", { text: launchSnippet(method, { ...launch, env }) });
    notify(t("copied"));
  }

  async function setup(host: Host) {
    setPending(host.id);
    setError(undefined);
    try {
      if (host.method === "package") {
        const { path } = await desktop.invoke<{ path: string }>(
          "plugins:prepareLocal",
          { host: host.id },
        );
        setPrepared({ host, path });
      } else {
        await copyConfig(host);
      }
    } catch (reason) {
      setError({ host: host.id, message: errorMessage(reason) });
    } finally {
      setPending(undefined);
    }
  }

  return (
    <>
      {hosts.map((host) => (
        <div
          className="settings-row plugin-host"
          key={host.id}
          data-host={host.id}
        >
          <AgentBrandIcon brand={host.brand} />
          <div className="settings-row-text">
            <h3>{host.name}</h3>
            <p className="plugin-host-state">{t(`setup.${host.id}`)}</p>
            {error?.host === host.id && (
              <p role="alert" className="plugin-install-error">
                {error.message}
              </p>
            )}
          </div>
          <div className="plugin-host-actions">
            <button
              className="settings-button"
              type="button"
              disabled={!!pending}
              onClick={() => void setup(host)}
            >
              {t(
                pending === host.id
                  ? "preparing"
                  : host.method === "package"
                    ? "preparePackage"
                    : "copyMcpConfig",
              )}
            </button>
          </div>
        </div>
      ))}
      {prepared && (
        <Dialog
          title={prepared.host.name}
          onClose={() => setPrepared(undefined)}
        >
          <div className="studio-dialog-body">
            <p>{t(`setup.${prepared.host.id}`)}</p>
            <SettingsPath
              value={prepared.path}
              copyLabel={t("copyPath")}
              copiedLabel={t("copied")}
              onCopy={() =>
                desktop
                  .invoke("clipboard:write", { text: prepared.path })
                  .catch((reason) => {
                    notify(errorMessage(reason), { kind: "warning" });
                    return false;
                  })
              }
            />
            {prepared.host.id === "workbuddy" && (
              <a
                href="https://github.com/Renaissance-Mind/ShowAI/tree/main/plugins/showai#cursor-qoder-and-workbuddy"
                target="_blank"
                rel="noreferrer"
              >
                {t("workbuddyGuide")}
              </a>
            )}
            {(prepared.host.id === "trae" || prepared.host.id === "kimi-code") && (
              <button type="button" className="settings-button" onClick={() =>
                void copyConfig(prepared.host).catch(reason => notify(errorMessage(reason), { kind: "warning" }))
              }>{t("copyMcpConfig")}</button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
