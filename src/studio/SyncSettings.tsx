import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Database,
  Folder,
  Link2,
  Plus,
  RefreshCw,
  Upload,
  X,
} from "../ui/icons";
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
import SyncAccountPanel, { IssuedToken } from "./SyncAccountPanel";
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
type Binding = Status["projects"][number];
type SyncKey = MessageKey<typeof messages>;
type ConnectMode = "login" | "register" | "token";
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
/** Visual tone of each sync state; anything needing attention reads as a problem. */
const stateTones: Record<Binding["status"], "ok" | "busy" | "problem"> = {
  synced: "ok",
  pending: "busy",
  offline: "problem",
  conflict: "problem",
  "save-failed": "problem",
  revoked: "problem",
};
const emptyForm = {
  url: "",
  account: "",
  password: "",
  registrationKey: "",
  token: "",
  tokenOnly: false,
  mode: "login" as ConnectMode,
};
export default function SyncSettings() {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const role = (value: ProjectRole) => t(roleKeys[value]);
  const [status, setStatus] = useState<Status | null>(null),
    [localProjects, setLocalProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [showConnect, setShowConnect] = useState(false),
    [server, setServer] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [accountPanel, setAccountPanel] = useState("");
  const [expanded, setExpanded] = useState(""),
    [confirmDetach, setConfirmDetach] = useState(""),
    [uploadTarget, setUploadTarget] = useState("");
  const [showJoin, setShowJoin] = useState(
    () => !!new URLSearchParams(location.search).get("invite"),
  );
  const connectSection = useRef<HTMLDivElement>(null);
  const [connectRequest, setConnectRequest] = useState(0);
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
    // Success notices fade; errors stay until dismissed or replaced.
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [message]);
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
    // Without an account there, the invitation card offers sign-in explicitly.
    if (existing) setServer(existing.id);
  }, [preview, status, server]);
  useEffect(() => {
    // Opening the form from an invite or a sign-out lands far from it on this page.
    if (!showConnect) return;
    const section = connectSection.current;
    section?.scrollIntoView({ block: "nearest" });
    [...(section?.querySelectorAll("input") ?? [])]
      .find((input) => !input.value)
      ?.focus({ preventScroll: true });
  }, [showConnect, connectRequest]);
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
    const register = form.mode === "register";
    const connection = await desktop.invoke<{
      id: string;
      issuedPersonalToken?: string;
    }>("sync:connect", {
      url: form.url,
      account: form.account,
      password:
        form.mode === "token" || (register && form.tokenOnly)
          ? undefined
          : form.password,
      registrationKey: register ? form.registrationKey : "",
      token: form.mode === "token" ? form.token : undefined,
      register,
      personalToken: register && form.tokenOnly,
      invite: preview?.invite,
    });
    setShowConnect(false);
    setIssuedToken(connection.issuedPersonalToken ?? "");
    setForm(emptyForm);
    if (preview) {
      await desktop.invoke("sync:join", {
        connectionId: connection.id,
        link: inviteLink,
      });
      setPreview(null);
      setInviteLink("");
      setShowJoin(false);
      setMessage(t("toast.joinedDownloading"));
      return;
    }
    setMessage(t("toast.connected", { name: form.account || form.url }));
    // An existing account usually has server projects to bring to this device.
    if (!register) await loadServer(connection.id);
  }
  function openConnect(next: Partial<typeof emptyForm> = {}) {
    setForm({ ...emptyForm, ...next });
    setShowConnect(true);
    setConnectRequest((value) => value + 1);
    setError("");
  }
  async function previewInvite() {
    const result = await desktop.invoke<NonNullable<typeof preview>>(
      "sync:previewInvite",
      { link: inviteLink },
    );
    setPreview(result);
    const existing = status?.connections.find(
      (connection) => connection.serverId === result.serverId,
    );
    setServer(existing?.id ?? "");
  }
  const connectionLabel = (id: string) => {
    const connection = status?.connections.find((item) => item.id === id);
    return connection ? `${connection.name} · ${connection.user.name}` : "";
  };
  const syncTime = (value?: string) =>
    value
      ? new Date(value).toLocaleString(getLocale(), {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  if (!status)
    return <p className="settings-help">{t("readingConnections")}</p>;
  const hidden = new Set(status.hiddenProjectIds ?? []);
  const bindingFor = (projectId: string) =>
    status.projects.find((item) => item.projectId === projectId);
  const projectsOn = (connectionId: string) =>
    status.projects.filter((item) => item.connectionId === connectionId).length;
  const attention = status.projects.filter(
    (item) => stateTones[item.status] === "problem",
  ).length;
  const invitedServer =
    preview &&
    status.connections.filter(
      (connection) => connection.serverId === preview.serverId,
    );
  return (
    <div className="sync-settings" aria-busy={busy}>
      <section
        className="settings-group sync-section"
        aria-labelledby="sync-projects-title"
      >
        <div className="sync-section-header">
          <div>
            <h2 id="sync-projects-title">{t("section.projects")}</h2>
            <p className="settings-help">
              {attention
                ? t("projectsAttention", { count: attention })
                : t("section.projectsHelp")}
            </p>
          </div>
          <button
            className="settings-button"
            aria-expanded={showJoin}
            disabled={busy}
            onClick={() => setShowJoin(!showJoin)}
          >
            <Link2 size={14} aria-hidden="true" />
            {t("joinShared")}
          </button>
        </div>
        {showJoin && (
          <div className="sync-card sync-join">
            <form
              className="sync-inline-field"
              onSubmit={(event) => {
                event.preventDefault();
                void run(previewInvite);
              }}
            >
              <label className="sync-field">
                <span>{t("inviteLinkLabel")}</span>
                <input
                  type="url"
                  required
                  placeholder={t("pasteInviteLink")}
                  value={inviteLink}
                  onChange={(event) => {
                    setInviteLink(event.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <button className="settings-button" disabled={busy}>
                {t("viewInvite")}
              </button>
              <button
                type="button"
                className="settings-icon-button"
                aria-label={t("closeJoin")}
                onClick={() => {
                  setShowJoin(false);
                  setPreview(null);
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </form>
            {preview && (
              <div className="sync-invitation">
                <Folder size={18} aria-hidden="true" />
                <div>
                  <strong>{preview.name}</strong>
                  <span>
                    {preview.serverName} · {preview.url}
                  </span>
                  <span>{t("joinAsRole", { role: role(preview.role) })}</span>
                </div>
                {invitedServer?.length ? (
                  <div className="sync-invitation-actions">
                    {invitedServer.length > 1 && (
                      <select
                        aria-label={t("joinWithAccount")}
                        value={server}
                        onChange={(event) => setServer(event.target.value)}
                      >
                        {invitedServer.map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.user.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className="settings-button sync-primary"
                      disabled={busy || !server}
                      onClick={() =>
                        void run(async () => {
                          await desktop.invoke("sync:join", {
                            connectionId: server,
                            link: inviteLink,
                          });
                          setPreview(null);
                          setInviteLink("");
                          setShowJoin(false);
                          setMessage(t("toast.joinedSyncing"));
                        })
                      }
                    >
                      {invitedServer.length > 1
                        ? t("confirmJoin")
                        : t("joinAs", { name: invitedServer[0].user.name })}
                    </button>
                  </div>
                ) : (
                  <div className="sync-invitation-actions">
                    <p className="settings-help">{t("signInBeforeJoin")}</p>
                    <button
                      className="settings-button sync-primary"
                      disabled={busy}
                      onClick={() =>
                        openConnect({
                          url: preview.url,
                          mode: preview.target_name ? "login" : "register",
                          account: preview.target_name ?? "",
                        })
                      }
                    >
                      {t("signInToJoin")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="sync-card">
          <div className="sync-card-row sync-default-row">
            <div>
              <label htmlFor="sync-default-location">
                {t("newProjectLocation")}
              </label>
              <p className="settings-help">{t("newProjectLocationDetail")}</p>
            </div>
            <select
              id="sync-default-location"
              value={status.defaultConnectionId ?? ""}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.value;
                void run(() =>
                  desktop.invoke("sync:default", {
                    connectionId: value || null,
                  }),
                );
              }}
            >
              <option value="">{t("localOnly")}</option>
              {status.connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connectionLabel(connection.id)}
                </option>
              ))}
            </select>
          </div>
          <ul className="sync-project-list">
            {localProjects.map((project) => {
              const binding = bindingFor(project.id),
                connection =
                  binding &&
                  status.connections.find(
                    (item) => item.id === binding.connectionId,
                  );
              const open = expanded === project.id;
              const tone = binding ? stateTones[binding.status] : "local";
              const sameServer = status.connections.filter(
                (item) => item.serverId === connection?.serverId,
              );
              const toggle = () => {
                setExpanded(open ? "" : project.id);
                setConfirmDetach("");
                setUploadTarget(
                  status.defaultConnectionId ?? status.connections[0]?.id ?? "",
                );
              };
              return (
                <li
                  key={project.id}
                  className={`sync-project-item ${open ? "is-open" : ""}`}
                >
                  <div className="sync-project-summary">
                    <div className="sync-project-name">
                      <strong>
                        {project.name}
                        {hidden.has(project.id) && (
                          <span className="sync-badge">
                            {t("hiddenOnDevice")}
                          </span>
                        )}
                      </strong>
                      <span>
                        {connection
                          ? `${connection.name} · ${connection.user.name} · ${role(binding!.role)}`
                          : t("storedLocally")}
                        {binding?.status === "synced" && binding.syncedAt
                          ? ` · ${t("syncedAt", { date: syncTime(binding.syncedAt) })}`
                          : ""}
                      </span>
                    </div>
                    <span className={`sync-state is-${tone}`}>
                      {binding
                        ? t(stateKeys[binding.status])
                        : t("status.local")}
                    </span>
                    <div className="sync-project-actions">
                      {binding?.status === "conflict" ? (
                        <button
                          className="settings-button sync-primary"
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
                          {t("resolveConflict")}
                        </button>
                      ) : binding ? (
                        <button
                          className="settings-button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await desktop.invoke("sync:run", {
                                projectId: project.id,
                              });
                              setMessage(
                                t("toast.synced", { name: project.name }),
                              );
                            })
                          }
                        >
                          <RefreshCw size={14} aria-hidden="true" />
                          {t("syncNow")}
                        </button>
                      ) : (
                        <button
                          className="settings-button"
                          disabled={busy || !status.connections.length}
                          title={
                            status.connections.length
                              ? undefined
                              : t("needAccountFirst")
                          }
                          onClick={() => {
                            if (!open) toggle();
                          }}
                        >
                          <Upload size={14} aria-hidden="true" />
                          {t("uploadToServer")}
                        </button>
                      )}
                      <button
                        className="settings-icon-button sync-disclosure"
                        aria-expanded={open}
                        aria-label={t("manageProject", { name: project.name })}
                        title={t("manageProject", { name: project.name })}
                        onClick={toggle}
                      >
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {binding?.error && (
                    <p className="sync-error sync-project-error">
                      {binding.error}
                    </p>
                  )}
                  {open && (
                    <div className="sync-project-details">
                      {binding ? (
                        <>
                          {sameServer.length > 1 && (
                            <div className="sync-detail-row">
                              <div>
                                <label htmlFor={`sync-account-${project.id}`}>
                                  {t("syncAccount")}
                                </label>
                                <p className="settings-help">
                                  {t("syncAccountHelp")}
                                </p>
                              </div>
                              <select
                                id={`sync-account-${project.id}`}
                                value={binding.connectionId}
                                disabled={busy}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  void run(() =>
                                    desktop.invoke("sync:changeAccount", {
                                      projectId: project.id,
                                      connectionId: value,
                                    }),
                                  );
                                }}
                              >
                                {sameServer.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.user.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div className="sync-detail-row">
                            <div>
                              <strong>{t("membersAndInvites")}</strong>
                              <p className="settings-help">
                                {binding.role === "admin"
                                  ? t("membersAdminHelp")
                                  : t("membersOnlyAdmins", {
                                      role: role(binding.role),
                                    })}
                              </p>
                            </div>
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
                          </div>
                        </>
                      ) : (
                        <form
                          className="sync-detail-row"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void run(async () => {
                              await desktop.invoke("sync:attach", {
                                projectId: project.id,
                                connectionId: uploadTarget,
                              });
                              setMessage(
                                t("toast.uploaded", {
                                  name: project.name,
                                  server: connectionLabel(uploadTarget),
                                }),
                              );
                            });
                          }}
                        >
                          <div>
                            <label htmlFor={`sync-upload-${project.id}`}>
                              {t("uploadAccount")}
                            </label>
                            <p className="settings-help">
                              {status.connections.length
                                ? t("uploadHelp")
                                : t("needAccountFirst")}
                            </p>
                          </div>
                          {!!status.connections.length && (
                            <div className="sync-detail-controls">
                              <select
                                id={`sync-upload-${project.id}`}
                                required
                                value={uploadTarget}
                                disabled={busy}
                                onChange={(event) =>
                                  setUploadTarget(event.target.value)
                                }
                              >
                                {status.connections.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {connectionLabel(item.id)}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="settings-button sync-primary"
                                disabled={busy || !uploadTarget}
                              >
                                {t("confirmUpload")}
                              </button>
                            </div>
                          )}
                        </form>
                      )}
                      <div className="sync-detail-row">
                        <div>
                          <label htmlFor={`sync-visible-${project.id}`}>
                            {t("showOnDevice")}
                          </label>
                          <p className="settings-help">
                            {t("showOnDeviceHelp")}
                          </p>
                        </div>
                        <input
                          id={`sync-visible-${project.id}`}
                          type="checkbox"
                          role="switch"
                          className="sync-switch"
                          disabled={busy}
                          checked={!hidden.has(project.id)}
                          onChange={(event) => {
                            const visible = event.target.checked;
                            void run(() =>
                              desktop.invoke("sync:projectVisibility", {
                                projectId: project.id,
                                visible,
                              }),
                            );
                          }}
                        />
                      </div>
                      {binding && (
                        <div className="sync-detail-row">
                          <div>
                            <strong>{t("detach")}</strong>
                            <p className="settings-help">{t("detachHelp")}</p>
                          </div>
                          {confirmDetach === project.id ? (
                            <div
                              className="sync-detail-controls"
                              role="group"
                              aria-label={t("confirmDetach")}
                            >
                              <button
                                className="settings-button"
                                disabled={busy}
                                onClick={() => setConfirmDetach("")}
                              >
                                {tc("cancel")}
                              </button>
                              <button
                                className="settings-button sync-danger-fill"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await desktop.invoke("sync:detach", {
                                      projectId: project.id,
                                    });
                                    setConfirmDetach("");
                                    setMessage(
                                      t("toast.detached", {
                                        name: project.name,
                                      }),
                                    );
                                  })
                                }
                              >
                                {t("confirmDetach")}
                              </button>
                            </div>
                          ) : (
                            <button
                              className="settings-button sync-danger"
                              disabled={busy}
                              onClick={() => setConfirmDetach(project.id)}
                            >
                              {t("detach")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!localProjects.length && (
            <p className="sync-empty">{t("noLocalProjects")}</p>
          )}
        </div>
      </section>
      <section
        className="settings-group sync-section"
        aria-labelledby="sync-servers-title"
      >
        <div className="sync-section-header">
          <div>
            <h2 id="sync-servers-title">{t("serverAccounts")}</h2>
            <p className="settings-help">{t("serverAccountsHelp")}</p>
          </div>
          {!showConnect && (
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => openConnect()}
            >
              <Plus size={14} aria-hidden="true" />
              {t("addServerAccount")}
            </button>
          )}
        </div>
        {issuedToken && (
          <IssuedToken
            token={issuedToken}
            busy={busy}
            run={run}
            onDone={() => setIssuedToken("")}
          />
        )}
        {!status.connections.length && !showConnect && (
          <p className="sync-empty">{t("noServers")}</p>
        )}
        {status.connections.map((connection) => {
          const open = accountPanel === connection.id;
          const count = projectsOn(connection.id);
          return (
            <article
              className={`sync-card sync-server ${open ? "is-open" : ""}`}
              key={connection.id}
            >
              <div className="sync-server-summary">
                <Database size={18} aria-hidden="true" />
                <div className="sync-server-name">
                  <strong>{connection.name}</strong>
                  <span>
                    {connection.user.name} · {connection.url}
                  </span>
                </div>
                <span className="sync-server-count">
                  {count
                    ? t("projectsSyncing", { count })
                    : t("noProjectsSyncing")}
                </span>
              </div>
              <div className="sync-server-actions">
                <button
                  className="settings-button"
                  disabled={busy}
                  title={t("serverProjectsHelp")}
                  onClick={() => void run(() => loadServer(connection.id))}
                >
                  {t("serverProjects")}
                </button>
                <button
                  className="settings-button"
                  disabled={busy}
                  title={t("membersAdminHelp")}
                  onClick={() => void run(() => loadDashboard(connection.id))}
                >
                  {t("membersAndInvites")}
                </button>
                <button
                  className="settings-button"
                  aria-expanded={open}
                  onClick={() => setAccountPanel(open ? "" : connection.id)}
                >
                  {t("accountAndDevices")}
                  <ChevronDown
                    className="sync-chevron"
                    size={14}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {open && (
                <SyncAccountPanel
                  connection={connection}
                  busy={busy}
                  syncedProjects={count}
                  run={run}
                  notify={setMessage}
                  onSignedOut={() => {
                    setAccountPanel("");
                    openConnect({
                      url: connection.url,
                      account: connection.user.name,
                    });
                  }}
                  onRemoved={() => {
                    setAccountPanel("");
                    setMessage(
                      t("toast.connectionRemoved", { name: connection.name }),
                    );
                  }}
                />
              )}
            </article>
          );
        })}
        {showConnect && (
          <div className="sync-card sync-connect" ref={connectSection}>
            <div className="sync-connect-heading">
              <h3>
                {preview
                  ? t("connectForInvite", { name: preview.name })
                  : t("addServerAccount")}
              </h3>
              <button
                className="settings-icon-button"
                aria-label={tc("cancel")}
                disabled={busy}
                onClick={() => setShowConnect(false)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <form
              className="sync-connect-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(connect);
              }}
            >
              <label className="sync-field">
                <span>{t("serverUrl")}</span>
                <input
                  required
                  type="url"
                  placeholder="https://showai.example.com"
                  value={form.url}
                  onChange={(event) =>
                    setForm({ ...form, url: event.target.value })
                  }
                />
                <small>{t("serverUrlHint")}</small>
              </label>
              <div
                className="sync-segmented"
                role="radiogroup"
                aria-label={t("connectMethod")}
              >
                {(["login", "register", "token"] as const).map((mode) => (
                  <label
                    key={mode}
                    className={form.mode === mode ? "is-active" : ""}
                  >
                    <input
                      type="radio"
                      name="sync-connect-mode"
                      value={mode}
                      checked={form.mode === mode}
                      onChange={() => setForm({ ...form, mode })}
                    />
                    {t(`mode.${mode}`)}
                  </label>
                ))}
              </div>
              {form.mode === "token" ? (
                <label className="sync-field">
                  <span>{t("token")}</span>
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    value={form.token}
                    onChange={(event) =>
                      setForm({ ...form, token: event.target.value })
                    }
                  />
                  <small>{t("tokenHint")}</small>
                </label>
              ) : (
                <div className="sync-field-grid">
                  <label className="sync-field">
                    <span>{t("account")}</span>
                    <input
                      required
                      autoComplete="username"
                      value={form.account}
                      onChange={(event) =>
                        setForm({ ...form, account: event.target.value })
                      }
                    />
                  </label>
                  {!(form.mode === "register" && form.tokenOnly) && (
                    <label className="sync-field">
                      <span>{t("password")}</span>
                      <input
                        required
                        minLength={form.mode === "register" ? 12 : 1}
                        maxLength={1024}
                        placeholder={
                          form.mode === "register"
                            ? t("passwordMinLength")
                            : undefined
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
                </div>
              )}
              {form.mode === "register" && (
                <>
                  {preview ? (
                    <p className="settings-help">{t("inviteRegistration")}</p>
                  ) : (
                    <label className="sync-field">
                      <span>{t("registrationKey")}</span>
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
                      <small>{t("registrationKeyHelp")}</small>
                    </label>
                  )}
                  <label className="sync-check">
                    <input
                      type="checkbox"
                      checked={form.tokenOnly}
                      onChange={(event) =>
                        setForm({ ...form, tokenOnly: event.target.checked })
                      }
                    />
                    <span>
                      {t("tokenOnly")}
                      <small>{t("tokenOnlyHelp")}</small>
                    </span>
                  </label>
                </>
              )}
              <div className="sync-form-actions">
                <button
                  className="settings-button sync-primary"
                  type="submit"
                  disabled={busy}
                >
                  {preview ? t("connectAndJoin") : t(`submit.${form.mode}`)}
                </button>
                <button
                  type="button"
                  className="settings-button"
                  disabled={busy}
                  onClick={() => setShowConnect(false)}
                >
                  {tc("cancel")}
                </button>
              </div>
            </form>
            {form.mode !== "token" && (
              <ServiceLogin
                url={form.url}
                registrationKey={
                  form.mode === "register" ? form.registrationKey : ""
                }
                onConnected={async (id) => {
                  setShowConnect(false);
                  setForm(emptyForm);
                  await refresh();
                  setMessage(t("toast.connected", { name: form.url }));
                  await loadServer(id);
                }}
              />
            )}
          </div>
        )}
      </section>
      <AccountBindings connections={status.connections} refresh={refresh} />
      {(error || message) && !panel && (
        <div
          className={`sync-feedback ${error ? "is-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <p>{error || message}</p>
          <button
            className="settings-icon-button"
            aria-label={t("dismiss")}
            onClick={() => {
              setError("");
              setMessage("");
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
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
