import { useEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  FolderOpen,
  LogOut,
  Settings2,
  Folder,
  Plus,
  RefreshCw,
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
import AccountLogin from "./AccountLogin";
import ProjectManager, { type ManagedSyncStatus } from "./ProjectManager";
import SyncAccountPanel, { IssuedToken } from "./SyncAccountPanel";
import { conflictPreview } from "./sync-conflict-preview";
import type { ProjectSummary } from "../core/model";
import type { SyncProject, ProjectRole } from "../sync/protocol";
import type { SyncConflict } from "../sync/manager";
import { type MessageKey } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sync";
import common from "../i18n/messages/common";
import { PendingNotice } from "../ui/PendingNotice";
import flowMessages from "../i18n/messages/accountFlow";

import "./sync-settings.css";
import { PackagingDialog, type PackagingPlan } from "./PackagingDialog";
type Status = ManagedSyncStatus;
type SyncKey = MessageKey<typeof messages>;
const roleKeys: Record<ProjectRole, SyncKey> = {
  admin: "role.admin",
  editor: "role.editor",
  viewer: "role.viewer",
};
const defaultServer = "https://showai.renaissancemind.ai/cloud";
export type ProjectSyncRequest = {
  projectId: string;
  /**
   * signIn: the project's account must sign in again. packaging: choose
   * what synchronization carries, starting at the item `focus`.
   */
  intent: "share" | "sync" | "signIn" | "packaging" | "manage";
  focus?: string;
  key: number;
};
const pendingInviteKey = "showai:pending-invitation";
const pendingInvite = () =>
  new URLSearchParams(location.search).get("invite") ||
  localStorage.getItem(pendingInviteKey) ||
  "";
export default function SyncSettings({
  request,
  onOpenProject,
}: {
  request?: ProjectSyncRequest;
  onOpenProject?: (projectId: string) => Promise<void>;
}) {
  const f = useTranslator(flowMessages);
  const handledRequest = useRef<number | undefined>(undefined);
  const [uploadProject, setUploadProject] = useState<ProjectSyncRequest | null>(
    null,
  );
  const [joinIntent, setJoinIntent] = useState(false);
  const [activeView, setActiveView] = useState<"accounts" | "projects">(
    "projects",
  );
  const [projectFilter, setProjectFilter] = useState("all");
  const initialized = useRef(false);
  const [dashboardFocused, setDashboardFocused] = useState(false);
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const role = (value: ProjectRole) => t(roleKeys[value]);
  const [status, setStatus] = useState<Status | null>(null),
    [localProjects, setLocalProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [loginInitial, setLoginInitial] = useState<{
    url: string;
    account?: string;
  }>({ url: defaultServer });
  const [showConnect, setShowConnect] = useState(false),
    [server, setServer] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [packaging, setPackaging] = useState<{
    projectId: string;
    name: string;
    plan: PackagingPlan;
    focus?: string;
  } | null>(null);
  const [accountPanel, setAccountPanel] = useState("");
  const [expanded, setExpanded] = useState(""),
    [confirmDetach, setConfirmDetach] = useState(""),
    [uploadTarget, setUploadTarget] = useState("");
  const [showJoin, setShowJoin] = useState(() => !!pendingInvite());
  const connectSection = useRef<HTMLDivElement>(null);
  const [connectRequest, setConnectRequest] = useState(0);
  const [panel, setPanel] = useState<
    "dashboard" | "conflict" | "upload" | null
  >(null);
  const panelBody = useRef<HTMLDivElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const actionFocus = useRef<HTMLElement | null>(null);
  const [remote, setRemote] = useState<SyncProject[]>([]),
    [dashboard, setDashboard] = useState<string | null>(null),
    [managedProject, setManagedProject] = useState("");
  const [members, setMembers] = useState<SyncMember[]>([]),
    [invites, setInvites] = useState<SyncInvite[]>([]),
    [inviteRole, setInviteRole] = useState<ProjectRole>("viewer"),
    [generatedInvite, setGeneratedInvite] = useState("");
  const [generatedInviteExpiresAt, setGeneratedInviteExpiresAt] = useState("");
  const [generatedInvitePolicy, setGeneratedInvitePolicy] = useState("");
  const [inviteLink, setInviteLink] = useState(() => pendingInvite()),
    [preview, setPreview] = useState<{
      url: string;
      invite: string;
      project_id: string;
      name: string;
      role: ProjectRole;
      serverId: string;
      target_name?: string | null;
      serverName: string;
      invitedBy?: string;
      joined?: boolean;
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
          desktop
            .invoke<{ projects: ProjectSummary[] }>("projects:scan", {
              includeArchived: true,
              includeHidden: true,
            })
            .then((scan) => scan.projects),
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
    if (!status || initialized.current) return;
    initialized.current = true;
    if (!status.connections.some((item) => !item.signedOut) && !request) {
      setActiveView("accounts");
      openConnect();
    }
  }, [status, request]);
  useEffect(() => {
    // Success notices fade; errors stay until dismissed or replaced.
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const link = pendingInvite();
    if (!link) return;
    void desktop
      .invoke<NonNullable<typeof preview>>("sync:previewInvite", { link })
      .then((result) => {
        setPreview(result);
        setLoginInitial({
          url: result.url,
          account: result.target_name ?? undefined,
        });
      })
      .catch((error) => setError(errorMessage(error)));
  }, []);
  useEffect(() => {
    if (inviteLink) localStorage.setItem(pendingInviteKey, inviteLink);
    else localStorage.removeItem(pendingInviteKey);
  }, [inviteLink]);
  useEffect(() => {
    if (!request || !status || handledRequest.current === request.key) return;
    handledRequest.current = request.key;
    if (request.intent === "manage") {
      setActiveView("projects");
      return;
    }
    setActiveView(request.intent === "signIn" ? "accounts" : "projects");
    const binding = status.projects.find(
      (item) => item.projectId === request.projectId,
    );
    if (request.intent === "signIn") {
      const connection = status.connections.find(
        (item) => item.id === binding?.connectionId,
      );
      if (connection)
        openConnect({ url: connection.url, account: connection.user.name });
      return;
    }
    if (request.intent === "packaging") {
      if (!binding) return;
      setExpanded(request.projectId);
      const name =
        localProjects.find((item) => item.id === request.projectId)?.name ??
        request.projectId;
      void run(async () =>
        setPackaging({
          projectId: request.projectId,
          name,
          focus: request.focus,
          plan: await desktop.invoke<PackagingPlan>("packaging:sync", {
            projectId: request.projectId,
          }),
        }),
      );
      return;
    }
    if (binding && request.intent === "share") {
      if (binding.role === "admin")
        void run(() =>
          loadDashboard(binding.connectionId, binding.remoteProjectId),
        );
      else {
        setExpanded(request.projectId);
        setMessage(t("membersOnlyAdmins", { role: role(binding.role) }));
      }
    } else if (binding) setExpanded(request.projectId);
    else {
      setUploadProject(request);
      setUploadTarget(
        status.defaultConnectionId ||
          status.connections.find((item) => !item.signedOut)?.id ||
          "",
      );
      setPanel("upload");
    }
  }, [request, status]);
  useEffect(() => {
    if (!preview || !status || server) return;
    const existing = status.connections.find(
      (connection) =>
        !connection.signedOut && connection.serverId === preview.serverId,
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
    if (!panel && active instanceof HTMLElement && active !== document.body)
      panelTrigger.current = active;
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
  async function loadDashboard(
    connectionId: string,
    projectId?: string,
    focused = !!projectId,
  ) {
    setDashboardFocused(focused);
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
    await loadDashboard(dashboard!, managedProject, dashboardFocused);
    return result;
  }
  async function downloadRemote(connectionId: string, remoteProjectId: string) {
    await desktop.invoke("sync:subscribe", { connectionId, remoteProjectId });
    const next = await desktop.invoke<Status>("sync:status");
    const binding = next.projects.find(
      (item) =>
        item.connectionId === connectionId &&
        item.remoteProjectId === remoteProjectId,
    );
    if (!binding) throw new Error(t("readingProjects"));
    if (binding.error) throw new Error(binding.error);
    await refresh();
    setPanel(null);
    setActiveView("projects");
    setProjectFilter(connectionId);
    setMessage(
      f("projects.downloaded", {
        name:
          localProjects.find((item) => item.id === binding.projectId)?.name ??
          "",
      }),
    );
  }
  async function acceptInvite(connectionId: string) {
    if (!preview) return;
    const target = preview.project_id;
    await desktop.invoke("sync:join", {
      connectionId,
      link: inviteLink,
      download: false,
    });
    setShowJoin(false);
    setActiveView("projects");
    setProjectFilter(connectionId);
    await downloadRemote(connectionId, target);
    setPreview(null);
    setInviteLink("");
    setShowJoin(false);
    setJoinIntent(false);
    localStorage.removeItem(pendingInviteKey);
  }
  async function connected(connectionId: string) {
    setShowConnect(false);
    await refresh();
    if (preview && joinIntent) {
      await acceptInvite(connectionId);
      return;
    }
    if (uploadProject) {
      setActiveView("projects");
      setUploadTarget(connectionId);
      setPanel("upload");
      return;
    }
    setActiveView("projects");
    setProjectFilter(connectionId);
    setMessage(f("connected"));
  }
  function openConnect(next: { url?: string; account?: string } = {}) {
    setLoginInitial({ url: next.url ?? defaultServer, account: next.account });
    setActiveView("accounts");
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
  if (!status)
    return (
      <PendingNotice
        label={t("readingConnections")}
        lines={3}
        minHeight={240}
      />
    );
  const projectsOn = (connectionId: string) =>
    status.projects.filter((item) => item.connectionId === connectionId).length;
  const invitedServer =
    preview &&
    status.connections.filter(
      (connection) =>
        !connection.signedOut && connection.serverId === preview.serverId,
    );
  return (
    <div className="sync-settings" aria-busy={busy}>
      <nav
        className="sync-view-tabs sync-flat-tabs"
        aria-label={f("projects.navigation")}
      >
        <button
          type="button"
          aria-pressed={activeView === "accounts"}
          onClick={() => setActiveView("accounts")}
        >
          {f("accounts")}
        </button>
        <button
          type="button"
          aria-pressed={activeView === "projects"}
          onClick={() => setActiveView("projects")}
        >
          {f("projects.title")}
        </button>
      </nav>
      {activeView === "accounts" && (
        <section className="sync-accounts-view">
          <div className="sync-manager-heading">
            <h2>{showConnect ? f("auth.title") : f("accounts")}</h2>
            <div className="sync-manager-actions">
              {showConnect ? (
                <button
                  type="button"
                  className="studio-icon"
                  aria-label={tc("cancel")}
                  title={tc("cancel")}
                  onClick={() => setShowConnect(false)}
                >
                  <X size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  className="studio-icon"
                  aria-label={f("addAccount")}
                  title={f("addAccount")}
                  onClick={() => openConnect()}
                >
                  <Plus size={19} />
                </button>
              )}
            </div>
          </div>
          {issuedToken && (
            <IssuedToken
              token={issuedToken}
              busy={busy}
              run={run}
              onDone={() => setIssuedToken("")}
            />
          )}
          {showConnect ? (
            <div ref={connectSection}>
              <AccountLogin
                key={connectRequest}
                initial={loginInitial}
                invite={joinIntent ? preview?.invite : undefined}
                onConnected={async (id, token) => {
                  setIssuedToken(token ?? "");
                  await run(() => connected(id));
                }}
              />
            </div>
          ) : (
            status.connections.map((connection) => (
              <article key={connection.id} className="sync-account-row">
                <Database size={20} />
                <div className="sync-account-identity">
                  <strong>{connection.user.name}</strong>
                  <span>
                    {connection.name} · {connection.url}
                  </span>
                  {connection.signedOut && <span>{f("signedOut")}</span>}
                </div>
                <div className="sync-manager-actions">
                  {connection.signedOut ? (
                    <button
                      type="button"
                      className="studio-icon"
                      aria-label={f("signIn")}
                      title={f("signIn")}
                      onClick={() =>
                        openConnect({
                          url: connection.url,
                          account: connection.user.name,
                        })
                      }
                    >
                      <RefreshCw size={18} />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="studio-icon"
                        aria-label={f("viewProjects")}
                        title={f("viewProjects")}
                        onClick={() => {
                          setProjectFilter(connection.id);
                          setActiveView("projects");
                        }}
                      >
                        <FolderOpen size={18} />
                      </button>
                      <button
                        type="button"
                        className="studio-icon"
                        aria-label={t("accountAndDevices")}
                        title={t("accountAndDevices")}
                        aria-expanded={accountPanel === connection.id}
                        onClick={() =>
                          setAccountPanel(
                            accountPanel === connection.id ? "" : connection.id,
                          )
                        }
                      >
                        <Settings2 size={18} />
                      </button>
                      <button
                        type="button"
                        className="studio-icon"
                        aria-label={f("signOut")}
                        title={f("signOut")}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await desktop.invoke("sync:signOut", {
                              connectionId: connection.id,
                            });
                            setAccountPanel("");
                            setMessage(f("signedOut"));
                          })
                        }
                      >
                        <LogOut size={18} />
                      </button>
                    </>
                  )}
                </div>
                {!connection.signedOut && accountPanel === connection.id && (
                  <SyncAccountPanel
                    connection={connection}
                    busy={busy}
                    syncedProjects={projectsOn(connection.id)}
                    run={run}
                    notify={setMessage}
                    onSignedOut={() =>
                      openConnect({
                        url: connection.url,
                        account: connection.user.name,
                      })
                    }
                    onRemoved={() => {
                      setAccountPanel("");
                      void refresh();
                    }}
                  />
                )}
              </article>
            ))
          )}
          {!showConnect && !status.connections.length && (
            <button
              className="settings-button sync-primary"
              onClick={() => openConnect()}
            >
              {f("auth.title")}
            </button>
          )}
          {!!status.connections.some((item) => !item.signedOut) &&
            !showConnect && (
              <details className="sync-account-disclosure">
                <summary>{f("accountAdvanced")}</summary>
                <AccountBindings
                  connections={status.connections}
                  refresh={refresh}
                />
                <label className="sync-field">
                  <span>{f("defaults")}</span>
                  <select
                    value={status.defaultConnectionId ?? ""}
                    onChange={(e) =>
                      void run(() =>
                        desktop.invoke("sync:default", {
                          connectionId: e.target.value || null,
                        }),
                      )
                    }
                  >
                    <option value="">{t("localOnly")}</option>
                    {status.connections
                      .filter((item) => !item.signedOut)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {connectionLabel(item.id)}
                        </option>
                      ))}
                  </select>
                </label>
              </details>
            )}
        </section>
      )}
      {activeView === "projects" && (
        <>
          <ProjectManager
            status={status}
            localProjects={localProjects}
            filter={projectFilter}
            onFilter={setProjectFilter}
            onRefresh={refresh}
            onOpenProject={onOpenProject}
            onJoin={() => setShowJoin(!showJoin)}
            onSignIn={(account) =>
              openConnect({ url: account.url, account: account.user.name })
            }
            onShare={(row) => {
              if (row.connection && row.remote)
                void run(() =>
                  loadDashboard(row.connection!.id, row.remote!.id),
                );
              else if (row.local) {
                setUploadProject({
                  projectId: row.local.id,
                  intent: "share",
                  key: Date.now(),
                });
                setUploadTarget(
                  status.defaultConnectionId ??
                    status.connections.find((item) => !item.signedOut)?.id ??
                    "",
                );
                setPanel("upload");
              }
            }}
            onUpload={(id) => {
              setUploadProject({
                projectId: id,
                intent: "sync",
                key: Date.now(),
              });
              setUploadTarget(
                status.defaultConnectionId ??
                  status.connections.find((item) => !item.signedOut)?.id ??
                  "",
              );
              setPanel("upload");
            }}
            onDetails={setExpanded}
            onConflict={(binding) =>
              void run(async () => {
                setPanel("conflict");
                setConflict(null);
                setChoices({});
                setConflict(
                  await desktop.invoke("sync:conflict", {
                    projectId: binding.projectId,
                  }),
                );
              })
            }
          />
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
                    setInviteLink("");
                    setJoinIntent(false);
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
                    {preview.invitedBy && (
                      <span>{f("invitedBy", { name: preview.invitedBy })}</span>
                    )}
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
                            if (preview.joined) {
                              await downloadRemote(server, preview.project_id);
                              setPreview(null);
                              setInviteLink("");
                              setShowJoin(false);
                              localStorage.removeItem(pendingInviteKey);
                            } else await acceptInvite(server);
                          })
                        }
                      >
                        {preview.joined
                          ? f("openProject")
                          : invitedServer.length > 1
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
                        onClick={() => {
                          setJoinIntent(true);
                          openConnect({
                            url: preview.url,
                            account: preview.target_name ?? "",
                          });
                        }}
                      >
                        {f("signInJoin")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
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
          initialFocus="auto"
          returnFocus={panelTrigger.current}
          title={
            panel === "upload"
              ? f(
                  uploadProject?.intent === "share"
                    ? "shareTitle"
                    : "uploadTitle",
                )
              : panel === "dashboard"
                ? f("manageMembers")
                : t("compareChanges")
          }
          wide
          onClose={() => {
            setPanel(null);
            if (panel === "upload") setUploadProject(null);
          }}
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
            {panel === "upload" && uploadProject && (
              <section className="settings-group">
                <h3>
                  {
                    localProjects.find(
                      (project) => project.id === uploadProject.projectId,
                    )?.name
                  }
                </h3>
                <p>
                  {f(
                    uploadProject.intent === "share"
                      ? "shareHelp"
                      : "uploadHelp",
                    {
                      name:
                        localProjects.find(
                          (project) => project.id === uploadProject.projectId,
                        )?.name ?? "",
                    },
                  )}
                </p>
                {status.connections.some((item) => !item.signedOut) ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await desktop.invoke("sync:attach", {
                          projectId: uploadProject.projectId,
                          connectionId: uploadTarget,
                        });
                        if (uploadProject.intent === "share") {
                          const next =
                            await desktop.invoke<Status>("sync:status");
                          const binding = next.projects.find(
                            (item) =>
                              item.projectId === uploadProject.projectId,
                          )!;
                          await loadDashboard(
                            binding.connectionId,
                            binding.remoteProjectId,
                          );
                        } else {
                          setPanel(null);
                          // Attaching starts the sync; it has not finished yet.
                          setMessage(
                            t("toast.uploaded", {
                              name:
                                localProjects.find(
                                  (project) =>
                                    project.id === uploadProject.projectId,
                                )?.name ?? "",
                              server: connectionLabel(uploadTarget),
                            }),
                          );
                        }
                        setUploadProject(null);
                      });
                    }}
                  >
                    <label className="sync-field">
                      <span>{f("chooseAccount")}</span>
                      <select
                        required
                        value={uploadTarget}
                        onChange={(event) =>
                          setUploadTarget(event.target.value)
                        }
                      >
                        {status.connections
                          .filter((item) => !item.signedOut)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {item.user.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="settings-button sync-primary"
                      disabled={busy || !uploadTarget}
                    >
                      {uploadProject.intent === "share"
                        ? f("uploadShare")
                        : f("enableSync")}
                    </button>
                  </form>
                ) : (
                  <button
                    className="settings-button sync-primary"
                    onClick={() => {
                      setPanel(null);
                      openConnect();
                    }}
                  >
                    {f("addAccount")}
                  </button>
                )}
              </section>
            )}
            {panel === "dashboard" && dashboard && (
              <SyncDashboard
                focused={dashboardFocused}
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
                  void run(() =>
                    loadDashboard(dashboard, id, dashboardFocused),
                  );
                }}
                onCreate={(name) =>
                  run(async () => {
                    const project = await desktop.invoke<{ id: string }>(
                      "sync:createProject",
                      { connectionId: dashboard, name },
                    );
                    await loadDashboard(
                      dashboard,
                      project.id,
                      dashboardFocused,
                    );
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
                    await desktop.invoke("clipboard:write", {
                      text: invitation.url,
                    });
                    setMessage(t("toast.inviteCopied"));
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
                onCopy={(url) =>
                  run(async () => {
                    await desktop.invoke("clipboard:write", {
                      text: url || generatedInvite,
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
      {expanded &&
        (() => {
          const binding = status.projects.find(
              (item) => item.projectId === expanded,
            ),
            project = localProjects.find((item) => item.id === expanded);
          if (!binding || !project) return null;
          const connection = status.connections.find(
            (item) => item.id === binding.connectionId,
          );
          const sameServer = status.connections.filter(
            (item) => item.serverId === connection?.serverId && !item.signedOut,
          );
          return (
            <Dialog
              title={f("projects.details")}
              onClose={() => setExpanded("")}
              className="sync-dialog"
            >
              <div className="sync-dialog-body">
                <h3>{project.name}</h3>
                {sameServer.length > 1 && (
                  <label className="sync-field">
                    <span>{t("syncAccount")}</span>
                    <select
                      value={binding.connectionId}
                      onChange={(e) =>
                        void run(() =>
                          desktop.invoke("sync:changeAccount", {
                            projectId: project.id,
                            connectionId: e.target.value,
                          }),
                        )
                      }
                    >
                      {sameServer.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {binding.error && <p className="sync-error">{binding.error}</p>}
                {binding.role !== "viewer" && (
                  <button
                    type="button"
                    className="sync-text-button"
                    onClick={() =>
                      void run(async () =>
                        setPackaging({
                          projectId: project.id,
                          name: project.name,
                          plan: await desktop.invoke<PackagingPlan>(
                            "packaging:sync",
                            { projectId: project.id },
                          ),
                        }),
                      )
                    }
                  >
                    {t("choosePackagedFiles")}
                  </button>
                )}
                <label className="sync-detail-row">
                  <span>{t("showOnDevice")}</span>
                  <input
                    type="checkbox"
                    checked={!status.hiddenProjectIds?.includes(project.id)}
                    onChange={(e) =>
                      void run(() =>
                        desktop.invoke("sync:projectVisibility", {
                          projectId: project.id,
                          visible: e.target.checked,
                        }),
                      )
                    }
                  />
                </label>
                <details className="sync-account-disclosure">
                  <summary>{t("detach")}</summary>
                  <p className="settings-help">{t("detachHelp")}</p>
                  {confirmDetach === project.id ? (
                    <div className="sync-form-actions">
                      <button
                        className="sync-text-button"
                        onClick={() => setConfirmDetach("")}
                      >
                        {tc("cancel")}
                      </button>
                      <button
                        className="sync-text-button sync-danger"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await desktop.invoke("sync:detach", {
                              projectId: project.id,
                            });
                            setExpanded("");
                            setConfirmDetach("");
                            setMessage(
                              t("toast.detached", { name: project.name }),
                            );
                          })
                        }
                      >
                        {t("confirmDetach")}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="sync-text-button sync-danger"
                      onClick={() => setConfirmDetach(project.id)}
                    >
                      {t("detach")}
                    </button>
                  )}
                </details>
              </div>
            </Dialog>
          );
        })()}
      {packaging && (
        <PackagingDialog
          plan={packaging.plan}
          purpose="sync"
          focus={packaging.focus}
          onDecide={(decisions) => {
            const current = packaging;
            setPackaging(null);
            if (!decisions) return;
            void run(async () => {
              await desktop.invoke("packaging:sync", {
                projectId: current.projectId,
                packaging: decisions,
              });
              setMessage(t("toast.packaging", { name: current.name }));
            });
          }}
        />
      )}
    </div>
  );
}
