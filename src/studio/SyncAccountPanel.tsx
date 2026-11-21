import { useEffect, useState } from "react";
import { Copy, Monitor } from "../ui/icons";
import Dialog from "../ui/Dialog";
import { desktop } from "../host/bridge";
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
      className="sync-account-panel-groups"
      role="region"
      aria-label={t("accountPanelFor", { name: connection.user.name })}
    >
      <section className="settings-group">
        <h2>{t("account.methods")}</h2>
        <div className="settings-card">
          <div className="settings-card-section">
            <LoginMethods
              connectionId={connection.id}
              revision={methodsRevision}
            />
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
          </div>
          {secure && (
            <div className="settings-card-section">
              <div className="settings-row-text">
                <h3>{t("changePassword")}</h3>
                <p>{t("changePasswordHelp")}</p>
              </div>
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
                    className="showai-input"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={passwords.current}
                    onChange={(event) =>
                      setPasswords({
                        ...passwords,
                        current: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="sync-field">
                  <span>{t("newPassword")}</span>
                  <input
                    className="showai-input"
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
                    className="settings-button settings-primary-button"
                    disabled={busy}
                    type="submit"
                  >
                    {t("saveNewPassword")}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </section>

      <section className="settings-group">
        <h2>{t("personalToken")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{t("personalToken")}</h3>
              <p>{t("personalTokenHelp")}</p>
            </div>
            <button
              type="button"
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
        </div>
      </section>

      {personal && (
        <Dialog title={t("personalToken")} onClose={() => setPersonal(null)}>
          <div className="studio-dialog-body">
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
          </div>
        </Dialog>
      )}

      <section className="settings-group">
        <div className="settings-group-heading">
          <div>
            <h2>{t("account.sessions")}</h2>
            <p className="settings-group-desc">{t("deviceSessionsHelp")}</p>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card-section">
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
                          <span className="settings-badge" data-tone="accent">
                            {t("session.thisDevice")}
                          </span>
                        )}
                      </strong>
                      <span>
                        {t("session.signedIn", {
                          date: date(session.created_at),
                        })}
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
                        type="button"
                        className="settings-button settings-danger-button"
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
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h2>{t("account.danger")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{f("signOut")}</h3>
              <p>{f("signOutHelp")}</p>
            </div>
            <button
              type="button"
              className="settings-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await desktop.invoke("sync:signOut", {
                    connectionId: connection.id,
                  });
                  onRemoved();
                  notify(f("signedOut"));
                })
              }
            >
              {f("signOut")}
            </button>
          </div>
          {secure && (
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>{t("signOutAll")}</h3>
                <p>{t("signOutAllHelp")}</p>
              </div>
              <button
                type="button"
                className="settings-button settings-danger-button"
                disabled={busy}
                onClick={() => setConfirm("signOut")}
              >
                {t("signOutAll")}
              </button>
            </div>
          )}
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{t("removeConnection")}</h3>
              <p>
                {syncedProjects
                  ? t("removeConnectionBlocked", { count: syncedProjects })
                  : t("removeConnectionHelp")}
              </p>
            </div>
            <button
              type="button"
              className="settings-button settings-danger-button"
              disabled={busy || syncedProjects > 0}
              onClick={() => setConfirm("remove")}
            >
              {t("removeConnection")}
            </button>
          </div>
        </div>
      </section>

      {confirm && (
        <Dialog
          tone="danger"
          title={
            confirm === "signOut"
              ? t("confirmSignOutAll")
              : t("confirmRemoveConnection")
          }
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <div className="studio-dialog-body studio-dialog-form">
            <p className="settings-help">
              {confirm === "signOut"
                ? t("signOutAllQuestion")
                : t("removeConnectionQuestion", { name: connection.name })}
            </p>
            <div className="studio-dialog-actions">
              <button
                type="button"
                className="settings-button"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                {tc("cancel")}
              </button>
              <button
                type="button"
                className="settings-button sync-danger-fill"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (confirm === "remove") {
                      await desktop.invoke("sync:disconnect", {
                        connectionId: connection.id,
                      });
                      setConfirm(null);
                      onRemoved();
                      return;
                    }
                    const result = await desktop.invoke<{
                      unreachable: string[];
                    }>("sync:revokeAllTokens", {
                      connectionId: connection.id,
                    });
                    notify(
                      result.unreachable.length
                        ? t("toast.signedOutAllPartial", {
                            servers: result.unreachable.join(", "),
                          })
                        : t("toast.signedOutAll"),
                    );
                    setConfirm(null);
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
        </Dialog>
      )}
    </div>
  );
}

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
          className="showai-input"
          type="password"
          readOnly
          aria-label={t("newToken")}
          autoComplete="off"
          value={token}
          onFocus={(event) => event.target.select()}
        />
        <button
          type="button"
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
        <button type="button" className="settings-button" onClick={onDone}>
          {t("tokenSaved")}
        </button>
      </div>
    </div>
  );
}
