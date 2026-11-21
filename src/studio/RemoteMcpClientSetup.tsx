import { useEffect, useId, useRef, useState } from "react";
import { desktop, errorMessage } from "../host/bridge";
import messages from "../i18n/messages/remoteConnections";
import { useTranslator } from "../i18n/react";
import { isPublicProvider } from "../remote-mcp/client-setup";
import type { RemoteMcpStatus } from "../remote-mcp/types";
import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Plus,
  RefreshCw,
} from "../ui/icons";
import ChatgptConnectionGuide from "./ChatgptConnectionGuide";
import { RemoteCopyField } from "./RemoteConnectionControls";
import { settingsTabKeyDown } from "./settings-tab-keys";

export default function RemoteMcpClientSetup({
  state,
  busy,
  onCopy,
  onCopyPrompt,
  promptCopied,
  onExport,
  onRefresh,
  onBackToOverview,
}: {
  state: RemoteMcpStatus;
  busy: boolean;
  onCopy(value: string): Promise<void>;
  onCopyPrompt(): Promise<void>;
  promptCopied: boolean;
  onExport(): void;
  onRefresh(): Promise<void>;
  onBackToOverview(): void;
}) {
  const tabId = useId();
  const t = useTranslator(messages);
  const lan = state.config.provider === "lan";
  const publicNetwork = isPublicProvider(state.config.provider);
  const [client, setClient] = useState<"chatgpt" | "other">("other");
  const [view, setView] = useState<"setup" | "verify" | "verified">("setup");
  const [name, setName] = useState("");
  const [key, setKey] = useState<{
    id: string;
    token: string;
    expiresAt: string;
  }>();
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [waitingTooLong, setWaitingTooLong] = useState(false);
  const approvalBaseline = useRef(state.approval?.at);
  const baseline = useRef(new Set(state.clients.map((item) => item.id)));
  const callBaseline = useRef(state.lastCallAt);
  const pending = busy || working;
  const provider = state.config.provider;

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
      setView("verified");
  }, [state.lastCallAt, state.lastCallClientId, view, key]);

  async function run(operation: () => Promise<void>) {
    setWorking(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  function resetSetup() {
    approvalBaseline.current = state.approval?.at;
    baseline.current = new Set(state.clients.map((item) => item.id));
    callBaseline.current = state.lastCallAt;
    setKey(undefined);
    setShowKey(false);
    setCopied(false);
    setName("");
    setView("setup");
  }

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
    (!!key && state.clients.some((item) => item.id === key.id)) ||
    state.clients.some((item) => !baseline.current.has(item.id));
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
      {view === "verified" ? (
        <div className="rm-message-task">
          <div className="rm-client-status success" role="status">
            <CircleCheck size={17} />
            <span>
              {name ? `${name} · ` : ""}
              {t("verifiedState")}
            </span>
          </div>
          <div className="rm-form-actions">
            <button
              type="button"
              className="rm-button primary"
              onClick={onBackToOverview}
            >
              {t("viewAllClients")}
            </button>
            <button type="button" className="rm-button" onClick={resetSetup}>
              <Plus size={15} />
              {t("addClient")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rm-client-toolbar">
            <div
              className="rm-step-tabs"
              role="tablist"
              aria-label={t("clients")}
              onKeyDown={settingsTabKeyDown}
            >
              <button
                type="button"
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
                type="button"
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
                      type="button"
                      aria-pressed={client === "other"}
                      onClick={() => setClient("other")}
                    >
                      <Laptop size={15} />
                      {t("other")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={client === "chatgpt"}
                      onClick={() => setClient("chatgpt")}
                    >
                      ChatGPT
                    </button>
                  </div>
                )}

                {client === "chatgpt" && publicNetwork ? (
                  <ChatgptConnectionGuide
                    endpoint={state.url!}
                    onCopy={onCopy}
                    busy={pending}
                    onExport={onExport}
                    onReady={() => setView("verify")}
                  />
                ) : (
                  <div className="rm-client-recipe">
                    <div className="rm-form-actions">
                      <button
                        type="button"
                        className="rm-button primary"
                        disabled={pending}
                        onClick={() => void run(onCopyPrompt)}
                      >
                        {promptCopied ? (
                          <Check size={15} />
                        ) : (
                          <Copy size={15} />
                        )}
                        <span aria-live="polite">
                          {t(promptCopied ? "copied" : "setupPrompt")}
                        </span>
                      </button>
                    </div>
                    <div className="rm-readonly-row">
                      <span>{t("authentication")}</span>
                      <span className="rm-capability">
                        <KeyRound size={14} />
                        {lan
                          ? "Bearer"
                          : state.config.privateAuth === "device"
                            ? t("sharedDevice")
                            : "OAuth"}
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
                                className="showai-input"
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
                              className="showai-input"
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
                        type="button"
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
                  <button
                    className="rm-button"
                    type="button"
                    onClick={resetSetup}
                  >
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
        <div
          role="alert"
          className="settings-callout rm-error"
          data-tone="error"
        >
          <CircleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
