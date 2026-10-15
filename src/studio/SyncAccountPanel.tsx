import { useEffect, useState } from "react";
import { Copy, Monitor } from "../ui/icons";
import { desktop } from "./bridge";
import ServiceLogin from "./ServiceLogin";
import LoginMethods from "./LoginMethods";
import type { ServerConnection } from "../sync/protocol";
import { getLocale } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sync";
import common from "../i18n/messages/common";
import flowMessages from "../i18n/messages/accountFlow";

type Session = {
  digest: string;
  device: string;
  created_at: string;
  expires_at: string;
  revoked: number;
  current?: number;
};

/** Account and device management for one server connection, shown inside its card. */
export default function SyncAccountPanel({
  connection,
  busy,
  syncedProjects,
  run,
  notify,
  onSignedOut,
  onRemoved,
}: {
  connection: Omit<ServerConnection, "token">;
  busy: boolean;
  syncedProjects: number;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  notify: (message: string) => void;
  onSignedOut: () => void;
  onRemoved: () => void;
}) {
  const t = useTranslator(messages);
  const f = useTranslator(flowMessages);
  const tc = useTranslator(common);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [passwords, setPasswords] = useState({ current: "", next: "" });
  const [personal, setPersonal] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<"signOut" | "remove" | null>(null);
  const [methodsRevision, setMethodsRevision] = useState(0);
  const secure = !!connection.capabilities?.includes("account-security-v1");
  const loadSessions = async () =>
    setSessions(
      await desktop.invoke<Session[]>("sync:sessions", {
        connectionId: connection.id,
      }),
    );
  useEffect(() => {
    void run(loadSessions);
  }, [connection.id]);
  const date = (value: string) =>
    new Date(value).toLocaleString(getLocale(), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div
      className="sync-account-panel"
      role="region"
      aria-label={t("accountPanelFor", { name: connection.user.name })}
    >
      <section className="sync-account-block">
        <p className="settings-help">{f("signOutHelp")}</p>
        <button className="settings-button" disabled={busy} onClick={() => void run(async () => {
          await desktop.invoke("sync:signOut", { connectionId: connection.id });
          onRemoved();
          notify(f("signedOut"));
        })}>{f("signOut")}</button>
      </section>
      <section className="sync-account-block">
        <h4>{t("account.methods")}</h4>
        <LoginMethods connectionId={connection.id} revision={methodsRevision} />
        <ServiceLogin
          url={connection.url}
          connectionId={connection.id}
          registrationKey=""
          onConnected={async () => {
            setMethodsRevision((value) => value + 1);
            await loadSessions();
            notify(t("toast.loginMethodAdded"));
          }}
        />
        {secure && (
          <details className="sync-account-disclosure">
            <summary>{t("changePassword")}</summary>
            <p className="settings-help">{t("changePasswordHelp")}</p>
            <form
              className="sync-field-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await desktop.invoke("sync:changePassword", {
                    connectionId: connection.id,
                    currentPassword: passwords.current,
                    newPassword: passwords.next,
                  });
                  setPasswords({ current: "", next: "" });
                  await loadSessions();
                  notify(t("toast.passwordChanged"));
                });
              }}
            >
              <label className="sync-field">
                <span>{t("currentPassword")}</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={passwords.current}
                  onChange={(event) =>
                    setPasswords({ ...passwords, current: event.target.value })
                  }
                />
              </label>
              <label className="sync-field">
                <span>{t("newPassword")}</span>
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={1024}
                  placeholder={t("passwordMinLength")}
                  autoComplete="new-password"
                  value={passwords.next}
                  onChange={(event) =>
                    setPasswords({ ...passwords, next: event.target.value })
                  }
                />
              </label>
              <div className="sync-form-actions">
                <button
                  className="settings-button sync-primary"
                  disabled={busy}
                  type="submit"
                >
                  {t("saveNewPassword")}
                </button>
              </div>
            </form>
          </details>
        )}
      </section>
      <section className="sync-account-block">
        <div className="sync-block-heading">
          <div>
            <h4>{t("personalToken")}</h4>
            <p className="settings-help">{t("personalTokenHelp")}</p>
          </div>
          <button
            className="settings-button"
            disabled={busy || !!personal}
            onClick={() =>
              void run(async () =>
                setPersonal(
                  await desktop.invoke("sync:createToken", {
                    connectionId: connection.id,
                  }),
                ),
              )
            }
          >
            {t("createPersonalToken")}
          </button>
        </div>
        {personal && (
          <IssuedToken
            token={personal.token}
            detail={t("tokenValidity", {
              date: new Date(personal.expiresAt).toLocaleDateString(
                getLocale(),
              ),
            })}
            busy={busy}
            run={run}
            onDone={() => setPersonal(null)}
          />
        )}
      </section>
      <section className="sync-account-block">
        <h4>{t("account.sessions")}</h4>
        <p className="settings-help">{t("deviceSessionsHelp")}</p>
        {!sessions && <p className="settings-help">{t("processing")}</p>}
        <ul className="sync-session-list">
          {sessions?.map((session) => {
            const expired =
              new Date(session.expires_at).getTime() <= Date.now();
            return (
              <li key={session.digest}>
                <Monitor size={16} aria-hidden="true" />
                <div>
                  <strong>
                    {session.device}
                    {!!session.current && (
                      <span className="sync-badge">
                        {t("session.thisDevice")}
                      </span>
                    )}
                  </strong>
                  <span>
                    {t("session.signedIn", { date: date(session.created_at) })}
                    {" · "}
                    {session.revoked
                      ? t("session.revoked")
                      : expired
                        ? t("session.expired")
                        : t("session.validUntil", {
                            date: date(session.expires_at),
                          })}
                  </span>
                </div>
                {!session.revoked && !expired && (
                  <button
                    className="sync-text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await desktop.invoke("sync:revokeToken", {
                          connectionId: connection.id,
                          digest: session.digest,
                        });
                        if (session.current) {
                          notify(t("toast.sessionRevoked"));
                          onSignedOut();
                        } else await loadSessions();
                      })
                    }
                  >
                    {t("signOutDevice")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="sync-account-block sync-account-danger">
        <h4>{t("account.danger")}</h4>
        {secure && (
          <div className="sync-danger-row">
            <div>
              <strong>{t("signOutAll")}</strong>
              <p className="settings-help">{t("signOutAllHelp")}</p>
            </div>
            <button
              className="settings-button sync-danger"
              disabled={busy}
              onClick={() => setConfirm("signOut")}
            >
              {t("signOutAll")}
            </button>
          </div>
        )}
        <div className="sync-danger-row">
          <div>
            <strong>{t("removeConnection")}</strong>
            <p className="settings-help">
              {syncedProjects
                ? t("removeConnectionBlocked", { count: syncedProjects })
                : t("removeConnectionHelp")}
            </p>
          </div>
          <button
            className="settings-button sync-danger"
            disabled={busy || syncedProjects > 0}
            onClick={() => setConfirm("remove")}
          >
            {t("removeConnection")}
          </button>
        </div>
        {confirm && (
          <div
            className="sync-inline-confirm"
            role="group"
            aria-label={
              confirm === "signOut"
                ? t("confirmSignOutAll")
                : t("confirmRemoveConnection")
            }
          >
            <p>
              {confirm === "signOut"
                ? t("signOutAllQuestion")
                : t("removeConnectionQuestion", { name: connection.name })}
            </p>
            <div>
              <button
                className="settings-button"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                {tc("cancel")}
              </button>
              <button
                className="settings-button sync-danger-fill"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (confirm === "remove") {
                      await desktop.invoke("sync:disconnect", {
                        connectionId: connection.id,
                      });
                      onRemoved();
                      return;
                    }
                    const result = await desktop.invoke<{
                      unreachable: string[];
                    }>("sync:revokeAllTokens", { connectionId: connection.id });
                    notify(
                      result.unreachable.length
                        ? t("toast.signedOutAllPartial", {
                            servers: result.unreachable.join(", "),
                          })
                        : t("toast.signedOutAll"),
                    );
                    onSignedOut();
                  })
                }
              >
                {confirm === "signOut"
                  ? t("confirmSignOutAll")
                  : t("confirmRemoveConnection")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** A newly issued secret, shown once with an explicit copy action. */
export function IssuedToken({
  token,
  detail,
  busy,
  run,
  onDone,
}: {
  token: string;
  detail?: string;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onDone: () => void;
}) {
  const t = useTranslator(messages);
  const [copied, setCopied] = useState(false);
  return (
    <div className="sync-issued-token" role="group" aria-label={t("newToken")}>
      <p>
        <strong>{t("tokenOnceWarning")}</strong>
        {detail && <span>{detail}</span>}
      </p>
      <div>
        <input
          type="password"
          readOnly
          aria-label={t("newToken")}
          autoComplete="off"
          value={token}
          onFocus={(event) => event.target.select()}
        />
        <button
          className="settings-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await desktop.invoke("clipboard:write", { text: token });
              setCopied(true);
            })
          }
        >
          <Copy size={14} aria-hidden="true" />
          {copied ? t("tokenCopied") : t("copyToken")}
        </button>
        <button className="settings-button" onClick={onDone}>
          {t("tokenSaved")}
        </button>
      </div>
    </div>
  );
}
