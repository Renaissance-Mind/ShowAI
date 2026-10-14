import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sync";
type LoginMethod = {
  provider: string;
  subject: string;
  email: string | null;
  created_at: string;
};
/** Bound external login methods, so an unfamiliar one can be removed. */
export default function LoginMethods({
  connectionId,
  revision,
}: {
  connectionId: string;
  revision: number;
}) {
  const t = useTranslator(messages);
  const providers: Record<string, string> = {
    github: "GitHub",
    google: "Google",
    email: t("methods.email"),
  };
  const [methods, setMethods] = useState<LoginMethod[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setMethods(
      await desktop.invoke<LoginMethod[]>("sync:loginMethods", {
        connectionId,
      }),
    );
  }
  useEffect(() => {
    setError("");
    // Servers without login method management simply hide this list.
    void load().catch(() => setMethods(null));
  }, [connectionId, revision]);
  if (!methods?.length) return null;
  return (
    <div>
      <h3>{t("methods.title")}</h3>
      <p className="settings-help">{t("methods.help")}</p>
      {error && (
        <p role="alert" className="sync-error">
          {error}
        </p>
      )}
      {methods.map((method) => (
        <div
          className="sync-connection"
          key={`${method.provider}:${method.subject}`}
        >
          <div className="settings-row-text">
            <h3>
              {providers[method.provider] ?? method.provider}
              {method.email ? ` · ${method.email}` : ` · #${method.subject}`}
            </h3>
            <p>
              {t("methods.added", {
                date: new Date(method.created_at).toLocaleString(),
              })}
            </p>
          </div>
          <button
            type="button"
            className="settings-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void desktop
                .invoke("sync:removeLoginMethod", {
                  connectionId,
                  provider: method.provider,
                  subject: method.subject,
                })
                .then(load)
                .catch((error) => setError(errorMessage(error)))
                .finally(() => setBusy(false));
            }}
          >
            {t("methods.remove")}
          </button>
        </div>
      ))}
    </div>
  );
}
