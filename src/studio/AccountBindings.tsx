import { useNotify } from "../problems/toast-context";
import { useEffect, useState } from "react";
import { CircleAlert, Link2 } from "../ui/icons";
import Select from "../ui/Select";
import { desktop, errorMessage } from "../host/bridge";
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
  const notify = useNotify();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const enabled = connections.filter(
    (item) => !item.signedOut && item.capabilities?.includes("account-federation-v1"),
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
      <div className="settings-group-heading">
        <div>
          <h2 id="sync-bindings-title">{t("accountBindings")}</h2>
          <p className="settings-group-desc">{t("accountBindingsHelp")}</p>
        </div>
      </div>
      {error && (
        <div className="settings-callout sync-alert" data-tone="error" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {!enabled.length ? (
        <div className="settings-card">
          <div className="settings-card-section">
            <p className="library-space-summary">{t("noFederatedServers")}</p>
          </div>
        </div>
      ) : (
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <label htmlFor="sync-binding-source">{t("bindingAccount")}</label>
            </div>
            <Select
              id="sync-binding-source"
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
            </Select>
          </div>
          <div className="settings-card-section">
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
                    type="button"
                    className="settings-button settings-danger-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await desktop.invoke<{
                          pending: unknown[];
                        }>("sync:unbindAccount", {
                          connectionId: source,
                          serverId: binding.descriptor.identity.serverId,
                        });
                        notify(
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
                className="sync-bind-form"
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
                    notify(
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
                  <Select
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
                  </Select>
                </label>
                <button
                  type="submit"
                  className="settings-button settings-primary-button"
                  disabled={busy || !source || !target}
                >
                  {t("bindAccount")}
                </button>
              </form>
            ) : (
              <p className="settings-help">{t("bindNeedsTwo")}</p>
            )}
          </div>
          <div className="settings-row sync-card-footer">
            <div className="settings-row-text">
              <p>{t("restoreHelp")}</p>
            </div>
            <button
              type="button"
              className="settings-button"
              disabled={busy || !source}
              onClick={() =>
                void run(async () => {
                  const result = await desktop.invoke<{
                    pending: unknown[];
                    errors: Record<string, string>;
                  }>("sync:restoreAccounts", { connectionId: source });
                  notify(
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
