import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, ExternalLink } from "../ui/icons";
import { desktop, errorMessage } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteMcp";
import { isPublicProvider } from "../remote-mcp/client-setup";
import type { RemoteMcpStatus } from "../remote-mcp/types";
import ChatgptConnectionGuide from "./ChatgptConnectionGuide";

export default function RemoteMcpClientSetup({
  state,
  busy,
  onCopy,
  onCheck,
  onExport,
  exported,
  revokedClientId,
}: {
  state: RemoteMcpStatus;
  busy: boolean;
  onCopy: (text: string) => Promise<void>;
  onCheck: () => Promise<boolean>;
  onExport: () => Promise<void>;
  exported: boolean;
  revokedClientId: string;
}) {
  const t = useTranslator(messages);
  const lan = state.config.provider === "lan";
  const publicNetwork = isPublicProvider(state.config.provider);
  const [client, setClient] = useState<"chatgpt" | "other" | undefined>(
    publicNetwork ? undefined : "other",
  );
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [key, setKey] = useState<{
    id: string;
    token: string;
    expiresAt: string;
  }>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const pending = busy || working;
  useEffect(() => {
    if (key && revokedClientId === key.id) {
      setKey(undefined);
      setStep(0);
    }
  }, [revokedClientId, key]);
  async function run(operation: () => Promise<void>) {
    setWorking(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking(false);
    }
  }
  async function copy(value: string, field: string) {
    await onCopy(value);
    setCopied(field);
  }
  const row = (label: string, value: string, copyable = false) => (
    <div className="remote-field-guide" key={label}>
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        {copyable && (
          <button
            className="settings-button"
            disabled={pending}
            aria-label={t("copyField", { name: label })}
            onClick={() => void run(() => copy(value, label))}
          >
            {copied === label ? t("copied") : <Copy size={14} />}
          </button>
        )}
      </dd>
    </div>
  );
  return (
    <div className="remote-client-setup" aria-busy={pending}>
      {!client ? (
        <>
          <h4>{t("clientChoice")}</h4>
          <div className="remote-methods">
            <button onClick={() => setClient("other")}>
              <span>
                <strong>{t("otherClient")}</strong>
                <small>{t("otherClientHint")}</small>
              </span>
              <ArrowRight size={18} />
            </button>
            <button onClick={() => setClient("chatgpt")}>
              <span>
                <strong>ChatGPT</strong>
                <small>{t("chatgptHint")}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          </div>
        </>
      ) : (
        <>
          {publicNetwork && (
            <button
              className="remote-back"
              disabled={pending}
              onClick={() => {
                setClient(undefined);
                setStep(0);
              }}
            >
              <ArrowLeft size={14} />
              {t("changeClient")}
            </button>
          )}
          {step === 0 && client === "chatgpt" ? (
            <ChatgptConnectionGuide
              endpoint={state.url!}
              busy={pending}
              onCopy={onCopy}
              onCheck={onCheck}
              onReady={() => setStep(1)}
            />
          ) : (
            <div className="remote-chatgpt-guide">
              <h4>{t(step === 0 ? "addServer" : "verifyConnection")}</h4>
              {step === 0 && (
                <>
                  <dl>
                    {row(t("endpoint"), state.url!, true)}
                    {row(t("transport"), "Streamable HTTP")}
                    {row(
                      t("formAuthentication"),
                      lan ? t("accessKeyAuth") : "OAuth",
                    )}
                  </dl>
                  {lan ? (
                    <form
                      className="remote-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                          const receipt = await desktop.invoke<{
                            id: string;
                            token: string;
                            expiresAt: string;
                          }>("remoteMcp:createAccessKey", { name });
                          setKey(receipt);
                          await copy(receipt.token, "key");
                        });
                      }}
                    >
                      {!key ? (
                        <>
                          <label>
                            {t("clientName")}
                            <input
                              required
                              maxLength={100}
                              placeholder={t("clientNamePlaceholder")}
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                            />
                          </label>
                          <button
                            className="settings-button primary"
                            disabled={pending || !name.trim()}
                            type="submit"
                          >
                            {t("createAccessKey")}
                          </button>
                        </>
                      ) : (
                        <>
                          <label>
                            {t("accessKey")}
                            <div className="remote-secret">
                              <input
                                type="password"
                                readOnly
                                value={key.token}
                              />
                              <button
                                className="settings-button"
                                type="button"
                                onClick={() =>
                                  void run(() => copy(key.token, "key"))
                                }
                              >
                                {t(copied === "key" ? "copied" : "copyKey")}
                              </button>
                            </div>
                          </label>
                          <p>{t("accessKeyInstructions")}</p>
                          <button
                            className="settings-button primary"
                            disabled={pending}
                            type="button"
                            onClick={() => setStep(1)}
                          >
                            {t("addedKey")}
                            <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    </form>
                  ) : (
                    <>
                      <p>{t("otherOAuth")}</p>
                      <div className="remote-guide-actions">
                        <button
                          className="settings-button primary"
                          onClick={() => setStep(1)}
                        >
                          {t("addedOther")}
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              {step === 1 && (
                <>
                  {!lan && <p>{t("approveClient")}</p>}
                  <p>
                    {t(
                      client === "chatgpt"
                        ? "verifyInstructions"
                        : "verifyOther",
                    )}
                  </p>
                  <div className="remote-primary-row">
                    <button
                      className="settings-button primary"
                      onClick={() =>
                        void run(() => copy(t("verifyPrompt"), "prompt"))
                      }
                    >
                      {t(copied === "prompt" ? "copied" : "copyPrompt")}
                    </button>
                    <button
                      className="remote-secondary"
                      onClick={() => setStep(0)}
                    >
                      {t("backToSetup")}
                    </button>
                  </div>
                  <p role="status">{t("waiting")}</p>
                  {!lan && (
                    <details>
                      <summary>{t("authWindowExpired")}</summary>
                      <p>{t("authWindowRecovery")}</p>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
          {client === "chatgpt" && (
            <details className="remote-plugin-option">
              <summary>{t("optionalSkills")}</summary>
              <button
                className="settings-button"
                disabled={pending}
                onClick={() => void run(onExport)}
              >
                {t(exported ? "exportAgain" : "exportPlugin")}
              </button>
              {exported && (
                <a
                  className="settings-button"
                  href="https://chatgpt.com/plugins"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("importPlugin")}
                  <ExternalLink size={14} />
                </a>
              )}
              {exported && <p>{t("importStep")}</p>}
            </details>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
