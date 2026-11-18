import { settingsTabKeyDown } from "./settings-tab-keys";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
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
} from "../ui/icons";
import { desktop, errorMessage } from "../host/bridge";
import { useLocale, useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteConnections";
import { isPublicProvider } from "../remote-mcp/client-setup";
import type { RemoteMcpStatus } from "../remote-mcp/types";
import ChatgptConnectionGuide from "./ChatgptConnectionGuide";
import { RemoteCopyField } from "./RemoteConnectionControls";

export default function RemoteMcpClientSetup({
  state,
  addRequest,
  busy,
  onCopy,
  onExport,
  onRefresh,
}: {
  state: RemoteMcpStatus;
  addRequest: number;
  busy: boolean;
  onCopy(value: string): Promise<void>;
  onExport(): void;
  onRefresh(): Promise<void>;
}) {
  const tabId = useId();
  const locale = useLocale();
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
  const [revoked, setRevoked] = useState("");
  const [waitingTooLong, setWaitingTooLong] = useState(false);
  const approvalBaseline = useRef(state.approval?.at);
  const handledAdd = useRef(0);
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
    approvalBaseline.current = state.approval?.at;
    baseline.current = new Set(state.clients.map((client) => client.id));
    callBaseline.current = state.lastCallAt;
    setKey(undefined);
    setShowKey(false);
    setCopied(false);
    setRevoked("");
    setName("");
    setView("setup");
  }
  useEffect(() => {
    if (addRequest > handledAdd.current) {
      handledAdd.current = addRequest;
      add();
    }
  }, [addRequest]);
  useEffect(() => {
    setWaitingTooLong(false);
    if (view !== "verify") return;
    const timer = setTimeout(() => setWaitingTooLong(true), 45000);
    return () => clearTimeout(timer);
  }, [view]);
  async function copyKey() {
    await onCopy(key!.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  const authorized =
    (!!key && state.clients.some((client) => client.id === key.id)) ||
    state.clients.some((client) => !baseline.current.has(client.id));
  const rejected =
    !authorized &&
    state.approval?.decision === "deny" &&
    approvalBaseline.current !== state.approval.at;
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
          {revoked && (
            <p className="settings-help" role="status">
              {revoked}
            </p>
          )}
          {state.clients.length ? (
            <div className="rm-client-table">
              <div className="rm-client-table-head">
                <span>{t("clients")}</span>
                <span>{t("clientStatus")}</span>
                <span>{t("clientAccess")}</span>
              </div>
              {state.clients.map((connection) => {
                const lastCall =
                  connection.lastCallAt ??
                  (state.lastCallClientId === connection.id
                    ? state.lastCallAt
                    : undefined);
                return (
                  <div className="rm-client-record" key={connection.id}>
                    <span className="rm-device-name">
                      <Laptop size={18} />
                      {connection.name}
                    </span>
                    <span className={`rm-tag${lastCall ? " success" : ""}`}>
                      {lastCall ? <Check size={12} /> : <KeyRound size={12} />}
                      {t(lastCall ? "verifiedState" : "authorizedState")}
                      {lastCall && (
                        <time dateTime={lastCall} title={t("activity")}>
                          {new Date(lastCall).toLocaleString(locale)}
                        </time>
                      )}
                    </span>
                    <button
                      type="button"
                      className="rm-button rm-danger-action"
                      aria-label={t("revoke", { name: connection.name })}
                      disabled={pending}
                      onClick={() =>
                        void run(async () => {
                          await desktop.invoke("remoteMcp:revoke", {
                            provider,
                            id: connection.id,
                          });
                          await onRefresh();
                          setRevoked(
                            t("accessRevoked", { name: connection.name }),
                          );
                        })
                      }
                    >
                      <Unplug size={16} aria-hidden="true" />
                      {t("revokeAccess")}
                    </button>
                  </div>
                );
              })}
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
          {state.clients.length > 0 && (
            <button
              type="button"
              className="rm-button rm-return"
              onClick={() => {
                setShowKey(false);
                setView("list");
              }}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              {t("backToAuthorized")}
            </button>
          )}
          <div className="rm-client-toolbar">
            <div
              className="rm-step-tabs"
              role="tablist"
              aria-label={t("clients")}
              onKeyDown={settingsTabKeyDown}
            >
              <button
                id={`${tabId}-setup`}
                aria-controls={`${tabId}-step`}
                tabIndex={view === "setup" ? 0 : -1}
                role="tab"
                aria-selected={view === "setup"}
                onClick={() => setView("setup")}
              >
                <KeyRound size={15} />
                {t("serverSetup")}
              </button>
              <button
                id={`${tabId}-verify`}
                aria-controls={`${tabId}-step`}
                tabIndex={view === "verify" ? 0 : -1}
                role="tab"
                aria-selected={view === "verify"}
                disabled={lan && !key}
                onClick={() => setView("verify")}
              >
                <ArrowRight size={15} />
                {t("sendMessage")}
              </button>
            </div>
          </div>
          <div
            role="tabpanel"
            id={`${tabId}-step`}
            aria-labelledby={`${tabId}-${view}`}
          >
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
                      onExport={onExport}
                      onReady={() => setView("verify")}
                    />
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
                              }>("remoteMcp:createAccessKey", {
                                provider,
                                name,
                              });
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
                                onChange={(event) =>
                                  setName(event.target.value)
                                }
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
                            <button
                              type="button"
                              className="rm-button"
                              aria-pressed={showKey}
                              onClick={() => setShowKey((value) => !value)}
                            >
                              {showKey ? (
                                <EyeOff size={16} aria-hidden="true" />
                              ) : (
                                <Eye size={16} aria-hidden="true" />
                              )}
                              {t(showKey ? "hideKey" : "showKey")}
                            </button>
                            <button
                              type="button"
                              className="rm-button"
                              aria-label={t("copy", { name: t("key") })}
                              disabled={pending}
                              onClick={() => void run(copyKey)}
                            >
                              {copied ? (
                                <Check size={16} aria-hidden="true" />
                              ) : (
                                <Copy size={16} aria-hidden="true" />
                              )}
                              <span aria-live="polite">
                                {t(copied ? "copied" : "copyValue")}
                              </span>
                            </button>
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
                  <h3>
                    {client === "chatgpt" ? "ChatGPT" : name || t("other")}
                  </h3>
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
                    <RefreshCw
                      className={rejected ? "" : "rm-spin"}
                      size={17}
                    />
                  )}
                  <span>
                    {rejected
                      ? t("denied")
                      : t(
                          authorized
                            ? "authorized"
                            : lan
                              ? "noRequest"
                              : "pendingAuthorization",
                        )}
                  </span>
                </div>
                {rejected ? (
                  <button className="rm-button" type="button" onClick={add}>
                    {t("retryAuthorization")}
                  </button>
                ) : (
                  waitingTooLong && (
                    <p className="settings-help">{t("verificationHelp")}</p>
                  )
                )}
              </div>
            )}
          </div>
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
