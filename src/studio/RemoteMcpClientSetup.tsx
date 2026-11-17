import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleCheck,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Plus,
  RefreshCw,
  Unplug,
  ExternalLink,
  FileDown,
} from "../ui/icons";
import { desktop, errorMessage } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteConnections";
import { isPublicProvider } from "../remote-mcp/client-setup";
import type { RemoteMcpStatus } from "../remote-mcp/types";
import ChatgptConnectionGuide from "./ChatgptConnectionGuide";
import { RemoteCopyField, RemoteIconButton } from "./RemoteConnectionControls";

export default function RemoteMcpClientSetup({
  state,
  busy,
  onCopy,
  onExport,
  onRefresh,
}: {
  state: RemoteMcpStatus;
  busy: boolean;
  onCopy(value: string): Promise<void>;
  onExport(): void;
  onRefresh(): Promise<void>;
}) {
  const t = useTranslator(messages),
    lan = state.config.provider === "lan",
    publicNetwork = isPublicProvider(state.config.provider);
  const [client, setClient] = useState<"chatgpt" | "other">("other"),
    [view, setView] = useState<"list" | "setup" | "verify">(
      state.clients.length ? "list" : "setup",
    );
  const [name, setName] = useState(""),
    [key, setKey] = useState<{
      id: string;
      token: string;
      expiresAt: string;
    }>(),
    [showKey, setShowKey] = useState(false),
    [copied, setCopied] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const baseline = useRef(new Set(state.clients.map((client) => client.id))),
    callBaseline = useRef(state.lastCallAt);
  const pending = busy || working,
    provider = state.config.provider;
  useEffect(() => {
    if (
      view === "verify" &&
      state.lastCallAt &&
      state.lastCallAt !== callBaseline.current &&
      (key
        ? state.lastCallClientId === key.id
        : !!state.lastCallClientId &&
          !baseline.current.has(state.lastCallClientId))
    )
      setView("list");
  }, [state.lastCallAt, state.lastCallClientId, view, key]);
  async function run(operation: () => Promise<void>) {
    setWorking(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }
  function add() {
    baseline.current = new Set(state.clients.map((client) => client.id));
    callBaseline.current = state.lastCallAt;
    setKey(undefined);
    setName("");
    setView("setup");
  }
  async function copyKey() {
    await onCopy(key!.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  const authorized =
    (!!key && state.clients.some((client) => client.id === key.id)) ||
    state.clients.some((client) => !baseline.current.has(client.id));
  const rejected = !authorized && state.approval?.decision === "deny";
  return (
    <div
      className="rm-client-area"
      data-client-view={view}
      data-client-type={client}
    >
      {view === "list" ? (
        <>
          <div className="rm-section-heading">
            <h3>{t("authorizedClients")}</h3>
            <button className="rm-button" onClick={add}>
              <Plus size={15} />
              {t("addClient")}
            </button>
          </div>
          {state.clients.length ? (
            <div className="rm-client-table">
              <div className="rm-client-table-head">
                <span>{t("clients")}</span>
                <span>{t("clientStatus")}</span>
                <span />
              </div>
              {state.clients.map((connection) => (
                <div className="rm-client-record" key={connection.id}>
                  <span className="rm-device-name">
                    <Laptop size={18} />
                    {connection.name}
                  </span>
                  <span
                    className={`rm-tag${state.lastCallClientId === connection.id ? " success" : ""}`}
                  >
                    {state.lastCallClientId === connection.id ? (
                      <Check size={12} />
                    ) : (
                      <KeyRound size={12} />
                    )}
                    {t(
                      state.lastCallClientId === connection.id
                        ? "verifiedState"
                        : "authorizedState",
                    )}
                  </span>
                  <RemoteIconButton
                    label={t("revoke", { name: connection.name })}
                    danger
                    disabled={pending}
                    onClick={() =>
                      void run(async () => {
                        await desktop.invoke("remoteMcp:revoke", {
                          provider,
                          id: connection.id,
                        });
                        await onRefresh();
                      })
                    }
                  >
                    <Unplug size={16} />
                  </RemoteIconButton>
                </div>
              ))}
            </div>
          ) : (
            <div className="rm-empty">
              <Laptop size={28} />
              <h3>{t("noClients")}</h3>
              <button className="rm-button primary" onClick={add}>
                <Plus size={15} />
                {t("addClient")}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rm-client-toolbar">
            <div
              className="rm-step-tabs"
              role="tablist"
              aria-label={t("clients")}
            >
              <button
                role="tab"
                aria-selected={view === "setup"}
                onClick={() => setView("setup")}
              >
                <KeyRound size={15} />
                {t("serverSetup")}
              </button>
              <button
                role="tab"
                aria-selected={view === "verify"}
                disabled={lan && !key}
                onClick={() => setView("verify")}
              >
                <ArrowRight size={15} />
                {t("sendMessage")}
              </button>
            </div>
            {state.clients.length > 0 && (
              <RemoteIconButton
                label={t("authorizedClients")}
                onClick={() => setView("list")}
              >
                <Laptop size={17} />
              </RemoteIconButton>
            )}
          </div>
          {view === "setup" ? (
            <>
              {publicNetwork && (
                <div
                  className="rm-segmented rm-client-kind"
                  aria-label={t("clientType")}
                >
                  <button
                    aria-pressed={client === "other"}
                    onClick={() => setClient("other")}
                  >
                    <Laptop size={15} />
                    {t("other")}
                  </button>
                  <button
                    aria-pressed={client === "chatgpt"}
                    onClick={() => setClient("chatgpt")}
                  >
                    ChatGPT
                  </button>
                </div>
              )}
              {client === "chatgpt" && publicNetwork ? (
                <>
                  <ChatgptConnectionGuide
                    endpoint={state.url!}
                    onCopy={onCopy}
                    busy={pending}
                    onReady={() => setView("verify")}
                  />
                  <button className="rm-button" onClick={onExport}>
                    <FileDown size={15} />
                    {t("export")}
                  </button>
                </>
              ) : (
                <div className="rm-client-recipe">
                  <RemoteCopyField
                    label={t("endpoint")}
                    value={state.url!}
                    onCopy={onCopy}
                  />
                  <div className="rm-readonly-row">
                    <span>{t("authentication")}</span>
                    <span className="rm-capability">
                      <KeyRound size={14} />
                      {lan ? "Bearer" : "OAuth"}
                    </span>
                  </div>
                  {lan &&
                    (!key ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(async () => {
                            const receipt = await desktop.invoke<{
                              id: string;
                              token: string;
                              expiresAt: string;
                            }>("remoteMcp:createAccessKey", { provider, name });
                            setKey(receipt);
                            await onRefresh();
                          });
                        }}
                      >
                        <div className="rm-field">
                          <label htmlFor="remote-client-name">
                            {t("name")}
                          </label>
                          <div className="rm-input-action">
                            <input
                              id="remote-client-name"
                              value={name}
                              maxLength={100}
                              placeholder={t("namePlaceholder")}
                              onChange={(event) => setName(event.target.value)}
                            />
                            <button
                              className="rm-button"
                              type="submit"
                              disabled={pending || !name.trim()}
                            >
                              <KeyRound size={15} />
                              {t("generateKey")}
                            </button>
                          </div>
                        </div>
                      </form>
                    ) : (
                      <div className="rm-field">
                        <label htmlFor="remote-access-key">{t("key")}</label>
                        <div className="rm-secret-field">
                          <input
                            id="remote-access-key"
                            type={showKey ? "text" : "password"}
                            readOnly
                            value={key.token}
                          />
                          <RemoteIconButton
                            label={t(showKey ? "hideKey" : "showKey")}
                            onClick={() => setShowKey((value) => !value)}
                          >
                            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                          </RemoteIconButton>
                          <RemoteIconButton
                            label={
                              copied
                                ? t("copied")
                                : t("copy", { name: t("key") })
                            }
                            onClick={() => void run(copyKey)}
                          >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                          </RemoteIconButton>
                        </div>
                      </div>
                    ))}
                  <div className="rm-form-actions">
                    <button
                      className="rm-button primary"
                      disabled={pending || (lan && !key)}
                      onClick={() => setView("verify")}
                    >
                      {t("nextMessage")}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rm-message-task">
              <div className="rm-section-heading">
                <h3>{client === "chatgpt" ? "ChatGPT" : name || t("other")}</h3>
                {client === "chatgpt" && (
                  <a
                    className="rm-button"
                    href="https://chatgpt.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("openChatgpt")}
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
              <RemoteCopyField
                label={t("testMessage")}
                value={t("prompt")}
                onCopy={onCopy}
              />
              <div
                className={`rm-client-status${rejected ? " error" : ""}`}
                role="status"
              >
                {authorized ? (
                  <CircleCheck size={17} />
                ) : (
                  <RefreshCw className={rejected ? "" : "rm-spin"} size={17} />
                )}
                <span>
                  {rejected
                    ? t("denied")
                    : t(authorized ? "authorized" : "noRequest")}
                </span>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <div role="alert" className="rm-error">
          {error}
        </div>
      )}
    </div>
  );
}
