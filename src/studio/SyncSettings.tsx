import { useEffect, useMemo, useRef, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import { coalescedTask } from "../lib/coalesced-task";
import { retainEqual } from "./navigation-refresh";
import Dialog from "./Dialog";
import SyncDashboard, {
  type SyncMember,
  type SyncInvite,
} from "./SyncDashboard";
import AccountBindings from "./AccountBindings";
import ServiceLogin from "./ServiceLogin";
import LoginMethods from "./LoginMethods";
import { conflictPreview } from "./sync-conflict-preview";
import type { ProjectSummary } from "../core/model";
import type {
  SyncConfiguration,
  SyncProject,
  ProjectRole,
} from "../sync/protocol";
import type { SyncConflict } from "../sync/manager";
import { getLocale, type MessageKey } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sync";
import common from "../i18n/messages/common";
import "./sync-settings.css";
type Status = Omit<SyncConfiguration, "connections"> & {
  connections: Omit<SyncConfiguration["connections"][number], "token">[];
  running: boolean;
};
type SyncKey = MessageKey<typeof messages>;
const roleKeys: Record<ProjectRole, SyncKey> = {
  admin: "role.admin",
  editor: "role.editor",
  viewer: "role.viewer",
};
const stateKeys = {
  pending: "state.pending",
  synced: "state.synced",
  "save-failed": "state.save-failed",
  offline: "state.offline",
  conflict: "state.conflict",
  revoked: "state.revoked",
} satisfies Record<string, SyncKey>;
export default function SyncSettings() {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const role = (value: ProjectRole) => t(roleKeys[value]);
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
  const [loginMethodsRevision, setLoginMethodsRevision] = useState(0);
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
  const refresh = useMemo(
    () =>
      coalescedTask(async () => {
        const [next, projects] = await Promise.all([
          desktop.invoke<Status>("sync:status"),
          desktop.invoke<ProjectSummary[]>("projects:list", {
            includeArchived: true,
            includeHidden: true,
          }),
        ]);
        setStatus((current) => retainEqual(current, next));
        setLocalProjects((current) => retainEqual(current, projects));
      }),
    [],
  );
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
      setMessage(t("toast.joinedDownloading"));
    }
    await loadServer(connection.id);
  }
  const connectionSelect = (
    value: string,
    change: (value: string) => void,
    empty = t("chooseServerAccount"),
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
  if (!status) return <p className="settings-help">{t("readingConnections")}</p>;
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
        <h2>{t("defaultStorage")}</h2>
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>{t("newProjectLocation")}</h3>
            <p>{t("newProjectLocationDetail")}</p>
          </div>
          {connectionSelect(
            status.defaultConnectionId ?? "",
            (value) =>
              void run(() =>
                desktop.invoke("sync:default", { connectionId: value || null }),
              ),
            t("localOnly"),
          )}
        </div>
      </section>
      <section className="settings-group">
        <h2>{t("serversAndAccounts")}</h2>
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
              {t("viewProjects")}
            </button>
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => void run(() => loadDashboard(connection.id))}
            >
              {t("manageProjects")}
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
              {t("accountAndDevices")}
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
              {t("removeConnection")}
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
          {showConnect ? t("hideConnect") : t("addServerAccount")}
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
              {t("serverUrl")}
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
              {t("connectMethod")}
              <select
                value={form.mode}
                onChange={(event) =>
                  setForm({ ...form, mode: event.target.value })
                }
              >
                <option value="login">{t("mode.login")}</option>
                <option value="register">{t("mode.register")}</option>
                <option value="personal">{t("mode.personal")}</option>
                <option value="token">{t("mode.token")}</option>
              </select>
            </label>
            {form.mode === "token" ? (
              <label>
                {t("token")}
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
                  {t("account")}
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
                    {t("password")}
                    <input
                      required
                      minLength={form.mode === "register" ? 12 : 1}
                      maxLength={1024}
                      placeholder={
                        form.mode === "register" ? t("passwordMinLength") : undefined
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
                    {t("registrationKey")}
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
              {preview ? t("connectAndJoin") : t("connectServer")}
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
              {t("newPersonalToken")}
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
              {t("copyPersonalToken")}
            </button>
            <button
              className="settings-button"
              onClick={() => setIssuedToken("")}
            >
              {t("tokenSaved")}
            </button>
          </div>
        )}
        {sessions && (
          <div className="sync-dashboard-list">
            <h3>
              {t("deviceSessions", {
                name:
                  status.connections.find(
                    (connection) => connection.id === sessionConnectionId,
                  )?.user.name ?? "",
              })}
            </h3>
            <p>{t("deviceSessionsHelp")}</p>
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
                setLoginMethodsRevision((value) => value + 1);
                setMessage(t("toast.loginMethodAdded"));
              }}
            />
            <LoginMethods
              connectionId={sessionConnectionId}
              revision={loginMethodsRevision}
            />
            {status.connections
              .find((connection) => connection.id === sessionConnectionId)
              ?.capabilities?.includes("account-security-v1") && (
              <>
                <details>
                  <summary>{t("changePassword")}</summary>
                  <p>{t("changePasswordHelp")}</p>
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
                        setMessage(t("toast.passwordChanged"));
                      });
                    }}
                  >
                    <label>
                      {t("currentPassword")}
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
                      {t("newPassword")}
                      <input
                        type="password"
                        required
                        minLength={12}
                        maxLength={1024}
                        placeholder={t("passwordMinLength")}
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
                      {t("saveNewPassword")}
                    </button>
                  </form>
                </details>
                <button
                  className="settings-button"
                  disabled={busy}
                  onClick={() => setConfirmSignOut(true)}
                >
                  {t("signOutAll")}
                </button>
                {confirmSignOut && (
                  <div role="group" aria-label={t("confirmSignOutAll")}>
                    <p>{t("signOutAllHelp")}</p>
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() => setConfirmSignOut(false)}
                    >
                      {tc("cancel")}
                    </button>
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const result = await desktop.invoke<{
                            unreachable: string[];
                          }>("sync:revokeAllTokens", {
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
                          setMessage(
                            result.unreachable.length
                              ? t("toast.signedOutAllPartial", {
                                  servers: result.unreachable.join(", "),
                                })
                              : t("toast.signedOutAll"),
                          );
                        })
                      }
                    >
                      {t("confirmSignOutAll")}
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
                    {new Date(session.created_at).toLocaleString(getLocale())} ·{" "}
                    {session.revoked
                      ? t("session.revoked")
                      : new Date(session.expires_at).getTime() <= Date.now()
                        ? t("session.expired")
                        : t("session.validUntil", {
                            date: new Date(session.expires_at).toLocaleString(
                              getLocale(),
                            ),
                          })}
                    {session.current ? ` · ${t("session.thisDevice")}` : ""}
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
                        setMessage(t("toast.sessionRevoked"));
                      } else
                        setSessions(
                          await desktop.invoke("sync:sessions", {
                            connectionId: sessionConnectionId,
                          }),
                        );
                    })
                  }
                >
                  {t("revokeToken")}
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
        <h2>{t("joinShared")}</h2>
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
            aria-label={t("inviteLinkLabel")}
            placeholder={t("pasteInviteLink")}
            value={inviteLink}
            onChange={(event) => {
              setInviteLink(event.target.value);
              setPreview(null);
            }}
          />
          <button className="settings-button" disabled={busy}>
            {t("viewInvite")}
          </button>
        </form>
        {preview && (
          <div className="sync-invitation">
            <h3>{preview.name}</h3>
            <p>
              {preview.serverName} · {preview.url} ·{" "}
              {t("joinAsRole", { role: role(preview.role) })}
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
                      setMessage(t("toast.joinedSyncing"));
                    })
                  }
                >
                  {t("confirmJoin")}
                </button>
              </div>
            ) : (
              <p className="settings-help">{t("signInBeforeJoin")}</p>
            )}
          </div>
        )}
      </section>
      <section className="settings-group">
        <h2>{t("projectStorage")}</h2>
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
                      ? `${connection.name} · ${connection.user.name} · ${role(binding!.role)} · ${t(stateKeys[binding!.status])}`
                      : t("storedLocally")}
                  </p>
                  {binding?.error && (
                    <p className="sync-error">{binding.error}</p>
                  )}
                </div>
                {binding ? (
                  <>
                    <select
                      aria-label={t("syncAccountFor", { name: project.name })}
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
                      {t("syncNow")}
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
                        {t("manageMembers")}
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
                      {t("detach")}
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
                    t("connectToServer"),
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
                  {t("compareChanges")}
                </button>
              )}
            </div>
          );
        })}
        {!localProjects.length && (
          <p className="settings-help">{t("noLocalProjects")}</p>
        )}
      </section>
      {panel && (
        <Dialog
          key={panel}
          title={
            panel === "projects"
              ? t("dialog.projects")
              : panel === "dashboard"
                ? t("manageProjects")
                : t("compareChanges")
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
                {t("processing")}
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
                  <p className="settings-help">{t("noRemoteProjects")}</p>
                )}
                {remote.map((project) => (
                  <div className="sync-connection" key={project.id}>
                    <div className="settings-row-text">
                      <h3>{project.name}</h3>
                      <p>
                        {role(project.role)}
                        {project.archived ? ` · ${t("archived")}` : ""}
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
                        ? t("addedLocally")
                        : t("addLocally")}
                    </button>
                    {project.role === "admin" && (
                      <button
                        className="settings-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() => loadDashboard(server, project.id))
                        }
                      >
                        {t("manageMembers")}
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
                    setMessage(t("toast.projectCreated", { name }));
                  })
                }
                onRole={(member, next) => {
                  void run(async () => {
                    await manage("member", { userId: member.id, role: next });
                    setMessage(
                      t("toast.roleChanged", {
                        name: member.name,
                        role: role(next),
                      }),
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
                    setMessage(t("toast.memberRemoved", { name: member.name }));
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
                        ? t("policy.target", { name: invitation.targetName })
                        : invitation.maxUses != null
                          ? t("policy.maxUses", { count: invitation.maxUses })
                          : t("policy.unlimited"),
                    );
                  });
                }}
                onCopy={() =>
                  run(async () => {
                    await desktop.invoke("clipboard:write", {
                      text: generatedInvite,
                    });
                    setMessage(t("toast.inviteCopied"));
                  })
                }
                onRevoke={(digest) => {
                  void run(async () => {
                    await manage("revokeInvite", { digest });
                    setMessage(t("toast.inviteRevoked"));
                  });
                }}
                onArchive={(archived) =>
                  run(async () => {
                    await manage("project", { archived });
                    setMessage(
                      archived
                        ? t("toast.projectArchived")
                        : t("toast.projectRestored"),
                    );
                  })
                }
              />
            )}
            {panel === "conflict" && !conflict && !busy && !error && (
              <p className="settings-help">{t("noConflicts")}</p>
            )}
            {panel === "conflict" && conflict && (
              <section className="settings-group sync-conflict">
                <h2>{t("resolveConflicts")}</h2>
                <p className="settings-help">{t("resolveConflictsHelp")}</p>
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
                              ? t("keepLocal")
                              : conflict.recovery
                                ? t("useMergeDraft")
                                : t("useServerVersion")}
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
                    {t("saveMergeAndSync")}
                  </button>
                  <button
                    className="settings-button"
                    onClick={() => setPanel(null)}
                  >
                    {t("resolveLater")}
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
