import { useNotify } from "../problems/toast-context";
import { useSessionDraft } from "./session-draft";
import {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  CircleAlert,
  Cloud,
  Folder,
  Plus,
} from "../ui/icons";
import { desktop, errorCode, errorMessage } from "../host/bridge";
import { coalescedTask } from "../lib/coalesced-task";
import { retainEqual } from "./navigation-refresh";
import Dialog from "../ui/Dialog";
import Select from "../ui/Select";
import SyncDashboard, {
  type SyncMember,
  type SyncInvite,
} from "./SyncDashboard";
import AccountBindings from "./AccountBindings";
import ServerAccountRow from "./ServerAccountRow";
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
  mode,
  onSelectSection,
  request,
  onOpenProject,
  home,
}: {
  mode?: "accounts" | "projects";
  onSelectSection?: (section: "sync" | "projects") => void;
  request?: ProjectSyncRequest;
  home?: string;
  onOpenProject?: (projectId: string) => Promise<void>;
}) {
  const f = useTranslator(flowMessages);
  const viewId = useId();
  const [managedAccountId, setManagedAccountId] = useState("");
  const handledRequest = useRef<number | undefined>(undefined);
  const [uploadProject, setUploadProject] = useState<ProjectSyncRequest | null>(
    null,
  );
  const [joinIntent, setJoinIntent] = useState(false);
  const [connectFromProjects, setConnectFromProjects] = useState(false);
  const [draftView, setDraftView] = useSessionDraft<"accounts" | "projects">(
    `sync-settings-view:${home ?? ""}`,
    "accounts",
  );
  const activeView = mode ?? draftView;
  const switchView = useCallback(
    (target: "accounts" | "projects") => {
      setDraftView(target);
      onSelectSection?.(target === "projects" ? "projects" : "sync");
    },
    [onSelectSection, setDraftView],
  );
  const [projectFilter, setProjectFilter] = useSessionDraft(
    `sync-settings-filter:${home ?? ""}`,
    "all",
  );
  const [dashboardFocused, setDashboardFocused] = useState(false);
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const role = (value: ProjectRole) => t(roleKeys[value]);
  const [status, setStatus] = useState<Status | null>(null),
    [localProjects, setLocalProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const notify = useNotify();
  const [loadFailure, setLoadFailure] = useState("");
  const reportFailure = useCallback(
    (detail: string) => {
      notify(t("operationFailed"), {
        kind: "warning",
        duration: 8000,
        details: detail,
      });
    },
    [notify, t],
  );
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
    let active = true;
    const poll = () =>
      void refresh().then(
        () => {
          if (active) setLoadFailure("");
        },
        (reason) => {
          if (active) setLoadFailure(errorMessage(reason));
        },
      );
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);

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
    if (mode === "projects") {
      setShowConnect(false);
      setManagedAccountId("");
      setConnectFromProjects(false);
    } else if (mode === "accounts") {
      setShowJoin(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!request || !status || handledRequest.current === request.key) return;
    handledRequest.current = request.key;
    if (request.intent === "manage") {
      setShowConnect(false);
      setManagedAccountId("");
      setShowJoin(false);
      switchView("projects");
      return;
    }
    switchView(request.intent === "signIn" ? "accounts" : "projects");
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
        notify(t("membersOnlyAdmins", { role: role(binding.role) }));
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
    if (existing) setServer(existing.id);
  }, [preview, status, server]);

  useEffect(() => {
    if (!showConnect) return;
    const section = connectSection.current;
    section?.scrollIntoView({ block: "nearest" });
    [...(section?.querySelectorAll("input") ?? [])]
      .find((input) => !input.value)
      ?.focus({ preventScroll: true });
  }, [showConnect, connectRequest]);

  useEffect(() => {
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
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      if (managedAccountId && !showConnect && errorCode(error) === "UNAUTHORIZED") {
        await refresh().catch((reason) => reportFailure(errorMessage(reason)));
        return false;
      }
      const detail = errorMessage(error);
      if (panel || showJoin) setError(detail);
      else reportFailure(detail);
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
    switchView("projects");
    setProjectFilter(connectionId);
    notify(
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
    switchView("projects");
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
      switchView("projects");
      await acceptInvite(connectionId);
      return;
    }
    if (uploadProject) {
      switchView("projects");
      setUploadTarget(connectionId);
      setPanel("upload");
      return;
    }
    if (connectFromProjects) {
      setConnectFromProjects(false);
      switchView("projects");
    }
    notify(f("connected"));
  }

  function openConnect(next: { url?: string; account?: string } = {}) {
    setConnectFromProjects(activeView === "projects");
    setLoginInitial({ url: next.url ?? defaultServer, account: next.account });
    setManagedAccountId("");
    setShowJoin(false);
    setShowConnect(true);
    setConnectRequest((value) => value + 1);
    setError("");
    switchView("accounts");
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

  if (!status) {
    return (
      <div className="sync-settings">
        {loadFailure ? (
          <div
            className="settings-callout sync-alert"
            data-tone="error"
            role="alert"
            aria-label={t("operationFailed")}
          >
            <CircleAlert size={16} aria-hidden="true" />
            <div className="settings-callout-body">
              <strong>{t("operationFailed")}</strong>
              <p>{t("loadFailedDetail", { error: loadFailure })}</p>
            </div>
            <button
              type="button"
              className="settings-button"
              onClick={() =>
                void refresh().then(
                  () => setLoadFailure(""),
                  (reason) => setLoadFailure(errorMessage(reason)),
                )
              }
            >
              {tc("retry")}
            </button>
          </div>
        ) : (
          <PendingNotice
            label={t("readingConnections")}
            lines={3}
            minHeight={240}
          />
        )}
      </div>
    );
  }

  const projectsOn = (connectionId: string) =>
    status.projects.filter((item) => item.connectionId === connectionId).length;
  const activeConnections = status.connections.filter(
    (connection) => !connection.signedOut,
  );
  const federatedAccounts = activeConnections.filter(
    (item) => item.capabilities?.includes("account-federation-v1"),
  );
  const showAccountBindings =
    federatedAccounts.some((item) => !item.sessionExpired) &&
    new Set(federatedAccounts.map((item) => item.serverId)).size >= 2;
  const managedAccount = status.connections.find(
    (connection) => connection.id === managedAccountId && !connection.signedOut,
  );
  const showJoinScreen = activeView === "projects" && showJoin;

  function returnToAccounts() {
    const previousId = managedAccountId;
    setManagedAccountId("");
    requestAnimationFrame(() =>
      (
        document.getElementById(`${viewId}-manage-account-${previousId}`) ??
        document.getElementById(`${viewId}-accounts-title`)
      )?.focus(),
    );
  }

  function cancelConnect() {
    setShowConnect(false);
    if (joinIntent) {
      setJoinIntent(false);
      setConnectFromProjects(false);
      setShowJoin(true);
      switchView("projects");
      requestAnimationFrame(() =>
        document.getElementById(`${viewId}-invite-link`)?.focus(),
      );
      return;
    }
    setConnectFromProjects(false);
    requestAnimationFrame(() =>
      document.getElementById(`${viewId}-accounts-title`)?.focus(),
    );
  }

  function cancelJoin() {
    setShowJoin(false);
    setPreview(null);
    setInviteLink("");
    setJoinIntent(false);
    setError("");
  }

  const uploadProjectName = uploadProject
    ? (localProjects.find((project) => project.id === uploadProject.projectId)
        ?.name ?? "")
    : "";

  function closePanel() {
    setPanel(null);
    if (panel === "upload") setUploadProject(null);
  }

  const invitedServer =
    preview &&
    status.connections.filter(
      (connection) =>
        !connection.signedOut && connection.serverId === preview.serverId,
    );

  return (
    <div className="sync-settings" aria-busy={busy}>
      {issuedToken && (
        <Dialog title={t("personalToken")} onClose={() => setIssuedToken("")}>
          <div className="studio-dialog-body">
            <IssuedToken
              token={issuedToken}
              busy={busy}
              run={run}
              onDone={() => setIssuedToken("")}
            />
          </div>
        </Dialog>
      )}

      {showConnect ? (
        <section className="sync-subpage" aria-label={f("auth.title")}>
          <header className="settings-subpage-bar">
            <button
              type="button"
              className="settings-button settings-back-button"
              onClick={cancelConnect}
            >
              <ChevronLeft size={15} aria-hidden="true" />
              {joinIntent ? f("backToProjects") : f("backToAccounts")}
            </button>
          </header>
          <div className="settings-card" ref={connectSection}>
            <div className="settings-card-section">
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
          </div>
        </section>
      ) : managedAccount ? (
        <section
          className="sync-subpage"
          aria-label={t("accountPanelFor", { name: managedAccount.user.name })}
        >
          <header className="settings-subpage-bar">
            <button
              type="button"
              className="settings-button settings-back-button"
              onClick={returnToAccounts}
            >
              <ChevronLeft size={15} aria-hidden="true" />
              {f("backToAccounts")}
            </button>
            <div
              className="settings-subpage-meta"
              id={`${viewId}-accounts-title`}
              tabIndex={-1}
            >
              <strong>{managedAccount.user.name}</strong>
              <span>· {managedAccount.name}</span>
            </div>
          </header>
          {managedAccount.sessionExpired && (
            <div className="settings-callout" data-tone="warn">
              <span>{f("sessionRejected")}</span>
              <button type="button" className="settings-button" onClick={() =>
                openConnect({ url: managedAccount.url, account: managedAccount.user.name })
              }>{f("signIn")}</button>
            </div>
          )}
          <SyncAccountPanel
            key={managedAccount.id}
            connection={managedAccount}
            busy={busy}
            syncedProjects={projectsOn(managedAccount.id)}
            run={run}
            notify={notify}
            onSignedOut={() =>
              openConnect({
                url: managedAccount.url,
                account: managedAccount.user.name,
              })
            }
            onRemoved={() => {
              setManagedAccountId("");
              requestAnimationFrame(() =>
                document.getElementById(`${viewId}-accounts-title`)?.focus(),
              );
            }}
          />
        </section>
      ) : showJoinScreen ? (
        <section className="sync-subpage" aria-label={f("invitationTitle")}>
          <header className="settings-subpage-bar">
            <button
              type="button"
              className="settings-button settings-back-button"
              onClick={cancelJoin}
            >
              <ChevronLeft size={15} aria-hidden="true" />
              {f("backToProjects")}
            </button>
          </header>
          <div className="settings-card">
            <div className="settings-card-section sync-join">
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
                    className="showai-input"
                    id={`${viewId}-invite-link`}
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
                <button
                  type="submit"
                  className="settings-button settings-primary-button"
                  disabled={busy}
                >
                  {t("viewInvite")}
                </button>
              </form>
              {error && (
                <div
                  className="settings-callout sync-alert"
                  data-tone="error"
                  role="alert"
                >
                  <CircleAlert size={15} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
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
                    <span>
                      {t("joinAsRole", { role: role(preview.role) })}
                    </span>
                  </div>
                  {invitedServer?.length ? (
                    <div className="sync-invitation-actions">
                      {invitedServer.length > 1 && (
                        <Select
                          aria-label={t("joinWithAccount")}
                          value={server}
                          onChange={(event) => setServer(event.target.value)}
                        >
                          {invitedServer.map((connection) => (
                            <option key={connection.id} value={connection.id}>
                              {connection.user.name}
                            </option>
                          ))}
                        </Select>
                      )}
                      <button
                        type="button"
                        className="settings-button settings-primary-button"
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
                            : t("joinAs", {
                                name: invitedServer[0].user.name,
                              })}
                      </button>
                    </div>
                  ) : (
                    <div className="sync-invitation-actions">
                      <p className="settings-help">{t("signInBeforeJoin")}</p>
                      <button
                        type="button"
                        className="settings-button settings-primary-button"
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
          </div>
        </section>
      ) : activeView === "accounts" ? (
        (() => {
          const accountRows = status.connections.map((connection) => (
            <ServerAccountRow
              key={connection.id}
              connection={connection}
              syncedCount={projectsOn(connection.id)}
              manageId={`${viewId}-manage-account-${connection.id}`}
              refresh={refresh}
              onSignIn={() => openConnect({ url: connection.url, account: connection.user.name })}
              onProjects={() => {
                setProjectFilter(connection.id);
                switchView("projects");
              }}
              onManage={() => {
                setManagedAccountId(connection.id);
                requestAnimationFrame(() =>
                  document.getElementById(`${viewId}-accounts-title`)?.focus(),
                );
              }}
            />
          ));

          const emptyCard = (
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <h3>{t("noServers")}</h3>
                  <p>{f("accountHelp")}</p>
                </div>
                <button
                  type="button"
                  className="settings-button settings-primary-button"
                  onClick={() => openConnect()}
                >
                  <Plus size={15} aria-hidden="true" />
                  {f("addAccount")}
                </button>
              </div>
            </div>
          );

          if (!showAccountBindings) {
            return (
              <section
                className="sync-accounts-view"
                id={`${viewId}-accounts-title`}
                tabIndex={-1}
                aria-label={f("accounts")}
              >
                {status.connections.length === 0 ? (
                  emptyCard
                ) : (
                  <div className="settings-card">
                    {accountRows}
                    <div className="settings-row sync-add-account-row">
                      <div className="settings-row-text">
                        <h3>{f("addAccount")}</h3>
                        <p>{t("serverAccountsHelp")}</p>
                      </div>
                      <button
                        type="button"
                        className="settings-button"
                        onClick={() => openConnect()}
                      >
                        <Plus size={15} aria-hidden="true" />
                        {f("addAccount")}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            );
          }

          return (
            <section className="sync-accounts-view" aria-label={f("accounts")}>
              <section
                className="settings-group"
                aria-labelledby={`${viewId}-accounts-title`}
              >
                <div className="settings-group-heading">
                  <div>
                    <h2 id={`${viewId}-accounts-title`} tabIndex={-1}>
                      {t("serverAccounts")}
                    </h2>
                    <p className="settings-group-desc">
                      {t("serverAccountsHelp")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="settings-button settings-primary-button"
                    onClick={() => openConnect()}
                  >
                    <Plus size={15} aria-hidden="true" />
                    {f("addAccount")}
                  </button>
                </div>
                <div className="settings-card">{accountRows}</div>
              </section>

              <AccountBindings
                connections={federatedAccounts}
                refresh={refresh}
              />
            </section>
          );
        })()
      ) : (
        <section className="sync-projects-view" aria-label={f("projects.title")}>
          {activeConnections.length === 0 ? (
            <div className="settings-callout sync-local-banner">
              <Cloud size={16} aria-hidden="true" />
              <div className="settings-callout-body">
                <strong>{t("localModeBannerTitle")}</strong>
                <p>{t("localModeBannerDetail")}</p>
              </div>
              <button
                type="button"
                className="settings-button"
                onClick={() => openConnect()}
              >
                <Plus size={14} aria-hidden="true" />
                {f("addAccount")}
              </button>
            </div>
          ) : (
            <div className="settings-card sync-default-location-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <label htmlFor={`${viewId}-default-location`}>
                    {f("defaults")}
                  </label>
                  <p>{f("defaultHelp")}</p>
                </div>
                <Select
                  id={`${viewId}-default-location`}
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
                  {activeConnections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {connectionLabel(item.id)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <ProjectManager
            status={status}
            localProjects={localProjects}
            filter={projectFilter}
            onFilter={setProjectFilter}
            onRefresh={refresh}
            onOpenProject={onOpenProject}
            onJoin={() => {
              setShowJoin(true);
              requestAnimationFrame(() =>
                document.getElementById(`${viewId}-invite-link`)?.focus(),
              );
            }}
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
                  status.defaultConnectionId ?? activeConnections[0]?.id ?? "",
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
                status.defaultConnectionId ?? activeConnections[0]?.id ?? "",
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
        </section>
      )}

      {panel && (
        <Dialog
          key={panel}
          initialFocus={panel === "dashboard" ? "container" : "auto"}
          returnFocus={panelTrigger.current}
          description={
            panel === "upload" && uploadProject
              ? f(
                  uploadProject.intent === "share" ? "shareHelp" : "uploadHelp",
                  { name: uploadProjectName },
                )
              : undefined
          }
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
          wide={panel !== "upload"}
          onClose={closePanel}
          className={`sync-dialog sync-${panel}-dialog`}
        >
          <div
            ref={panelBody}
            className={`sync-dialog-body ${panel === "dashboard" ? "sync-dashboard-body" : "studio-dialog-body"}`}
            aria-busy={busy}
          >
            {error && (
              <p className="sync-error" role="alert">
                {error}
              </p>
            )}
            {busy && (
              <p className="settings-help" role="status">
                {t("processing")}
              </p>
            )}
            {panel === "upload" && uploadProject && (
              <>
                {activeConnections.length > 0 ? (
                  <form
                    className="studio-dialog-form"
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
                          notify(
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
                      <Select
                        required
                        value={uploadTarget}
                        onChange={(event) =>
                          setUploadTarget(event.target.value)
                        }
                      >
                        {activeConnections.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.user.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <div className="studio-dialog-actions">
                      <button
                        type="button"
                        className="settings-button"
                        onClick={closePanel}
                      >
                        {tc("cancel")}
                      </button>
                      <button
                        className="settings-button sync-primary"
                        disabled={busy || !uploadTarget}
                      >
                        {uploadProject.intent === "share"
                          ? f("uploadShare")
                          : f("enableSync")}
                      </button>
                    </div>
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
              </>
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
                    notify(t("toast.projectCreated", { name }));
                  })
                }
                onRole={(member, next) => {
                  void run(async () => {
                    await manage("member", { userId: member.id, role: next });
                    notify(
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
                    notify(t("toast.memberRemoved", { name: member.name }));
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
                    notify(t("toast.inviteCopied"));
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
                    notify(t("toast.inviteCopied"));
                  })
                }
                onRevoke={(digest) => {
                  void run(async () => {
                    await manage("revokeInvite", { digest });
                    notify(t("toast.inviteRevoked"));
                  });
                }}
                onArchive={(archived) =>
                  run(async () => {
                    await manage("project", { archived });
                    notify(
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
                              className="showai-radio"
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
                    className="settings-button sync-primary"
                    disabled={
                      busy || conflict.files.some((file) => !choices[file.path])
                    }
                    onClick={() =>
                      void run(async () => {
                        const resolved = await desktop.invoke<Status>(
                          "sync:resolve",
                          {
                            projectId: conflict.projectId,
                            choices,
                          },
                        );
                        const binding = resolved?.projects.find(
                          (item) => item.projectId === conflict.projectId,
                        );
                        if (binding?.status === "conflict")
                          throw new Error(t("newConflictVersion"));
                        if (binding?.error) throw new Error(binding.error);
                        setConflict(null);
                        setPanel(null);
                      })
                    }
                  >
                    {t("saveMergeAndSync")}
                  </button>
                  {error && (
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await desktop.invoke("sync:run", {
                            projectId: conflict.projectId,
                          });
                          const latest =
                            await desktop.invoke<SyncConflict | null>(
                              "sync:conflict",
                              { projectId: conflict.projectId },
                            );
                          const previous = new Map(
                            conflict.files.map((file) => [file.path, file]),
                          );
                          setChoices(
                            Object.fromEntries(
                              (latest?.files ?? []).flatMap((file) => {
                                const old = previous.get(file.path);
                                const choice = choices[file.path];
                                return choice &&
                                  old?.local === file.local &&
                                  old.remote === file.remote
                                  ? [[file.path, choice]]
                                  : [];
                              }),
                            ),
                          );
                          setConflict(latest);
                        })
                      }
                    >
                      {t("reloadConflict")}
                    </button>
                  )}
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
              <div className="sync-dialog-body studio-dialog-body">
                <div className="sync-binding-summary">
                  <Folder size={17} aria-hidden="true" />
                  <h3>{project.name}</h3>
                  {binding.role !== "viewer" && (
                    <button
                      type="button"
                      className="settings-button"
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
                </div>
                {sameServer.length > 1 && (
                  <label className="sync-field">
                    <span>{t("syncAccount")}</span>
                    <Select
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
                    </Select>
                  </label>
                )}
                {binding.error && <p className="sync-error">{binding.error}</p>}
                <section className="sync-binding-detach">
                  <h3 className="settings-section-heading">{t("detach")}</h3>
                  <p className="settings-help">{t("detachHelp")}</p>
                  {confirmDetach === project.id ? (
                    <div className="studio-dialog-actions">
                      <button
                        type="button"
                        className="settings-button"
                        onClick={() => setConfirmDetach("")}
                      >
                        {tc("cancel")}
                      </button>
                      <button
                        type="button"
                        className="settings-button sync-danger-fill"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await desktop.invoke("sync:detach", {
                              projectId: project.id,
                            });
                            setExpanded("");
                            setConfirmDetach("");
                            notify(t("toast.detached", { name: project.name }));
                          })
                        }
                      >
                        {t("confirmDetach")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="settings-button settings-danger-button"
                      onClick={() => setConfirmDetach(project.id)}
                    >
                      {t("detach")}
                    </button>
                  )}
                </section>
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
              notify(t("toast.packaging", { name: current.name }));
            });
          }}
        />
      )}
    </div>
  );
}
