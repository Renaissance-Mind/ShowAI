import { useState } from "react";
import { Copy } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteMcp";
import { oauthSetupValues } from "../remote-mcp/client-setup";
import Dialog from "./Dialog";

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
  const [discovery, setDiscovery] = useState(false);
  const [copied, setCopied] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const values = oauthSetupValues(endpoint);
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
            {copied === label ? t("copied") : <Copy size={13} />}
          </button>
        )}
      </dd>
    </div>
  );
  return (
    <div className="remote-chatgpt-guide">
      <h4>{t("formTitle")}</h4>
      <p>{t("formPath")}</p>
      <dl>
        {row(t("formName"), t("formNameValue"), true)}
        {row(t("formConnection"), t("formConnectionValue"))}
        {row(t("endpoint"), endpoint, true)}
        {row(t("formAuthentication"), "OAuth")}
        {row(t("formRegistration"), t("formRegistrationValue"))}
        {row(t("formClientCredentials"), t("formClientCredentialsValue"))}
        {row(t("formScopes"), t("formScopesValue"))}
        {row(t("formBaseScope"), t("formBlank"))}
      </dl>
      <p>{t("formConnectionHint")}</p>
      <p>{t("formNameHint")}</p>
      <button className="settings-button" onClick={() => setDiscovery(true)}>
        {t("discoveryHelp")}
      </button>
      <p>{t("createPluginStep")}</p>
      <p>{t("closedLinking")}</p>
      <button className="settings-button primary" onClick={onReady}>
        {t("authPageReady")}
      </button>
      {error && <p role="alert">{error}</p>}
      {discovery && (
        <Dialog title={t("discoveryTitle")} onClose={() => setDiscovery(false)}>
          <div className="remote-chatgpt-guide">
            <p>{t("discoveryRetry")}</p>
            <p>{t("discoveryExpected")}</p>
            <p>{t("discoveryNetwork")}</p>
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => {
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
            <p>{t("discoveryManual")}</p>
            <dl>
              {row(t("oauthAuthorization"), values.authorization, true)}
              {row(t("oauthToken"), values.token, true)}
              {row(t("oauthRegistration"), values.registration, true)}
              {row(t("oauthIssuer"), values.issuer, true)}
              {row(t("oauthResource"), values.resource, true)}
            </dl>
            <p>{t("oauthPkce")}</p>
            <p>{t("formUnavailable")}</p>
            {error && <p role="alert">{error}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
