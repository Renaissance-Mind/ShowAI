import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import type { AccountProfile } from "../sync/accounts";
import type { ServerConnection } from "../sync/protocol";
import type { ProjectSummary } from "../core/model";
import { getLocale } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sync";
export default function AccountBindings({
  connections,
  projects,
  hidden,
  refresh,
}: {
  connections: Omit<ServerConnection, "token">[];
  projects: ProjectSummary[];
  hidden: string[];
  refresh: () => Promise<void>;
}) {
  const t = useTranslator(messages);
  const [source, setSource] = useState(""),
    [target, setTarget] = useState(""),
    [profile, setProfile] = useState<AccountProfile | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [personal, setPersonal] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const enabled = connections.filter((item) =>
    item.capabilities?.includes("account-federation-v1"),
  );
  useEffect(() => {
    if (!source && enabled.length) setSource(enabled[0].id);
  }, [source, connections]);
  async function load(id = source) {
    setProfile(
      id
        ? await desktop.invoke<AccountProfile>("sync:accountProfile", {
            connectionId: id,
          })
        : null,
    );
  }
  useEffect(() => {
    setPersonal(null);
    void load().catch((error) => setError(errorMessage(error)));
  }, [source]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      await load();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const options = enabled.map((item) => (
    <option key={item.id} value={item.id}>
      {item.name} · {item.user.name}
    </option>
  ));
  return (
    <>
      <section className="settings-group">
        <h2>{t("accountBindings")}</h2>
        <p className="settings-help">{t("accountBindingsHelp")}</p>
        {error && (
          <p role="alert" className="sync-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="sync-message">
            {message}
          </p>
        )}
        {enabled.length ? (
          <>
            <div className="settings-row">
              <label>
                {t("currentAccount")}{" "}
                <select
                  aria-label={t("bindSourceAccount")}
                  disabled={busy}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  <option value="">{t("chooseAccount")}</option>
                  {options}
                </select>
              </label>
              <button
                className="settings-button"
                disabled={busy || !source}
                onClick={() =>
                  void run(async () => {
                    const result = await desktop.invoke<{
                      pending: unknown[];
                      errors: Record<string, string>;
                    }>("sync:restoreAccounts", { connectionId: source });
                    setMessage(
                      Object.keys(result.errors).length
                        ? t("toast.restoredPartial")
                        : t("toast.restoredAll"),
                    );
                  })
                }
              >
                {t("restoreLinkedServices")}
              </button>
            </div>
            <form
              className="sync-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await desktop.invoke<{
                    pending: unknown[];
                    errors: Record<string, string>;
                  }>("sync:bindAccounts", {
                    connectionId: source,
                    targetConnectionId: target,
                  });
                  setMessage(
                    result.pending.length || Object.keys(result.errors).length
                      ? t("toast.bindPending")
                      : t("toast.bound"),
                  );
                  setTarget("");
                });
              }}
            >
              <label>
                {t("bindAnotherAccount")}
                <select
                  aria-label={t("bindTargetAccount")}
                  required
                  disabled={busy}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">{t("chooseAccount")}</option>
                  {enabled
                    .filter(
                      (item) =>
                        item.id !== source &&
                        item.serverId !==
                          enabled.find((entry) => entry.id === source)
                            ?.serverId,
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.user.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="settings-button primary"
                disabled={busy || !source || !target}
              >
                {t("bindAccount")}
              </button>
            </form>
            {profile?.peers
              .filter((item) => item.state === "active")
              .map((binding) => (
                <div
                  className="settings-row"
                  key={binding.descriptor.identity.serverId}
                >
                  <div className="settings-row-text">
                    <h3>
                      {binding.descriptor.identity.serverName} ·{" "}
                      {binding.descriptor.identity.user.name}
                    </h3>
                    <p>{binding.descriptor.identity.url}</p>
                  </div>
                  <button
                    className="settings-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await desktop.invoke<{
                          pending: unknown[];
                        }>("sync:unbindAccount", {
                          connectionId: source,
                          serverId: binding.descriptor.identity.serverId,
                        });
                        setMessage(
                          result.pending.length
                            ? t("toast.unbindPending")
                            : t("toast.unbound"),
                        );
                      })
                    }
                  >
                    {t("unbind")}
                  </button>
                </div>
              ))}
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>{t("personalToken")}</h3>
                <p>{t("personalTokenHelp")}</p>
              </div>
              <button
                className="settings-button"
                disabled={busy || !source}
                onClick={() =>
                  void run(async () => {
                    setPersonal(
                      await desktop.invoke("sync:createToken", {
                        connectionId: source,
                      }),
                    );
                  })
                }
              >
                {t("createPersonalToken")}
              </button>
            </div>
            {personal && (
              <div className="sync-form">
                <label>
                  {t("newToken")}
                  <input
                    type="password"
                    readOnly
                    value={personal.token}
                    autoComplete="off"
                  />
                </label>
                <p className="settings-help">
                  {t("tokenValidity", {
                    date: new Date(personal.expiresAt).toLocaleDateString(
                      getLocale(),
                    ),
                  })}
                </p>
                <button
                  className="settings-button"
                  onClick={() =>
                    void run(() =>
                      desktop.invoke("clipboard:write", {
                        text: personal.token,
                      }),
                    )
                  }
                >
                  {t("copyToken")}
                </button>
                <button
                  className="settings-button"
                  onClick={() => setPersonal(null)}
                >
                  {t("tokenSaved")}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="settings-help">{t("noFederatedServers")}</p>
        )}
      </section>
      <section className="settings-group">
        <h2>{t("visibleProjects")}</h2>
        <p className="settings-help">{t("visibleProjectsHelp")}</p>
        {projects.map((project) => (
          <div className="settings-row" key={project.id}>
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={!hidden.includes(project.id)}
                onChange={(event) =>
                  void run(() =>
                    desktop.invoke("sync:projectVisibility", {
                      projectId: project.id,
                      visible: event.target.checked,
                    }),
                  )
                }
              />{" "}
              {project.name}
            </label>
          </div>
        ))}
      </section>
    </>
  );
}
