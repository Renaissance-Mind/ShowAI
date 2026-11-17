import { useState } from "react";
import { ArrowRight, ExternalLink, KeyRound, ChevronDown } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteConnections";
import originalMessages from "../i18n/messages/remoteMcp";
import { oauthSetupValues } from "../remote-mcp/client-setup";
import { RemoteCopyField } from "./RemoteConnectionControls";

export default function ChatgptConnectionGuide({
  endpoint,
  onCopy,
  onReady,
  busy,
}: {
  endpoint: string;
  onCopy(value: string): Promise<void>;
  onReady(): void;
  busy: boolean;
}) {
  const t = useTranslator(messages),
    r = useTranslator(originalMessages),
    [advanced, setAdvanced] = useState(false),
    values = oauthSetupValues(endpoint);
  return (
    <div className="rm-client-recipe">
      <RemoteCopyField
        label={r("formName")}
        value={r("formNameValue")}
        onCopy={onCopy}
      />
      <RemoteCopyField label={t("endpoint")} value={endpoint} onCopy={onCopy} />
      <div className="rm-readonly-row">
        <span>{t("authentication")}</span>
        <span className="rm-capability">
          <KeyRound size={14} />
          OAuth<span className="rm-tag">{t("dynamicRegistration")}</span>
        </span>
      </div>
      <button
        type="button"
        className="rm-disclosure"
        aria-expanded={advanced}
        onClick={() => setAdvanced((value) => !value)}
      >
        {t("oauthEndpoints")}
        <ChevronDown size={14} />
      </button>
      {advanced && (
        <div className="rm-inset">
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
        </div>
      )}
      <div className="rm-form-actions">
        <a
          className="rm-button"
          href="https://chatgpt.com/plugins"
          target="_blank"
          rel="noreferrer"
        >
          {t("openChatgpt")}
          <ExternalLink size={14} />
        </a>
        <button className="rm-button primary" disabled={busy} onClick={onReady}>
          {t("nextMessage")}
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
