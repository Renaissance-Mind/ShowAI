import { useEffect, useState } from "react";
import { Link2 } from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import type { AccountProfile } from "../sync/accounts";
import type { ServerConnection } from "../sync/protocol";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sync";
export default function AccountBindings({
  connections,
  refresh,
}: {
  connections: Omit<ServerConnection, "token">[];
  refresh: () => Promise<void>;
}) {
  const t = useTranslator(messages);
  const [source, setSource] = useState(""),
    [target, setTarget] = useState(""),
    [profile, setProfile] = useState<AccountProfile | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const enabled = connections.filter((item) =>
    item.capabilities?.includes("account-federation-v1"),
  );
  const current = enabled.find((item) => item.id === source);
  const candidates = enabled.filter(
    (item) => item.serverId !== current?.serverId,
  );
  const peers = profile?.peers.filter((item) => item.state === "active") ?? [];
  useEffect(() => {
    if (!enabled.some((item) => item.id === source))
      setSource(enabled[0]?.id ?? "");
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
  const label = (item: Omit<ServerConnection, "token">) =>
    `${item.name} · ${item.user.name}`;
  return (
    <section
      className="settings-group sync-section"
      aria-labelledby="sync-bindings-title"
    >
      <div className="sync-section-header">
        <div>
          <h2 id="sync-bindings-title">{t("accountBindings")}</h2>
          <p className="settings-help">{t("accountBindingsHelp")}</p>
        </div>
      </div>
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
      {!enabled.length ? (
        <p className="sync-empty">{t("noFederatedServers")}</p>
      ) : (
        <div className="sync-card">
          <div className="sync-card-row">
            <label className="sync-field sync-field-inline">
              <span>{t("bindingAccount")}</span>
              <select
                disabled={busy || enabled.length < 2}
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setTarget("");
                }}
              >
                {enabled.map((item) => (
                  <option key={item.id} value={item.id}>
                    {label(item)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="sync-binding-list" aria-label={t("boundAccounts")}>
            {peers.map((binding) => (
              <li key={binding.descriptor.identity.serverId}>
                <Link2 size={16} aria-hidden="true" />
                <div>
                  <strong>
                    {binding.descriptor.identity.serverName} ·{" "}
                    {binding.descriptor.identity.user.name}
                  </strong>
                  <span>{binding.descriptor.identity.url}</span>
                </div>
                <button
                  className="sync-text-button sync-danger"
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
              </li>
            ))}
            {!peers.length && (
              <li className="sync-binding-empty">{t("bindingsEmpty")}</li>
            )}
          </ul>
          {candidates.length ? (
            <form
              className="sync-card-row sync-bind-form"
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
              <label className="sync-field sync-field-inline">
                <span>{t("bindWith")}</span>
                <select
                  required
                  disabled={busy}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">{t("chooseAccount")}</option>
                  {candidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {label(item)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="settings-button sync-primary"
                disabled={busy || !source || !target}
              >
                {t("bindAccount")}
              </button>
            </form>
          ) : (
            <p className="settings-help sync-card-note">{t("bindNeedsTwo")}</p>
          )}
          <div className="sync-card-row sync-card-footer">
            <p className="settings-help">{t("restoreHelp")}</p>
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
        </div>
      )}
    </section>
  );
}
