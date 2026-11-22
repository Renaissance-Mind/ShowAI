import { ArrowRight, ExternalLink, KeyRound, FileDown } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteConnections";
import originalMessages from "../i18n/messages/remoteMcp";
import { oauthSetupValues } from "../remote-mcp/client-setup";
import { RemoteCopyField } from "./RemoteConnectionControls";

export default function ChatgptConnectionGuide({
  endpoint,
  onCopy,
  onReady,
  onExport,
  busy,
}: {
  endpoint: string;
  onCopy(value: string): Promise<void>;
  onReady(): void;
  onExport(): void;
  busy: boolean;
}) {
  const t = useTranslator(messages),
    r = useTranslator(originalMessages),
    values = oauthSetupValues(endpoint);
  return (
    <div className="rm-client-recipe">
      <div className="rm-client-fields">
        <RemoteCopyField
          label={r("formName")}
          value={r("formNameValue")}
          onCopy={onCopy}
        />
        <RemoteCopyField label={t("endpoint")} value={endpoint} onCopy={onCopy} />
      </div>
      <div className="rm-readonly-row">
        <span>{t("authentication")}</span>
        <span className="rm-capability">
          <KeyRound size={14} />
          OAuth<span className="rm-tag">{t("dynamicRegistration")}</span>
        </span>
      </div>
      <section className="rm-oauth-fields">
        <h4 className="settings-section-heading">{t("oauthEndpoints")}</h4>
        {(["authorization", "token", "registration"] as const).map((key) => (
          <RemoteCopyField
            key={key}
            label={r(
              (
                {
                  authorization: "oauthAuthorization",
                  token: "oauthToken",
                  registration: "oauthRegistration",
                } as const
              )[key],
            )}
            value={values[key]}
            onCopy={onCopy}
          />
        ))}
      </section>
      <div className="rm-form-actions">
        <a
          className="rm-button"
          href="https://chatgpt.com/plugins"
          target="_blank"
          rel="noreferrer"
        >
          {t("openChatgptSettings")}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <button
          type="button"
          className="rm-button"
          disabled={busy}
          onClick={onExport}
        >
          <FileDown size={14} aria-hidden="true" />
          {t("exportChatgptPlugin")}
        </button>
        <button className="rm-button primary" disabled={busy} onClick={onReady}>
          {t("nextMessage")}
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
