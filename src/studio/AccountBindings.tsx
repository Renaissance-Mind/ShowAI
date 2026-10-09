import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import type { AccountProfile } from "../sync/accounts";
import type { ServerConnection } from "../sync/protocol";
import type { ProjectSummary } from "../core/model";
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
        <h2>账号绑定</h2>
        <p className="settings-help">
          绑定已登录的服务器账号。以后在新设备登录其中一个服务，就可以恢复其他服务的访问。
        </p>
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
                当前账号{" "}
                <select
                  aria-label="绑定来源账号"
                  disabled={busy}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  <option value="">选择账号</option>
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
                        ? "已恢复可连接的服务，其余服务将在重新连接后恢复。"
                        : "已恢复全部绑定服务。",
                    );
                  })
                }
              >
                恢复绑定服务
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
                      ? "已保存绑定，部分服务尚未完成确认；恢复连接后会继续。"
                      : "账号已绑定，新设备可以从任意一个服务恢复登录。",
                  );
                  setTarget("");
                });
              }}
            >
              <label>
                绑定另一个已登录的账号
                <select
                  aria-label="要绑定的账号"
                  required
                  disabled={busy}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">选择账号</option>
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
                绑定账号
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
                            ? "已保存解除请求，离线服务恢复连接后会完成撤销。"
                            : "已解除绑定，并撤销通过该服务签发的设备登录。",
                        );
                      })
                    }
                  >
                    解除绑定
                  </button>
                </div>
              ))}
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>个人 Token</h3>
                <p>用于登录新设备，可在「账号与设备」中单独撤销。</p>
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
                生成个人 Token
              </button>
            </div>
            {personal && (
              <div className="sync-form">
                <label>
                  新生成的 Token
                  <input
                    type="password"
                    readOnly
                    value={personal.token}
                    autoComplete="off"
                  />
                </label>
                <p className="settings-help">
                  有效期至 {new Date(personal.expiresAt).toLocaleDateString()}
                  。关闭此处后只保留在设备列表中的撤销入口。
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
                  复制 Token
                </button>
                <button
                  className="settings-button"
                  onClick={() => setPersonal(null)}
                >
                  已保存
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="settings-help">
            添加启用账号绑定的服务器后，即可在这里建立绑定。
          </p>
        )}
      </section>
      <section className="settings-group">
        <h2>本设备显示的项目</h2>
        <p className="settings-help">每台设备独立选择需要显示的项目。</p>
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
