import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sync";
type Flow = {
  id: string;
  pollSecret: string;
  url?: string;
  serverUrl: string;
  provider: string;
  expiresAt: number;
};
export default function ServiceLogin({
  url,
  registrationKey,
  invite,
  onMethods,
  onInfo,
  connectionId,
  onConnected,
}: {
  url: string;
  registrationKey: string;
  invite?: string;
  onMethods?: (methods: string[]) => void;
  /** Server facts such as whether registration needs a key. */
  onInfo?: (info: { auth: string[]; registration?: string }) => void;
  connectionId?: string;
  onConnected: (id: string) => Promise<void>;
}) {
  const t = useTranslator(messages);
  const [methods, setMethods] = useState<string[]>([]),
    [flow, setFlow] = useState<Flow | null>(null);
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [confirming, setConfirming] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  // After a mistyped code: attempts left and a ticking expiry.
  const [remaining, setRemaining] = useState<number | null>(null),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (remaining === null || !flow) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remaining, flow]);
  useEffect(() => {
    setMethods([]);
    setFlow(null);
    setError("");
    if (!url) return;
    // The parent passes the address once it is committed (blur or submit),
    // so typing does not probe the server on every keystroke.
    let cancelled = false;
    void desktop
      .invoke<{ auth: string[]; registration?: string }>("sync:serverInfo", {
        url,
      })
      .then((info) => {
        if (!cancelled) {
          setMethods(info.auth);
          onMethods?.(info.auth);
          onInfo?.(info);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setMethods([]);
          setError(errorMessage(reason));
          onMethods?.([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, invite, connectionId]);
  async function finish(
    current: Flow,
    entered?: { code?: string; completionCode?: string },
  ) {
    const result = await desktop.invoke<{
      status: string;
      connection?: { id: string };
      remainingAttempts?: number;
    }>("sync:finishLogin", {
      url: current.serverUrl,
      id: current.id,
      pollSecret: current.pollSecret,
      ...entered,
    });
    if (result.status === "completed" && result.connection) {
      setFlow(null);
      setConfirming(false);
      await onConnected(result.connection.id);
      return true;
    }
    if (result.status === "confirm") setConfirming(true);
    if (result.status === "invalidCode") {
      setRemaining(result.remainingAttempts ?? null);
      setNow(Date.now());
      setError(t("login.invalidCode"));
      setCode("");
    }
    return false;
  }
  useEffect(() => {
    if (!flow || flow.provider === "email") return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= flow.expiresAt) {
        setError(t("login.expired"));
        setFlow(null);
        return;
      }
      try {
        if (await finish(flow)) return;
      } catch (error) {
        if (!cancelled) {
          setError(errorMessage(error));
          setFlow(null);
        }
        return;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow]);
  async function start(provider: string) {
    setBusy(true);
    setError("");
    setCode("");
    setConfirming(false);
    setRemaining(null);
    try {
      setFlow(
        await desktop.invoke<Flow>("sync:beginLogin", {
          url,
          provider,
          email,
          registrationKey,
          invite,
          connectionId,
        }),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!methods.some((method) => ["github", "google", "email"].includes(method)))
    return error ? (
      <p role="alert" className="sync-error">
        {error}
      </p>
    ) : null;
  return (
    <div className="sync-oauth">
      {connectionId ? (
        <p className="settings-help">{t("login.addMethodHelp")}</p>
      ) : (
        <p className="sync-divider">{t("login.otherMethods")}</p>
      )}
      {error && (
        <p role="alert" className="sync-error">
          {error}
          {remaining !== null && flow && (
            <>
              {" "}
              {t("login.attemptsLeft", {
                count: remaining,
                time: countdown(flow.expiresAt - now),
              })}
            </>
          )}
        </p>
      )}
      {!["email"].includes(flow?.provider ?? "") && (
        <div className="sync-actions">
          {methods.includes("github") && (
            <button
              type="button"
              className="settings-button"
              disabled={busy || !!flow}
              onClick={() => void start("github")}
            >
              {connectionId ? t("login.addGithub") : t("login.github")}
            </button>
          )}
          {methods.includes("google") && (
            <button
              type="button"
              className="settings-button"
              disabled={busy || !!flow}
              onClick={() => void start("google")}
            >
              {connectionId ? t("login.addGoogle") : t("login.google")}
            </button>
          )}
        </div>
      )}
      {flow?.url && !confirming && (
        <p className="settings-help">
          <a href={flow.url} target="_blank" rel="noopener noreferrer">
            {t("login.openAuthPage", {
              provider: flow.provider === "github" ? "GitHub" : "Google",
            })}
          </a>
          {t("login.waiting")}
        </p>
      )}
      {flow?.url && confirming && (
        <div className="sync-inline-field">
          <p className="settings-help">{t("login.completeHelp")}</p>
          <label className="sync-field">
            <span>{t("login.completionCode")}</span>
            <input
              autoComplete="one-time-code"
              maxLength={9}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </label>
          <button
            type="button"
            className="settings-button"
            disabled={busy || code.replace(/[\s-]/g, "").length !== 8}
            onClick={() => {
              setBusy(true);
              setError("");
              void finish(flow, { completionCode: code })
                .catch((error) => {
                  setError(errorMessage(error));
                  setFlow(null);
                  setConfirming(false);
                })
                .finally(() => setBusy(false));
            }}
          >
            {t("login.complete")}
          </button>
        </div>
      )}
      {methods.includes("email") && !flow && (
        <div className="sync-inline-field">
          <label className="sync-field">
            <span>{t("login.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
          <button
            type="button"
            className="settings-button"
            disabled={busy || !email}
            onClick={() => void start("email")}
          >
            {t("login.sendCode")}
          </button>
        </div>
      )}
      {flow?.provider === "email" && (
        <div className="sync-inline-field">
          <label className="sync-field">
            <span>{t("login.code")}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="settings-button"
            disabled={busy || !/^\d{8}$/.test(code)}
            onClick={() => {
              setBusy(true);
              setError("");
              void finish(flow, { code })
                .catch((error) => setError(errorMessage(error)))
                .finally(() => setBusy(false));
            }}
          >
            {t("login.confirmEmail")}
          </button>
        </div>
      )}
      {flow && (
        <button
          type="button"
          className="sync-text-button"
          onClick={() => {
            setFlow(null);
            setCode("");
            setConfirming(false);
            setRemaining(null);
            setError("");
          }}
        >
          {t("login.cancel")}
        </button>
      )}
    </div>
  );
}

function countdown(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
