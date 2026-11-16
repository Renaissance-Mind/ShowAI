import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, ExternalLink } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteMcp";
import { oauthSetupValues } from "../remote-mcp/client-setup";
import Dialog from "../ui/Dialog";

export default function ChatgptConnectionGuide({
  endpoint,
  onCopy,
  onCheck,
  onReady,
  busy,
}: {
  endpoint: string;
  onCopy: (text: string) => Promise<void>;
  onCheck: () => Promise<boolean>;
  onReady: () => void;
  busy: boolean;
}) {
  const t = useTranslator(messages);
  const [step, setStep] = useState(0);
  const [discovery, setDiscovery] = useState(false);
  const [copied, setCopied] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const values = oauthSetupValues(endpoint);
  function move(next: number) {
    setStep(next);
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function copy(label: string, value: string) {
    setError("");
    try {
      await onCopy(value);
      setCopied(label);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  const row = (label: string, value: string, copyable = false) => (
    <div className="remote-field-guide" key={label}>
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        {copyable && (
          <button
            className="settings-button"
            disabled={busy}
            aria-label={t("copyField", { name: label })}
            onClick={() => void copy(label, value)}
          >
            {copied === label ? t("copied") : <Copy size={14} />}
          </button>
        )}
      </dd>
    </div>
  );
  return (
    <div className="remote-chatgpt-guide">
      <ol className="remote-client-progress" aria-label={t("chatgptClient")}>
        {(["chatgptServer", "chatgptOAuth", "chatgptConnect"] as const).map(
          (key, index) => (
            <li
              key={key}
              aria-current={step === index ? "step" : undefined}
              data-done={index < step}
            >
              {index + 1} · {t(key)}
            </li>
          ),
        )}
      </ol>
      <h4 ref={heading} tabIndex={-1}>
        {t(
          (
            [
              "chatgptServerTitle",
              "chatgptOAuthTitle",
              "chatgptConnectTitle",
            ] as const
          )[step],
        )}
      </h4>
      {step === 0 && (
        <>
          <a
            className="settings-button remote-action"
            href="https://chatgpt.com/plugins"
            target="_blank"
            rel="noreferrer"
          >
            {t("openChatgpt")}
            <ExternalLink size={14} />
          </a>
          <p>{t("formPath")}</p>
          <dl>
            {row(t("formName"), t("formNameValue"), true)}
            {row(t("formConnection"), t("formConnectionValue"))}
            {row(t("endpoint"), endpoint, true)}
            {row(t("formAuthentication"), "OAuth")}
          </dl>
        </>
      )}
      {step === 1 && (
        <>
          <dl>
            {row(t("formRegistration"), t("formRegistrationValue"))}
            {row(t("formClientCredentials"), t("formClientCredentialsValue"))}
            {row(t("formScopes"), t("formScopesValue"))}
            {row(t("formBaseScope"), t("formBlank"))}
          </dl>
          <button
            className="remote-secondary"
            onClick={() => setDiscovery(true)}
          >
            {t("discoveryHelp")}
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <ol className="remote-instructions">
            <li>{t("chatgptCreate")}</li>
            <li>{t("chatgptOpenAuthorization")}</li>
          </ol>
          <details>
            <summary>{t("connectionAlreadyExists")}</summary>
            <p>{t("closedLinking")}</p>
            <p>{t("formNameHint")}</p>
          </details>
        </>
      )}
      <div className="remote-guide-actions">
        {step > 0 && (
          <button
            className="settings-button"
            disabled={busy}
            onClick={() => move(step - 1)}
          >
            <ArrowLeft size={14} />
            {t("previous")}
          </button>
        )}
        <button
          className="settings-button primary"
          disabled={busy}
          onClick={() => (step < 2 ? move(step + 1) : onReady())}
        >
          {t(step === 2 ? "authPageReady" : "next")}
          <ArrowRight size={14} />
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {discovery && (
        <Dialog title={t("discoveryTitle")} onClose={() => setDiscovery(false)}>
          <div className="remote-chatgpt-guide">
            <p>{t("discoveryRetry")}</p>
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => {
                setChecked(false);
                setError("");
                void onCheck()
                  .then(setChecked)
                  .catch((reason) =>
                    setError(
                      reason instanceof Error ? reason.message : String(reason),
                    ),
                  );
              }}
            >
              {t("recheckService")}
            </button>
            {checked && <p role="status">{t("recheckDone")}</p>}
            <details>
              <summary>{t("manualOAuthValues")}</summary>
              <dl>
                {row(t("oauthAuthorization"), values.authorization, true)}
                {row(t("oauthToken"), values.token, true)}
                {row(t("oauthRegistration"), values.registration, true)}
                {row(t("oauthIssuer"), values.issuer, true)}
                {row(t("oauthResource"), values.resource, true)}
              </dl>
              <p>{t("oauthPkce")}</p>
            </details>
            {error && <p role="alert">{error}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
