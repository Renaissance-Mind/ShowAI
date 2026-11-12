import { useEffect, useId, useRef, useState } from "react";
import { AtSign, KeyRound, Loader2, RotateCcw, UserRound } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/accountFlow";
import syncMessages from "../i18n/messages/sync";
import { desktop, errorMessage } from "../host/bridge";
import ServiceLogin from "./ServiceLogin";
import github from "./assets/connection-brands/github.svg";
import google from "./assets/connection-brands/google.svg";

type ServerInfo = { auth: string[]; name?: string; registration?: string };
type Method = "password" | "token" | "github" | "google" | "email";
export const loginMethods = (auth: string[]): Method[] =>
  (["password", "token", "github", "google", "email"] as const).filter(
    (method) => auth.includes(method),
  );

export default function AccountLogin({
  initial,
  invite,
  onConnected,
}: {
  initial: { url: string; account?: string };
  invite?: string;
  onConnected: (id: string, issuedToken?: string) => Promise<void>;
}) {
  const f = useTranslator(messages),
    t = useTranslator(syncMessages);
  const id = useId();
  const [url, setUrl] = useState(initial.url),
    [probe, setProbe] = useState(initial.url),
    [retry, setRetry] = useState(0);
  const [info, setInfo] = useState<ServerInfo>(),
    [checking, setChecking] = useState(true),
    [serverError, setServerError] = useState("");
  const [method, setMethod] = useState<Method>("password"),
    [register, setRegister] = useState(false);
  const [account, setAccount] = useState(initial.account ?? ""),
    [secret, setSecret] = useState(""),
    [registrationKey, setRegistrationKey] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    generation.current++;
    setInfo(undefined);
    setChecking(true);
    setServerError("");
    setSecret("");
    setError("");
    void desktop
      .invoke<ServerInfo>("sync:serverInfo", { url: probe })
      .then(
        (value) => {
          if (!active) return;
          setInfo(value);
          setMethod((current) =>
            value.auth.includes(current)
              ? current
              : (loginMethods(value.auth)[0] ?? "password"),
          );
        },
        (reason) => {
          if (active) setServerError(errorMessage(reason));
        },
      )
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [probe, retry]);
  const methods = info
    ? loginMethods(info.auth)
    : (["password", "token", "github", "google"] as Method[]);
  const ready = !!info && !checking && !serverError && probe === url.trim();
  const labels: Record<Method, string> = {
    password: f("auth.password"),
    token: "Token",
    github: "GitHub",
    google: "Google",
    email: t("methods.email"),
  };
  const icon = (value: Method) =>
    value === "github" || value === "google" ? (
      <img
        className={value === "github" ? "sync-auth-github" : undefined}
        src={value === "github" ? github : google}
        alt=""
        aria-hidden="true"
        width={18}
        height={18}
      />
    ) : value === "password" ? (
      <UserRound size={18} />
    ) : value === "token" ? (
      <KeyRound size={18} />
    ) : (
      <AtSign size={18} />
    );
  function choose(value: Method) {
    setMethod(value);
    setSecret("");
    setError("");
    setRegister(false);
  }
  return (
    <div className="sync-login">
      <label className="sync-field sync-server-field">
        <span>
          {t("serverUrl")}
          {checking && (
            <Loader2
              className="sync-spin"
              size={14}
              aria-label={f("auth.checking")}
            />
          )}
        </span>
        <input
          type="url"
          aria-label={t("serverUrl")}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setSecret("");
            setError("");
          }}
          onBlur={() => setProbe(url.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setProbe(url.trim());
            }
          }}
        />
      </label>
      {serverError && (
        <div className="sync-error" role="alert">
          {serverError}
          <button
            type="button"
            className="studio-icon"
            title={f("auth.retryServer")}
            aria-label={f("auth.retryServer")}
            onClick={() => {
              setProbe(url.trim());
              setRetry((n) => n + 1);
            }}
          >
            <RotateCcw size={17} />
          </button>
        </div>
      )}
      <div
        className="sync-login-tabs"
        role="tablist"
        aria-label={f("auth.methods")}
      >
        {methods.map((value, index) => (
          <button
            key={value}
            id={`${id}-${value}`}
            type="button"
            role="tab"
            aria-selected={method === value}
            aria-controls={`${id}-panel`}
            tabIndex={method === value ? 0 : -1}
            disabled={busy || !ready}
            onClick={() => choose(value)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? methods.length - 1
                    : (index +
                        (e.key === "ArrowRight" ? 1 : -1) +
                        methods.length) %
                      methods.length;
              choose(methods[next]);
              document.getElementById(`${id}-${methods[next]}`)?.focus();
            }}
          >
            {icon(value)}
            <span>{labels[value]}</span>
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${method}`}
        className="sync-login-panel"
      >
        {(["github", "google", "email"] as Method[]).includes(method) ? (
          info &&
          ready && (
            <ServiceLogin
              key={`${probe}:${method}`}
              url={probe}
              provider={method}
              availableMethods={info.auth}
              registrationKey={registrationKey}
              invite={invite}
              onConnected={onConnected}
            />
          )
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const ticket = ++generation.current;
              if (probe !== url.trim()) {
                setProbe(url.trim());
                return;
              }
              setBusy(true);
              setError("");
              void desktop
                .invoke<{ id: string; issuedPersonalToken?: string }>(
                  "sync:connect",
                  {
                    url: probe,
                    account: method === "password" ? account : undefined,
                    password: method === "password" ? secret : undefined,
                    token: method === "token" ? secret : undefined,
                    register: register && method === "password",
                    registrationKey: registrationKey || undefined,
                    invite,
                  },
                )
                .then(async (value) => {
                  if (ticket !== generation.current) return;
                  setSecret("");
                  await onConnected(value.id, value.issuedPersonalToken);
                })
                .catch((reason) => {
                  if (ticket === generation.current)
                    setError(errorMessage(reason));
                })
                .finally(() => {
                  if (ticket === generation.current) setBusy(false);
                });
            }}
          >
            {method === "password" && (
              <label className="sync-field">
                <span>{t("account")}</span>
                <input
                  required
                  autoComplete="username"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <label className="sync-field">
              <span>{method === "token" ? t("token") : t("password")}</span>
              <input
                required
                type="password"
                autoComplete={
                  method === "token"
                    ? "off"
                    : register
                      ? "new-password"
                      : "current-password"
                }
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                disabled={busy}
              />
            </label>
            {register && info?.registration === "controlled" && !invite && (
              <label className="sync-field">
                <span>{t("registrationKey")}</span>
                <input
                  required
                  type="password"
                  value={registrationKey}
                  onChange={(e) => setRegistrationKey(e.target.value)}
                />
              </label>
            )}
            {error && (
              <p className="sync-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="settings-button sync-primary sync-login-submit"
              disabled={busy || !ready}
            >
              {busy
                ? t("processing")
                : f(register ? "auth.registerSubmit" : "auth.submit")}
            </button>
            {method === "password" && info?.registration !== "closed" && (
              <button
                type="button"
                className="sync-text-button"
                disabled={busy}
                onClick={() => {
                  setRegister(!register);
                  setError("");
                }}
              >
                {f(register ? "auth.backToLogin" : "auth.register")}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
