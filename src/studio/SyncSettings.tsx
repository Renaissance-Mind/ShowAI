import { useCallback, useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import type { ProjectSummary } from "../core/model";
import type {
  SyncConfiguration,
  SyncProject,
  ProjectRole,
} from "../sync/protocol";
import type { SyncConflict } from "../sync/manager";
import "./sync-settings.css";
type Status = Omit<SyncConfiguration, "connections"> & {
  connections: Omit<SyncConfiguration["connections"][number], "token">[];
  running: boolean;
};
type Member = { id: string; name: string; role: ProjectRole };
type Invite = {
  digest: string;
  role: ProjectRole;
  expires_at: string;
  accepted_by: string | null;
  revoked: number;
};
const roles: Record<ProjectRole, string> = {
  admin: "管理员",
  editor: "编辑者",
  viewer: "查看者",
};
const states = {
  pending: "等待同步",
  synced: "已同步",
  offline: "连接中断",
  conflict: "需要处理冲突",
  revoked: "需要重新登录或加入",
};
const roleOptions = Object.entries(roles).map(([value, label]) => (
  <option key={value} value={value}>
    {label}
  </option>
));
function readable(bytes: string | null) {
  if (bytes === null) return "已删除";
  const data = Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(data).slice(0, 8000);
}
export default function SyncSettings() {
  const [status, setStatus] = useState<Status | null>(null),
    [localProjects, setLocalProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [form, setForm] = useState({
    url: "",
    account: "",
    password: "",
    registrationKey: "",
    token: "",
    mode: "login",
  });
  const [showConnect, setShowConnect] = useState(false),
    [server, setServer] = useState("");
  const [remote, setRemote] = useState<SyncProject[]>([]),
    [dashboard, setDashboard] = useState<string | null>(null),
    [managedProject, setManagedProject] = useState("");
  const [members, setMembers] = useState<Member[]>([]),
    [invites, setInvites] = useState<Invite[]>([]),
    [inviteRole, setInviteRole] = useState<ProjectRole>("editor"),
    [generatedInvite, setGeneratedInvite] = useState("");
  const [inviteLink, setInviteLink] = useState(
      () => new URLSearchParams(location.search).get("invite") ?? "",
    ),
    [preview, setPreview] = useState<{
      url: string;
      invite: string;
      project_id: string;
      name: string;
      role: ProjectRole;
      serverId: string;
      serverName: string;
    } | null>(null);
  const [conflict, setConflict] = useState<SyncConflict | null>(null),
    [choices, setChoices] = useState<Record<string, "local" | "remote">>({});
  const [sessions, setSessions] = useState<
    | { digest: string; device: string; created_at: string; revoked: number }[]
    | null
  >(null);
  const refresh = useCallback(async () => {
    const [next, projects] = await Promise.all([
      desktop.invoke<Status>("sync:status"),
      desktop.invoke<ProjectSummary[]>("projects:list", {
        includeArchived: true,
      }),
    ]);
    setStatus(next);
    setLocalProjects(projects);
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setError(errorMessage(error)));
    const timer = setInterval(() => {
      void refresh().catch((error) => setError(errorMessage(error)));
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const link = new URLSearchParams(location.search).get("invite");
    if (!link) return;
    void desktop
      .invoke<NonNullable<typeof preview>>("sync:previewInvite", { link })
      .then((result) => {
        setPreview(result);
        setForm((current) => ({
          ...current,
          url: result.url,
          mode: "register",
        }));
      })
      .catch((error) => setError(errorMessage(error)));
  }, []);
  useEffect(() => {
    if (!preview || !status || server) return;
    const existing = status.connections.find(
      (connection) => connection.serverId === preview.serverId,
    );
    if (existing) setServer(existing.id);
    else setShowConnect(true);
  }, [preview, status, server]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function loadServer(connectionId: string) {
    setServer(connectionId);
    setRemote([]);
    setSessions(null);
    if (connectionId)
      setRemote(
        await desktop.invoke<SyncProject[]>("sync:projects", { connectionId }),
      );
  }
  async function loadDashboard(connectionId: string, projectId?: string) {
    setDashboard(connectionId);
    setManagedProject(projectId ?? "");
    setGeneratedInvite("");
    const projects = await desktop.invoke<SyncProject[]>("sync:projects", {
      connectionId,
    });
    setRemote(projects);
    setServer(connectionId);
    if (projectId) {
      const data = await desktop.invoke<{
        members: Member[];
        invites: Invite[];
      }>("sync:dashboard", { connectionId, projectId });
      setMembers(data.members);
      setInvites(data.invites);
    } else {
      setMembers([]);
      setInvites([]);
    }
  }
  async function manage(operation: string, input: Record<string, unknown>) {
    const result = await desktop.invoke("sync:manage", {
      connectionId: dashboard,
      projectId: managedProject,
      operation,
      input,
    });
    await loadDashboard(dashboard!, managedProject);
    return result;
  }
  async function connect() {
    const connection = await desktop.invoke<{ id: string }>("sync:connect", {
      url: form.url,
      account: form.account,
      password: form.password,
      registrationKey: form.registrationKey,
      token: form.mode === "token" ? form.token : undefined,
      register: form.mode === "register",
      invite: preview?.invite,
    });
    setShowConnect(false);
    setForm({ ...form, password: "", token: "", registrationKey: "" });
    if (preview) {
      await desktop.invoke("sync:join", {
        connectionId: connection.id,
        link: inviteLink,
      });
      setPreview(null);
      setInviteLink("");
      setMessage("已加入项目，正在下载完整内容和历史。");
    }
    await loadServer(connection.id);
  }
  const connectionSelect = (
    value: string,
    change: (value: string) => void,
    empty = "选择服务器账号",
  ) => (
    <select
      value={value}
      onChange={(event) => change(event.target.value)}
      disabled={busy}
    >
      <option value="">{empty}</option>
      {status?.connections.map((connection) => (
        <option key={connection.id} value={connection.id}>
          {connection.name} · {connection.user.name}
        </option>
      ))}
    </select>
  );
  if (!status) return <p className="settings-help">正在读取服务器连接…</p>;
  return (
    <div className="sync-settings" aria-busy={busy}>
      {error && (
        <p className="sync-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="sync-message" role="status">
          {message}
        </p>
      )}
      <section className="settings-group">
        <h2>默认存储</h2>
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>新项目保存位置</h3>
            <p>
              新项目会自动加入所选服务器，当前账号成为项目管理员。本地保留离线副本。
            </p>
          </div>
          {connectionSelect(
            status.defaultConnectionId ?? "",
            (value) =>
              void run(() =>
                desktop.invoke("sync:default", { connectionId: value || null }),
              ),
            "仅保存在本机",
          )}
        </div>
      </section>
      <section className="settings-group">
        <h2>服务器与账号</h2>
        {status.connections.map((connection) => (
          <div className="sync-connection" key={connection.id}>
            <div className="settings-row-text">
              <h3>{connection.name}</h3>
              <p>
                {connection.url} · {connection.user.name}
              </p>
            </div>
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => void run(() => loadServer(connection.id))}
            >
              查看项目
            </button>
            {(status.projects.some(
              (project) =>
                project.connectionId === connection.id &&
                project.role === "admin",
            ) ||
              (server === connection.id &&
                remote.some((project) => project.role === "admin"))) && (
              <button
                className="settings-button"
                disabled={busy}
                onClick={() => void run(() => loadDashboard(connection.id))}
              >
                项目 Dashboard
              </button>
            )}
            <button
              className="settings-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setServer(connection.id);
                  setSessions(
                    await desktop.invoke("sync:sessions", {
                      connectionId: connection.id,
                    }),
                  );
                })
              }
            >
              设备 Token
            </button>
            <button
              className="settings-button"
              disabled={
                busy ||
                status.projects.some(
                  (project) => project.connectionId === connection.id,
                )
              }
              onClick={() =>
                void run(() =>
                  desktop.invoke("sync:disconnect", {
                    connectionId: connection.id,
                  }),
                )
              }
            >
              移除连接
            </button>
          </div>
        ))}
        <button
          className="settings-button"
          onClick={() => {
            setShowConnect(!showConnect);
            setError("");
          }}
          disabled={busy}
        >
          {showConnect ? "收起连接设置" : "添加服务器账号"}
        </button>
        {showConnect && (
          <form
            className="sync-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(connect);
            }}
          >
            <label>
              服务器地址
              <input
                required
                type="url"
                placeholder="https://showai.example.com"
                value={form.url}
                onChange={(event) =>
                  setForm({ ...form, url: event.target.value })
                }
              />
            </label>
            <label>
              连接方式
              <select
                value={form.mode}
                onChange={(event) =>
                  setForm({ ...form, mode: event.target.value })
                }
              >
                <option value="login">账号密码登录</option>
                <option value="register">注册账号</option>
                <option value="token">使用已有 Token</option>
              </select>
            </label>
            {form.mode === "token" ? (
              <label>
                Token
                <input
                  required
                  type="password"
                  autoComplete="off"
                  value={form.token}
                  onChange={(event) =>
                    setForm({ ...form, token: event.target.value })
                  }
                />
              </label>
            ) : (
              <>
                <label>
                  账号
                  <input
                    required
                    autoComplete="username"
                    value={form.account}
                    onChange={(event) =>
                      setForm({ ...form, account: event.target.value })
                    }
                  />
                </label>
                <label>
                  密码
                  <input
                    required
                    minLength={4}
                    type="password"
                    autoComplete={
                      form.mode === "register"
                        ? "new-password"
                        : "current-password"
                    }
                    value={form.password}
                    onChange={(event) =>
                      setForm({ ...form, password: event.target.value })
                    }
                  />
                </label>
                {form.mode === "register" && !preview && (
                  <label>
                    注册密钥（服务器要求时填写）
                    <input
                      type="password"
                      autoComplete="off"
                      value={form.registrationKey}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          registrationKey: event.target.value,
                        })
                      }
                    />
                  </label>
                )}
              </>
            )}
            <button className="settings-button" type="submit" disabled={busy}>
              连接服务器{preview ? "并加入项目" : ""}
            </button>
          </form>
        )}
        {sessions && (
          <div className="sync-dashboard-list">
            <h3>我的设备 Token</h3>
            {sessions.map((session) => (
              <div className="sync-connection" key={session.digest}>
                <div className="settings-row-text">
                  <h3>{session.device}</h3>
                  <p>
                    {new Date(session.created_at).toLocaleString()} ·{" "}
                    {session.revoked ? "已撤销" : "有效"}
                  </p>
                </div>
                <button
                  className="settings-button"
                  disabled={busy || !!session.revoked}
                  onClick={() =>
                    void run(async () => {
                      await desktop.invoke("sync:revokeToken", {
                        connectionId: server,
                        digest: session.digest,
                      });
                      setSessions(
                        await desktop.invoke("sync:sessions", {
                          connectionId: server,
                        }),
                      );
                    })
                  }
                >
                  撤销 Token
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="settings-group">
        <h2>加入共享项目</h2>
        <form
          className="sync-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await desktop.invoke<NonNullable<typeof preview>>(
                "sync:previewInvite",
                { link: inviteLink },
              );
              setPreview(result);
              const existing = status.connections.find(
                (connection) => connection.serverId === result.serverId,
              );
              setServer(existing?.id ?? "");
              if (!existing) {
                setForm({ ...form, url: result.url, mode: "register" });
                setShowConnect(true);
              }
            });
          }}
        >
          <input
            type="url"
            required
            aria-label="项目邀请链接"
            placeholder="粘贴项目邀请链接"
            value={inviteLink}
            onChange={(event) => {
              setInviteLink(event.target.value);
              setPreview(null);
            }}
          />
          <button className="settings-button" disabled={busy}>
            查看邀请
          </button>
        </form>
        {preview && (
          <div className="sync-invitation">
            <h3>{preview.name}</h3>
            <p>
              {preview.serverName} · {preview.url} · 加入后为
              {roles[preview.role]}
            </p>
            {status.connections.some(
              (connection) => connection.serverId === preview.serverId,
            ) ? (
              <div className="sync-inline-form">
                <select
                  value={server}
                  onChange={(event) => setServer(event.target.value)}
                >
                  {status.connections
                    .filter(
                      (connection) => connection.serverId === preview.serverId,
                    )
                    .map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.user.name}
                      </option>
                    ))}
                </select>
                <button
                  className="settings-button"
                  disabled={busy || !server}
                  onClick={() =>
                    void run(async () => {
                      await desktop.invoke("sync:join", {
                        connectionId: server,
                        link: inviteLink,
                      });
                      setPreview(null);
                      setInviteLink("");
                      setMessage("已加入项目，正在同步内容与历史。");
                    })
                  }
                >
                  确认加入项目
                </button>
              </div>
            ) : (
              <p className="settings-help">
                请在上方注册或登录此服务器，再确认加入。
              </p>
            )}
          </div>
        )}
      </section>
      <section className="settings-group">
        <h2>项目存储与同步</h2>
        {localProjects.map((project) => {
          const binding = status.projects.find(
              (item) => item.projectId === project.id,
            ),
            connection =
              binding &&
              status.connections.find(
                (item) => item.id === binding.connectionId,
              );
          return (
            <div className="sync-project" key={project.id}>
              <div className="sync-project-heading">
                <div className="settings-row-text">
                  <h3>{project.name}</h3>
                  <p>
                    {connection
                      ? `${connection.name} · ${connection.user.name} · ${roles[binding!.role]} · ${states[binding!.status]}`
                      : "保存在本机"}
                  </p>
                  {binding?.error && (
                    <p className="sync-error">{binding.error}</p>
                  )}
                </div>
                {binding ? (
                  <>
                    <select
                      aria-label={`${project.name}的同步账号`}
                      value={binding.connectionId}
                      disabled={busy}
                      onChange={(event) =>
                        void run(() =>
                          desktop.invoke("sync:changeAccount", {
                            projectId: project.id,
                            connectionId: event.target.value,
                          }),
                        )
                      }
                    >
                      {status.connections
                        .filter(
                          (item) => item.serverId === connection?.serverId,
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.user.name}
                          </option>
                        ))}
                    </select>
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          desktop.invoke("sync:run", { projectId: project.id }),
                        )
                      }
                    >
                      立即同步
                    </button>
                    {binding.role === "admin" && (
                      <button
                        className="settings-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            loadDashboard(
                              binding.connectionId,
                              binding.remoteProjectId,
                            ),
                          )
                        }
                      >
                        管理成员
                      </button>
                    )}
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          desktop.invoke("sync:detach", {
                            projectId: project.id,
                          }),
                        )
                      }
                    >
                      解除同步
                    </button>
                  </>
                ) : (
                  connectionSelect(
                    "",
                    (value) => {
                      if (value)
                        void run(() =>
                          desktop.invoke("sync:attach", {
                            projectId: project.id,
                            connectionId: value,
                          }),
                        );
                    },
                    "连接到服务器",
                  )
                )}
              </div>
              {binding?.status === "conflict" && (
                <button
                  className="settings-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setConflict(
                        await desktop.invoke("sync:conflict", {
                          projectId: project.id,
                        }),
                      );
                      setChoices({});
                    })
                  }
                >
                  查看双方修改
                </button>
              )}
            </div>
          );
        })}
        {!localProjects.length && (
          <p className="settings-help">
            新建项目，或通过邀请加入项目后，会在这里显示存储连接。
          </p>
        )}
      </section>
      {server && !dashboard && remote.length > 0 && (
        <section className="settings-group">
          <h2>服务器上的项目</h2>
          {remote.map((project) => (
            <div className="sync-connection" key={project.id}>
              <div className="settings-row-text">
                <h3>{project.name}</h3>
                <p>
                  {roles[project.role]}
                  {project.archived ? " · 已归档" : ""}
                </p>
              </div>
              <button
                className="settings-button"
                disabled={
                  busy ||
                  status.projects.some(
                    (binding) =>
                      binding.connectionId === server &&
                      binding.remoteProjectId === project.id,
                  )
                }
                onClick={() =>
                  void run(() =>
                    desktop.invoke("sync:subscribe", {
                      connectionId: server,
                      remoteProjectId: project.id,
                    }),
                  )
                }
              >
                加入本地
              </button>
            </div>
          ))}
        </section>
      )}
      {dashboard && (
        <section className="settings-group sync-dashboard">
          <div className="sync-section-heading">
            <h2>
              项目 Dashboard ·{" "}
              {
                status.connections.find(
                  (connection) => connection.id === dashboard,
                )?.name
              }
            </h2>
            <button
              className="settings-button"
              onClick={() => {
                setDashboard(null);
                setManagedProject("");
              }}
            >
              关闭 Dashboard
            </button>
          </div>
          <div className="sync-inline-form">
            <select
              aria-label="管理的项目"
              value={managedProject}
              onChange={(event) =>
                void run(() => loadDashboard(dashboard, event.target.value))
              }
            >
              <option value="">选择管理的项目</option>
              {remote
                .filter((project) => project.role === "admin")
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </select>
            <form
              className="sync-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void run(async () => {
                  await desktop.invoke("sync:createProject", {
                    connectionId: dashboard,
                    name: data.get("name"),
                  });
                  await loadDashboard(dashboard);
                });
              }}
            >
              <input
                name="name"
                required
                aria-label="新项目名称"
                placeholder="新项目名称"
              />
              <button className="settings-button" disabled={busy}>
                创建项目
              </button>
            </form>
          </div>
          {managedProject && (
            <>
              <h3>项目成员</h3>
              {members.map((member) => (
                <div className="sync-connection" key={member.id}>
                  <div className="settings-row-text">
                    <h3>{member.name}</h3>
                  </div>
                  <select
                    aria-label={`${member.name}的项目权限`}
                    value={member.role}
                    disabled={busy}
                    onChange={(event) =>
                      void run(() =>
                        manage("member", {
                          userId: member.id,
                          role: event.target.value,
                        }),
                      )
                    }
                  >
                    {roleOptions}
                  </select>
                  <button
                    className="settings-button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        manage("member", { userId: member.id, role: null }),
                      )
                    }
                  >
                    移出项目
                  </button>
                </div>
              ))}
              <h3>邀请新成员</h3>
              <div className="sync-inline-form">
                <select
                  aria-label="邀请权限"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as ProjectRole)
                  }
                >
                  {roleOptions}
                </select>
                <button
                  className="settings-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const invitation = (await manage("invite", {
                        role: inviteRole,
                      })) as { url: string };
                      setGeneratedInvite(invitation.url);
                    })
                  }
                >
                  生成邀请链接
                </button>
              </div>
              {generatedInvite && (
                <div className="sync-inline-form">
                  <input
                    aria-label="生成的邀请链接"
                    readOnly
                    value={generatedInvite}
                  />
                  <button
                    className="settings-button"
                    onClick={() =>
                      void run(async () => {
                        await desktop.invoke("clipboard:write", {
                          text: generatedInvite,
                        });
                        setMessage("邀请链接已复制。");
                      })
                    }
                  >
                    复制链接
                  </button>
                </div>
              )}
              {invites
                .filter((invite) => !invite.accepted_by && !invite.revoked)
                .map((invite) => (
                  <div className="sync-connection" key={invite.digest}>
                    <p className="settings-help">
                      {roles[invite.role]} ·{" "}
                      {new Date(invite.expires_at).toLocaleString()} 到期
                    </p>
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          manage("revokeInvite", { digest: invite.digest }),
                        )
                      }
                    >
                      撤销邀请
                    </button>
                  </div>
                ))}
              <div className="sync-inline-form">
                <button
                  className="settings-button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      manage("project", {
                        archived: !remote.find(
                          (project) => project.id === managedProject,
                        )?.archived,
                      }),
                    )
                  }
                >
                  {remote.find((project) => project.id === managedProject)
                    ?.archived
                    ? "恢复项目"
                    : "归档项目"}
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {conflict && (
        <section className="settings-group sync-conflict">
          <h2>处理同步冲突</h2>
          <p className="settings-help">
            双方版本和历史都已保留。为每个冲突选择保留的内容，然后发布合并版本。
          </p>
          {conflict.files.map((file) => (
            <div key={file.path}>
              <h3>{file.path}</h3>
              <div className="sync-conflict-columns">
                {(["local", "remote"] as const).map((side) => (
                  <label key={side}>
                    <span>
                      <input
                        type="radio"
                        name={file.path}
                        checked={choices[file.path] === side}
                        onChange={() =>
                          setChoices({ ...choices, [file.path]: side })
                        }
                      />
                      {side === "local"
                        ? "保留本地"
                        : conflict.recovery
                          ? "使用保留的合并草稿"
                          : "使用服务器版本"}
                    </span>
                    <pre>{readable(file[side])}</pre>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="sync-inline-form">
            <button
              className="settings-button"
              disabled={
                busy || conflict.files.some((file) => !choices[file.path])
              }
              onClick={() =>
                void run(async () => {
                  await desktop.invoke("sync:resolve", {
                    projectId: conflict.projectId,
                    choices,
                  });
                  setConflict(null);
                })
              }
            >
              保存合并并同步
            </button>
            <button
              className="settings-button"
              onClick={() => setConflict(null)}
            >
              稍后处理
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
