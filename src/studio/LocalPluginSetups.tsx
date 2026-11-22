import { useEffect, useState } from "react";
import { desktop, errorMessage } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pluginInstall";
import { launchSnippet, t3CodeLaunchSnippet, type McpLaunch, type T3CodeProvider } from "../plugin/launch-snippets";
import type { PluginInstallation } from "../plugin/desktop-install";
import type {
  LocalInstallHost,
  LocalInstallReceipt,
} from "../plugin/local-install";
import { useNotify } from "../problems/toast-context";
import Dialog from "../ui/Dialog";
import AgentBrandIcon from "./AgentBrandIcon";
import { SettingsPath } from "./SettingsPath";

const hosts = [
  { id: "t3-code", name: "T3 Code", brand: "t3-code", method: "provider" },
  { id: "kimi", name: "Kimi Work", brand: "kimi-work", method: "package" },
  {
    id: "cursor",
    name: "Cursor Agents",
    brand: "cursor",
    method: "package",
    direct: true,
  },
  {
    id: "cursor-ide",
    name: "Cursor IDE",
    brand: "cursor",
    method: "package",
    direct: true,
  },
  {
    id: "trae",
    name: "TRAE IDE",
    brand: "trae",
    method: "package",
    direct: true,
  },
  { id: "qoder", name: "Qoder", brand: "qoder", method: "package" },
  {
    id: "workbuddy",
    name: "WorkBuddy",
    brand: "workbuddy",
    method: "package",
    direct: true,
  },
  { id: "kimi-code", name: "Kimi Code", brand: "kimi", method: "package" },
  {
    id: "gemini",
    name: "Gemini CLI",
    brand: "gemini",
    method: "json",
    direct: true,
  },
  { id: "opencode", name: "OpenCode", brand: "opencode", method: "opencode" },
] as const;

type Host = (typeof hosts)[number];

export default function LocalPluginSetups({
  hostStatus,
}: {
  hostStatus: PluginInstallation[];
}) {
  const t = useTranslator(messages);
  const notify = useNotify();
  const [pending, setPending] = useState<Host["id"]>();
  const [t3Provider, setT3Provider] = useState<T3CodeProvider>("codex");
  const [prepared, setPrepared] = useState<{ host: Host; path: string }>();
  const [error, setError] = useState<{ host: Host["id"]; message: string }>();
  const [localHosts, setLocalHosts] = useState<LocalInstallHost[]>();
  const [completed, setCompleted] = useState<LocalInstallHost[]>([]);
  const [traeMcp, setTraeMcp] = useState<Host>();

  useEffect(() => {
    let active = true;
    void desktop.invoke<LocalInstallHost[]>("plugins:localHosts").then(
      (value) => {
        if (active) setLocalHosts(value);
      },
      () => {
        if (active) setLocalHosts([]);
      },
    );
    return () => {
      active = false;
    };
  }, [hostStatus]);

  async function copyConfig(host: Host) {
    const launch = await desktop.invoke<McpLaunch>("plugins:launchConfig");
    if (host.id === "t3-code") {
      const info = await desktop.invoke<{ platform: string }>("app:info");
      await desktop.invoke("clipboard:write", { text: t3CodeLaunchSnippet(t3Provider, launch, info.platform) });
      notify(t("copied"));
      return;
    }
    const method = host.method === "opencode" ? "opencode" : "json";
    const env = {
      ...launch.env,
      SHOWAI_LINKED_WORKBENCH: "1",
      ...((host.id === "trae" || host.id === "kimi-code") && {
        SHOWAI_HOST_DISPLAY: "fragment-file",
      }),
      ...(host.id === "trae" && { SHOWAI_LOCAL_PAGE_REFERENCES: "1" }),
    };
    await desktop.invoke("clipboard:write", {
      text: launchSnippet(method, { ...launch, env }),
    });
    notify(t("copied"));
  }

  async function setup(host: Host, native = false) {
    setPending(host.id);
    setError(undefined);
    try {
      if (native) {
        const receipt = await desktop.invoke<LocalInstallReceipt>(
          "plugins:installLocal",
          { host: host.id },
        );
        setCompleted((current) =>
          current.includes(receipt.host) ? current : [...current, receipt.host],
        );
        if (receipt.next === "trae-mcp") setTraeMcp(host);
        notify(
          receipt.next === "trae-confirm"
            ? t("traeMcpConfirm")
            : receipt.next === "trae-mcp"
              ? t("traeExtensionInstalled")
              : receipt.next === "cursor-reload"
                ? t("cursorLocalAdded")
                : host.id === "gemini"
                  ? t("mcpConfigured")
                  : t("localInstalled", { host: host.name }),
        );
      } else if (host.method === "package") {
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
      {hosts.map((host) => {
        const installer = localHosts?.find((id) => id === host.id);
        const checking = !localHosts && "direct" in host;
        const manualAction =
          host.method === "package" ? "preparePackage" : "copyMcpConfig";
        const action =
          installer === "gemini"
            ? "configureMcp"
            : installer
              ? completed.includes(installer)
                ? "reinstall"
                : "install"
              : manualAction;
        return (
          <div
            className="settings-row plugin-host"
            key={host.id}
            data-host={host.id}
          >
            <AgentBrandIcon brand={host.brand} />
            <div className="settings-row-text">
              <h3>{host.name}</h3>
              <p className="plugin-host-state">
                {!checking &&
                  (installer
                    ? t(`setup.local.${installer}`)
                    : t(`setup.${host.id}`))}
              </p>
              {error?.host === host.id && (
                <p role="alert" className="plugin-install-error">
                  {error.message}
                </p>
              )}
            </div>
            <div className="plugin-host-actions">
              {host.id === "t3-code" && (
                <select className="showai-select" aria-label={t("t3Provider")} value={t3Provider}
                  onChange={event => setT3Provider(event.target.value as T3CodeProvider)}>
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code ≥ 2.1.301</option>
                  <option value="claude-legacy">Claude Code &lt; 2.1.301</option>
                  <option value="opencode">OpenCode</option>
                  <option value="json">{t("t3OtherProvider")}</option>
                </select>
              )}
              <button
                className={
                  installer
                    ? "settings-button settings-primary-button"
                    : "settings-button"
                }
                type="button"
                disabled={checking || !!pending}
                onClick={() => void setup(host, !!installer)}
              >
                {t(
                  checking
                    ? "scanning"
                    : pending === host.id
                      ? "preparing"
                      : action,
                )}
              </button>
              {installer && error?.host === host.id && (
                <button
                  type="button"
                  className="settings-button"
                  disabled={!!pending}
                  onClick={() => void setup(host)}
                >
                  {t(manualAction)}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {traeMcp && (
        <Dialog title={t("traeMcpTitle")} onClose={() => setTraeMcp(undefined)}>
          <div className="studio-dialog-body">
            <p>{t("traeMcpManual")}</p>
            <button
              type="button"
              className="settings-button settings-primary-button"
              onClick={() =>
                void copyConfig(traeMcp).catch((reason) =>
                  notify(errorMessage(reason), { kind: "warning" }),
                )
              }
            >
              {t("copyMcpConfig")}
            </button>
          </div>
        </Dialog>
      )}
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
            {(prepared.host.id === "trae" ||
              prepared.host.id === "kimi-code") && (
              <button
                type="button"
                className="settings-button"
                onClick={() =>
                  void copyConfig(prepared.host).catch((reason) =>
                    notify(errorMessage(reason), { kind: "warning" }),
                  )
                }
              >
                {t("copyMcpConfig")}
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
