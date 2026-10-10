import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import SyncDashboard, {
  type SyncMember,
  type SyncInvite,
} from "./SyncDashboard";
import AccountBindings from "./AccountBindings";
import ServiceLogin from "./ServiceLogin";
import { conflictPreview } from "./sync-conflict-preview";
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
const roles: Record<ProjectRole, string> = {
  admin: "管理员",
  editor: "编辑者",
  viewer: "查看者",
};
const states = {
  pending: "等待同步",
  synced: "已同步",
  "save-failed": "本机保存失败，请处理冲突",
  offline: "连接中断",
  conflict: "需要处理冲突",
  revoked: "需要重新登录或加入",
};
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
  const [issuedToken, setIssuedToken] = useState("");
  const [panel, setPanel] = useState<
    "projects" | "dashboard" | "conflict" | null
  >(null);
  const panelBody = useRef<HTMLDivElement>(null);
  const actionFocus = useRef<HTMLElement | null>(null);
  const [remote, setRemote] = useState<SyncProject[]>([]),
    [dashboard, setDashboard] = useState<string | null>(null),
    [managedProject, setManagedProject] = useState("");
  const [members, setMembers] = useState<SyncMember[]>([]),
    [invites, setInvites] = useState<SyncInvite[]>([]),
    [inviteRole, setInviteRole] = useState<ProjectRole>("editor"),
    [generatedInvite, setGeneratedInvite] = useState("");
  const [generatedInviteExpiresAt, setGeneratedInviteExpiresAt] = useState("");
  const [generatedInvitePolicy, setGeneratedInvitePolicy] = useState("");
  const [sessionConnectionId, setSessionConnectionId] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "" });
  const [confirmSignOut, setConfirmSignOut] = useState(false);
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
      target_name?: string | null;
      serverName: string;
    } | null>(null);
  const [conflict, setConflict] = useState<SyncConflict | null>(null),
    [choices, setChoices] = useState<Record<string, "local" | "remote">>({});
  const conflictPreviews = useMemo(
    () =>
      new Map(
        conflict?.files.map((file) => [file.path, conflictPreview(file)]),
      ),
    [conflict],
  );
  const [sessions, setSessions] = useState<
    | {
        digest: string;
        device: string;
        created_at: string;
        expires_at: string;
        revoked: number;
        current?: number;
      }[]
    | null
  >(null);
  const refresh = useCallback(async () => {
    const [next, projects] = await Promise.all([
      desktop.invoke<Status>("sync:status"),
      desktop.invoke<ProjectSummary[]>("projects:list", {
        includeArchived: true,
        includeHidden: true,
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
          mode: result.target_name ? "login" : "register",
          account: result.target_name ?? current.account,
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
  useEffect(() => {
    // Disabling a loading selector can move focus out of the dialog.
    if (panel && !busy && !document.activeElement?.closest(".sync-dialog")) {
      const target = actionFocus.current;
      (target?.isConnected &&
      target.offsetParent !== null &&
      !target.matches(":disabled")
        ? target
        : [
            ...(panelBody.current?.querySelectorAll<HTMLElement>(
              "input:not([disabled]),select:not([disabled]),button:not([disabled])",
            ) ?? []),
          ].find((element) => element.offsetParent !== null)
      )?.focus();
    }
  }, [panel, busy]);
  async function run(action: () => Promise<unknown>) {
    const active = document.activeElement;
    actionFocus.current =
      active instanceof HTMLElement && active.closest(".sync-dialog")
        ? active
        : null;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      setError(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function loadServer(connectionId: string) {
    setPanel(connectionId ? "projects" : null);
    setDashboard(null);
    setManagedProject("");
    setServer(connectionId);
    setRemote([]);
    setSessions(null);
    if (connectionId)
      setRemote(
        await desktop.invoke<SyncProject[]>("sync:projects", { connectionId }),
      );
  }
  async function loadDashboard(connectionId: string, projectId?: string) {
    const previousId = dashboard === connectionId ? managedProject : "";
    setPanel("dashboard");
    setDashboard(connectionId);
    setServer(connectionId);
    if (dashboard !== connectionId) {
      setRemote([]);
      setMembers([]);
      setInvites([]);
      setManagedProject("");
    }
    setGeneratedInvite("");
    setGeneratedInviteExpiresAt("");
    const projects = await desktop.invoke<SyncProject[]>("sync:projects", {
      connectionId,
    });
    setRemote(projects);
    const selected =
      projects.find(
        (project) =>
          project.id === (projectId ?? previousId) && project.role === "admin",
      ) ?? projects.find((project) => project.role === "admin");
    if (selected) {
      const data = await desktop.invoke<{
        members: SyncMember[];
        invites: SyncInvite[];
      }>("sync:dashboard", { connectionId, projectId: selected.id });
      setMembers(data.members);
      setInvites(data.invites);
      setManagedProject(selected.id);
    } else {
      setMembers([]);
      setInvites([]);
      setManagedProject("");
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
    const connection = await desktop.invoke<{
      id: string;
      issuedPersonalToken?: string;
    }>("sync:connect", {
      url: form.url,
      account: form.account,
      password: form.mode === "personal" ? undefined : form.password,
      registrationKey: form.registrationKey,
      token: form.mode === "token" ? form.token : undefined,
      register: form.mode === "register" || form.mode === "personal",
      personalToken: form.mode === "personal",
      invite: preview?.invite,
    });
    setShowConnect(false);
    setIssuedToken(connection.issuedPersonalToken ?? "");
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
      {error && !panel && (
        <p className="sync-error" role="alert">
          {error}
        </p>
      )}
      {message && !panel && (
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
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => void run(() => loadDashboard(connection.id))}
            >
              项目管理
            </button>
            <button
              className="settings-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setServer(connection.id);
                  setSessionConnectionId(connection.id);
                  setPasswords({ current: "", next: "" });
                  setConfirmSignOut(false);
                  setSessions(
                    await desktop.invoke("sync:sessions", {
                      connectionId: connection.id,
                    }),
                  );
                })
              }
            >
              账号与设备
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
                <option value="personal">注册并生成个人 Token</option>
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
                {form.mode !== "personal" && (
                  <label>
                    密码
                    <input
                      required
                      minLength={form.mode === "register" ? 12 : 1}
                      maxLength={1024}
                      placeholder={
                        form.mode === "register" ? "至少 12 个字符" : undefined
                      }
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
                )}
                {["register", "personal"].includes(form.mode) && !preview && (
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
        {showConnect && (
          <ServiceLogin
            url={form.url}
            registrationKey={form.registrationKey}
            onConnected={async (id) => {
              setShowConnect(false);
              await loadServer(id);
              await refresh();
            }}
          />
        )}
        {issuedToken && (
          <div className="sync-form">
            <label>
              新生成的个人 Token
              <input
                type="password"
                readOnly
                autoComplete="off"
                value={issuedToken}
              />
            </label>
            <button
              className="settings-button"
              onClick={() =>
                void run(() =>
                  desktop.invoke("clipboard:write", { text: issuedToken }),
                )
              }
            >
              复制个人 Token
            </button>
            <button
              className="settings-button"
              onClick={() => setIssuedToken("")}
            >
              已保存
            </button>
          </div>
        )}
        {sessions && (
          <div className="sync-dashboard-list">
            <h3>
              {
                status.connections.find(
                  (connection) => connection.id === sessionConnectionId,
                )?.user.name
              }{" "}
              的设备会话
            </h3>
            <p>会话到期后请重新登录。撤销设备不会删除其已下载的本地内容。</p>
            <ServiceLogin
              key={sessionConnectionId}
              url={
                status.connections.find(
                  (connection) => connection.id === sessionConnectionId,
                )?.url ?? ""
              }
              connectionId={sessionConnectionId}
              registrationKey=""
              onConnected={async () => {
                await refresh();
                setSessions(
                  await desktop.invoke("sync:sessions", {
                    connectionId: sessionConnectionId,
                  }),
                );
                setMessage("已添加登录方式，可用它登录当前账号。");
              }}
            />
            {status.connections
              .find((connection) => connection.id === sessionConnectionId)
              ?.capabilities?.includes("account-security-v1") && (
              <>
                <details>
                  <summary>修改密码</summary>
                  <p>修改后其他设备会退出，本设备保持登录。</p>
                  <form
                    className="sync-connect-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await desktop.invoke("sync:changePassword", {
                          connectionId: sessionConnectionId,
                          currentPassword: passwords.current,
                          newPassword: passwords.next,
                        });
                        setPasswords({ current: "", next: "" });
                        setSessions(
                          await desktop.invoke("sync:sessions", {
                            connectionId: sessionConnectionId,
                          }),
                        );
                        setMessage(
                          "密码已修改，其他设备会话已撤销。本设备保持登录。",
                        );
                      });
                    }}
                  >
                    <label>
                      当前密码
                      <input
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
                    <label>
                      新密码
                      <input
                        type="password"
                        required
                        minLength={12}
                        maxLength={1024}
                        placeholder="至少 12 个字符"
                        autoComplete="new-password"
                        value={passwords.next}
                        onChange={(event) =>
                          setPasswords({
                            ...passwords,
                            next: event.target.value,
                          })
                        }
                      />
                    </label>
                    <button
                      className="settings-button"
                      disabled={busy}
                      type="submit"
                    >
                      保存新密码
                    </button>
                  </form>
                </details>
                <button
                  className="settings-button"
                  disabled={busy}
                  onClick={() => setConfirmSignOut(true)}
                >
                  退出所有设备
                </button>
                {confirmSignOut && (
                  <div role="group" aria-label="确认退出所有设备">
                    <p>所有设备包括本设备都会退出登录。项目与本地内容保留。</p>
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() => setConfirmSignOut(false)}
                    >
                      取消
                    </button>
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await desktop.invoke("sync:revokeAllTokens", {
                            connectionId: sessionConnectionId,
                          });
                          setSessions(null);
                          setConfirmSignOut(false);
                          const connection = status.connections.find(
                            (item) => item.id === sessionConnectionId,
                          )!;
                          setForm({
                            ...form,
                            url: connection.url,
                            account: connection.user.name,
                            password: "",
                            token: "",
                            registrationKey: "",
                            mode: "login",
                          });
                          setShowConnect(true);
                          setMessage("所有设备已退出，请重新登录。");
                        })
                      }
                    >
                      确认退出所有设备
                    </button>
                  </div>
                )}
              </>
            )}
            {sessions.map((session) => (
              <div className="sync-connection" key={session.digest}>
                <div className="settings-row-text">
                  <h3>{session.device}</h3>
                  <p>
                    {new Date(session.created_at).toLocaleString()} ·{" "}
                    {session.revoked
                      ? "已撤销"
                      : new Date(session.expires_at).getTime() <= Date.now()
                        ? "已到期"
                        : `有效至 ${new Date(session.expires_at).toLocaleString()}`}
                    {session.current ? " · 本设备" : ""}
                  </p>
                </div>
                <button
                  className="settings-button"
                  disabled={
                    busy ||
                    !!session.revoked ||
                    new Date(session.expires_at).getTime() <= Date.now()
                  }
                  onClick={() =>
                    void run(async () => {
                      await desktop.invoke("sync:revokeToken", {
                        connectionId: sessionConnectionId,
                        digest: session.digest,
                      });
                      if (session.current) {
                        setSessions(null);
                        setMessage("本设备会话已撤销，请重新登录。");
                      } else
                        setSessions(
                          await desktop.invoke("sync:sessions", {
                            connectionId: sessionConnectionId,
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
      <AccountBindings
        connections={status.connections}
        projects={localProjects}
        hidden={status.hiddenProjectIds ?? []}
        refresh={refresh}
      />
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
                      setPanel("conflict");
                      setConflict(null);
                      setChoices({});
                      setConflict(
                        await desktop.invoke("sync:conflict", {
                          projectId: project.id,
                        }),
                      );
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
      {panel && (
        <Dialog
          key={panel}
          title={
            panel === "projects"
              ? "服务器上的项目"
              : panel === "dashboard"
                ? "项目管理"
                : "查看双方修改"
          }
          wide
          onClose={() => setPanel(null)}
          className={`sync-dialog sync-${panel}-dialog`}
        >
          <div
            ref={panelBody}
            className={`sync-dialog-body ${panel === "dashboard" ? "sync-dashboard-body" : ""}`}
            aria-busy={busy}
          >
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
            {busy && (
              <p className="settings-help" role="status">
                正在处理…
              </p>
            )}
            {panel === "projects" && (
              <section className="settings-group">
                <p className="settings-help">
                  {
                    status.connections.find(
                      (connection) => connection.id === server,
                    )?.name
                  }{" "}
                  ·{" "}
                  {
                    status.connections.find(
                      (connection) => connection.id === server,
                    )?.user.name
                  }
                </p>
                {!busy && !error && !remote.length && (
                  <p className="settings-help">该账号在服务器上还没有项目。</p>
                )}
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
                      {status.projects.some(
                        (binding) =>
                          binding.connectionId === server &&
                          binding.remoteProjectId === project.id,
                      )
                        ? "已加入本地"
                        : "加入本地"}
                    </button>
                    {project.role === "admin" && (
                      <button
                        className="settings-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() => loadDashboard(server, project.id))
                        }
                      >
                        管理成员
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
            {panel === "dashboard" && dashboard && (
              <SyncDashboard
                connection={status.connections.find(
                  (connection) => connection.id === dashboard,
                )}
                projects={remote}
                selectedId={managedProject}
                members={members}
                invites={invites}
                busy={busy}
                inviteRole={inviteRole}
                generatedInvite={generatedInvite}
                generatedInviteExpiresAt={generatedInviteExpiresAt}
                generatedInvitePolicy={generatedInvitePolicy}
                onSelect={(id) => {
                  void run(() => loadDashboard(dashboard, id));
                }}
                onCreate={(name) =>
                  run(async () => {
                    const project = await desktop.invoke<{ id: string }>(
                      "sync:createProject",
                      { connectionId: dashboard, name },
                    );
                    await loadDashboard(dashboard, project.id);
                    setMessage(`已创建项目“${name}”。`);
                  })
                }
                onRole={(member, role) => {
                  void run(async () => {
                    await manage("member", { userId: member.id, role });
                    setMessage(
                      `已将 ${member.name} 的权限设为${roles[role]}。`,
                    );
                  });
                }}
                onRemove={(member, revokeInvites) =>
                  run(async () => {
                    await manage("member", {
                      userId: member.id,
                      role: null,
                      revokeInvites,
                    });
                    setMessage(`已将 ${member.name} 移出项目。`);
                  })
                }
                onInviteRole={setInviteRole}
                onInvite={(options) => {
                  void run(async () => {
                    const invitation = (await manage("invite", {
                      role: inviteRole,
                      ...options,
                    })) as {
                      url: string;
                      expiresAt: string;
                      maxUses?: number | null;
                      targetName?: string | null;
                    };
                    setGeneratedInvite(invitation.url);
                    setGeneratedInviteExpiresAt(invitation.expiresAt);
                    setGeneratedInvitePolicy(
                      invitation.targetName
                        ? `仅限账号 ${invitation.targetName}`
                        : invitation.maxUses != null
                          ? `最多 ${invitation.maxUses} 个账号`
                          : "不限账号数",
                    );
                  });
                }}
                onCopy={() =>
                  run(async () => {
                    await desktop.invoke("clipboard:write", {
                      text: generatedInvite,
                    });
                    setMessage("邀请链接已复制。");
                  })
                }
                onRevoke={(digest) => {
                  void run(async () => {
                    await manage("revokeInvite", { digest });
                    setMessage("邀请已撤销。");
                  });
                }}
                onArchive={(archived) =>
                  run(async () => {
                    await manage("project", { archived });
                    setMessage(
                      archived ? "项目已归档，可以随时恢复。" : "项目已恢复。",
                    );
                  })
                }
              />
            )}
            {panel === "conflict" && !conflict && !busy && !error && (
              <p className="settings-help">
                当前项目已经没有待处理的同步冲突。
              </p>
            )}
            {panel === "conflict" && conflict && (
              <section className="settings-group sync-conflict">
                <h2>处理同步冲突</h2>
                <p className="settings-help">
                  双方版本和历史都已保留。为每个冲突选择保留的内容，然后发布合并版本。
                </p>
                {conflict.files.map((file) => (
                  <div key={file.path}>
                    <h3>{file.path}</h3>
                    <p className="settings-help">
                      {conflictPreviews.get(file.path)?.description}
                    </p>
                    <div className="sync-conflict-columns">
                      {(["local", "remote"] as const).map((side) => (
                        <div key={side}>
                          <label>
                            <input
                              type="radio"
                              disabled={busy}
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
                          </label>
                          <pre>{conflictPreviews.get(file.path)?.[side]}</pre>
                        </div>
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
                        setPanel(null);
                      })
                    }
                  >
                    保存合并并同步
                  </button>
                  <button
                    className="settings-button"
                    onClick={() => setPanel(null)}
                  >
                    稍后处理
                  </button>
                </div>
              </section>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
