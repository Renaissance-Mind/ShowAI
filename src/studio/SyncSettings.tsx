import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Database,
  Folder,
  Link2,
  Plus,
  RefreshCw,
  Search,
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
import { PendingNotice } from "../ui/PendingNotice";
import flowMessages from "../i18n/messages/accountFlow";
import navigationMessages from "../i18n/messages/navigation";
import { syncListedProjects } from "./sync-project-list";
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
  url: "https://showai.renaissancemind.ai/cloud",
  account: "",
  password: "",
  registrationKey: "",
  token: "",
  tokenOnly: false,
  mode: "login" as ConnectMode,
};
export type ProjectSyncRequest = {
  projectId: string;
  /** signIn: the project's account must sign in again. */
  intent: "share" | "sync" | "signIn";
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
  const [passwordExpanded, setPasswordExpanded] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [dashboardFocused, setDashboardFocused] = useState(false);
  const t = useTranslator(messages);
  const tn = useTranslator(navigationMessages);
  const tc = useTranslator(common);
  const role = (value: ProjectRole) => t(roleKeys[value]);
  const [status, setStatus] = useState<Status | null>(null),
    [localProjects, setLocalProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyForm);
  // The server is probed when its address is committed, not on every keystroke.
  const [probeUrl, setProbeUrl] = useState(emptyForm.url);
  const [registrationMode, setRegistrationMode] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const registrationKeyInput = useRef<HTMLInputElement>(null);
  const [showConnect, setShowConnect] = useState(false),
    [server, setServer] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [accountPanel, setAccountPanel] = useState("");
  const [expanded, setExpanded] = useState(""),
    [confirmDetach, setConfirmDetach] = useState(""),
    [uploadTarget, setUploadTarget] = useState("");
  const [showJoin, setShowJoin] = useState(() => !!pendingInvite());
  const connectSection = useRef<HTMLDivElement>(null);
  const [connectRequest, setConnectRequest] = useState(0);
  const [panel, setPanel] = useState<
    "projects" | "dashboard" | "conflict" | "upload" | null
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
        setForm((current) => ({
          ...current,
          url: result.url,
          mode: "login",
          account: result.target_name ?? current.account,
        }));
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
        status.defaultConnectionId || status.connections.find((item) => !item.signedOut)?.id || "",
      );
      setPanel("upload");
    }
  }, [request, status]);
  useEffect(() => {
    if (!preview || !status || server) return;
    const existing = status.connections.find(
      (connection) => !connection.signedOut && connection.serverId === preview.serverId,
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
        : panel === "projects"
          ? panelBody.current?.closest<HTMLElement>(".sync-dialog")
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
      registrationKey: form.registrationKey,
      token: form.mode === "token" ? form.token : undefined,
      register,
      continue: form.mode === "login",
      personalToken: register && form.tokenOnly,
      invite: preview?.invite,
    }).catch((error: unknown) => {
      // The server needs a registration key: open the field and focus it.
      if (
        (error as { details?: { field?: string } })?.details?.field ===
        "registrationKey"
      ) {
        setAdvancedOpen(true);
        requestAnimationFrame(() => registrationKeyInput.current?.focus());
      }
      throw error;
    });
    setShowConnect(false);
    setIssuedToken(connection.issuedPersonalToken ?? "");
    setForm(emptyForm);
    await connected(connection.id);
  }
  async function openRemote(connectionId: string, remoteProjectId: string) {
    await desktop.invoke("sync:subscribe", { connectionId, remoteProjectId });
    const next = await desktop.invoke<Status>("sync:status");
    const binding = next.projects.find(
      (item) =>
        item.connectionId === connectionId &&
        item.remoteProjectId === remoteProjectId,
    );
    if (!binding) throw new Error(t("readingProjects"));
    if (binding.error) throw new Error(binding.error);
    await desktop.invoke("sync:projectVisibility", {
      projectId: binding.projectId,
      visible: true,
      });
    await refresh();
    setPanel(null);
    await onOpenProject?.(binding.projectId);
  }
  async function acceptInvite(connectionId: string) {
    if (!preview) return;
    const target = preview.project_id;
    await desktop.invoke("sync:join", { connectionId, link: inviteLink });
    await openRemote(connectionId, target);
      setPreview(null);
      setInviteLink("");
      setShowJoin(false);
    setJoinIntent(false);
    localStorage.removeItem(pendingInviteKey);
  }
  async function connected(connectionId: string) {
    setShowConnect(false);
    setForm(emptyForm);
    await refresh();
    if (preview && joinIntent) {
      await acceptInvite(connectionId);
      return;
    }
    if (uploadProject) {
      setUploadTarget(connectionId);
      setPanel("upload");
      return;
    }
    setMessage(f("connected"));
  }
  function openConnect(next: Partial<typeof emptyForm> = {}) {
    setForm({ ...emptyForm, ...next });
    setProbeUrl(next.url ?? emptyForm.url);
    setAdvancedOpen(false);
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
    return (
      <PendingNotice label={t("readingConnections")} lines={3} minHeight={240} />
    );
  const hidden = new Set(status.hiddenProjectIds ?? []);
  const bindingFor = (projectId: string) =>
    status.projects.find((item) => item.projectId === projectId);
  const projectsOn = (connectionId: string) =>
    status.projects.filter((item) => item.connectionId === connectionId).length;
  const stateLabel = (item: Binding) =>
    item.status === "offline" && item.errorKind
      ? t(`state.offline.${item.errorKind}`)
      : t(stateKeys[item.status]);
  const attention = status.projects.filter(
    (item) => stateTones[item.status] === "problem",
  ).length;
  const invitedServer =
    preview &&
    status.connections.filter(
      (connection) => !connection.signedOut && connection.serverId === preview.serverId,
    );
  return (
    <div className="sync-settings" aria-busy={busy}>
      <section
        className="settings-group sync-section"
        aria-labelledby="sync-servers-title"
      >
        <div className="sync-section-header">
          <div>
            <h2 id="sync-servers-title">{f("accounts")}</h2>
            <p className="settings-help">{f("accountHelp")}</p>
          </div>
          {!showConnect && (
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => openConnect()}
            >
              <Plus size={14} aria-hidden="true" />
              {f("addAccount")}
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
        {!status.connections.some((item) => !item.signedOut) && !showConnect && (
          <div className="sync-empty">
            <strong>{f("localTitle")}</strong>
            <p>{f("localHelp")}</p>
          </div>
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
              {connection.signedOut ? (
                <div className="sync-server-actions">
                  <span>{f("signedOut")}</span>
                  <button
                    className="settings-button"
                    onClick={() =>
                      openConnect({
                        url: connection.url,
                        account: connection.user.name,
                      })
                    }
                  >
                    {f("signIn")}
                  </button>
                </div>
              ) : (
                <div className="sync-server-actions">
                <button
                  className="settings-button"
                  disabled={busy}
                  title={t("serverProjectsHelp")}
                  onClick={() => void run(() => loadServer(connection.id))}
                >
                  {f("viewProjects")}
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
              )}
              {!connection.signedOut && open && (
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
                  : f("addAccount")}
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
            <details
              className="sync-account-disclosure"
              open={(form.url !== emptyForm.url && !preview) || undefined}
            >
              <summary>{f("otherService")}</summary>
              <label className="sync-field">
                <span>{t("serverUrl")}</span>
                <input
                  type="url"
                  value={form.url}
                  aria-describedby="sync-server-url-hint"
                  onChange={(event) =>
                    setForm({ ...form, url: event.target.value })
                  }
                  onBlur={() => setProbeUrl(form.url)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setProbeUrl(form.url);
                    }
                  }}
                />
                <span className="settings-help" id="sync-server-url-hint">
                  {t("serverUrlHint")}
                </span>
              </label>
            </details>
            <ServiceLogin
              url={probeUrl}
              registrationKey={form.registrationKey}
              invite={preview?.invite}
              onMethods={(methods) =>
                setPasswordExpanded(
                  !methods.some((method) =>
                    ["github", "google", "email"].includes(method),
                  ),
                )
              }
              onInfo={(info) => setRegistrationMode(info.registration ?? "")}
              onConnected={(id) => run(() => connected(id)).then(() => {})}
            />
            <details
              className="sync-account-disclosure"
              open={passwordExpanded}
              onToggle={(event) =>
                setPasswordExpanded(event.currentTarget.open)
              }
            >
              <summary>{f("passwordMethod")}</summary>
              <p className="settings-help">{f("passwordHelp")}</p>
              <form
                className="sync-connect-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  setProbeUrl(form.url);
                  void run(connect);
                }}
              >
                {form.mode === "token" ? (
                  <label className="sync-field">
                    <span>{t("token")}</span>
                    <input
                      required
                      type="password"
                      value={form.token}
                      onChange={(event) =>
                        setForm({ ...form, token: event.target.value })
                      }
                    />
                    <span className="settings-help">{t("tokenHint")}</span>
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
                    <label className="sync-field">
                      <span>{t("password")}</span>
                      <input
                        required
                        type="password"
                        autoComplete="current-password"
                        value={form.password}
                        onChange={(event) =>
                          setForm({ ...form, password: event.target.value })
                        }
                      />
                    </label>
                  </div>
                )}
                <details
                  open={advancedOpen}
                  onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
                >
                  <summary>{f("advanced")}</summary>
                  {preview ? (
                    form.mode === "register" && (
                      <p className="settings-help">{t("inviteRegistration")}</p>
                    )
                  ) : (
                    <label className="sync-field">
                      <span>{t("registrationKey")}</span>
                      <input
                        ref={registrationKeyInput}
                        type="password"
                        required={
                          form.mode === "register" &&
                          registrationMode === "controlled"
                        }
                        value={form.registrationKey}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            registrationKey: event.target.value,
                          })
                        }
                      />
                      <span className="settings-help">
                        {t("registrationKeyHelp")}
                      </span>
                    </label>
                  )}
                  <label className="sync-field">
                    <span>{t("connectMethod")}</span>
                    <select
                      value={form.mode}
                      onChange={(event) => {
                        const mode = event.target.value as ConnectMode;
                        setForm({ ...form, mode });
                        // A server that controls registration needs its key first.
                        if (
                          mode === "register" &&
                          !preview &&
                          registrationMode === "controlled" &&
                          !form.registrationKey
                        )
                          requestAnimationFrame(() =>
                            registrationKeyInput.current?.focus(),
                          );
                      }}
                    >
                      <option value="login">{f("continue")}</option>
                      <option value="token">{t("mode.token")}</option>
                      <option value="register">{t("mode.register")}</option>
                    </select>
                  </label>
                </details>
                <div className="sync-form-actions">
                  <button
                    className="settings-button sync-primary"
                    disabled={busy}
                  >
                    {preview && joinIntent ? f("signInJoin") : f("continue")}
                  </button>
                </div>
              </form>
            </details>
          </div>
        )}
      </section>
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
            {localProjects.some((project) => !bindingFor(project.id)) && (
              <p className="settings-help">{t("storedLocallyNote")}</p>
            )}
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
                            await openRemote(server, preview.project_id);
                            setPreview(null); setInviteLink(""); setShowJoin(false); localStorage.removeItem(pendingInviteKey);
                          }
                          else await acceptInvite(server);
                        })
                      }
                    >
                      {preview.joined ? f("openProject") : invitedServer.length > 1
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
                          mode: "login",
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
        <div className="sync-card">
          <div className="sync-card-row sync-default-row">
            <div>
              <label htmlFor="sync-default-location">{f("defaults")}</label>
              <p className="settings-help">{f("defaultHelp")}</p>
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
              {status.connections.filter((connection) => !connection.signedOut).map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connectionLabel(connection.id)}
                </option>
              ))}
            </select>
          </div>
          <ul className="sync-project-list">
            {syncListedProjects(
              localProjects,
              new Set(status.projects.map((item) => item.projectId)),
            ).map((project) => {
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
                        {project.archived && (
                          <span className="sync-badge">
                            {tn("deletedBadge")}
                          </span>
                        )}
                      </strong>
                      <span>
                        {connection
                          ? `${connection.name} · ${connection.user.name} · ${role(binding!.role)}`
                          : ""}
                        {binding?.status === "synced" && binding.syncedAt
                          ? ` · ${t("syncedAt", { date: syncTime(binding.syncedAt) })}`
                          : ""}
                      </span>
                    </div>
                    <span className={`sync-state is-${tone}`}>
                      {binding ? stateLabel(binding) : t("status.local")}
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
                              const next = await desktop.invoke<Status>(
                                "sync:run",
                                { projectId: project.id },
                              );
                              // Only a synced result is reported as 已同步.
                              const result = next.projects.find(
                                (item) => item.projectId === project.id,
                              );
                              if (result?.status === "synced")
                                setMessage(
                                  t("toast.synced", { name: project.name }),
                                );
                              else
                                throw new Error(
                                  t("syncNowIncomplete", {
                                    name: project.name,
                                    reason:
                                      result?.error ??
                                      (result ? stateLabel(result) : ""),
                                  }),
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
                          disabled={busy || !status.connections.some((item) => !item.signedOut)}
                          title={
                            status.connections.filter((item) => !item.signedOut).length
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
                    <div className="sync-error sync-project-error">
                      <p>{binding.error}</p>
                      {binding.errorDetail &&
                        binding.errorDetail !== binding.error && (
                          <details>
                            <summary>{t("errorDetails")}</summary>
                            <code>{binding.errorDetail}</code>
                          </details>
                        )}
                    </div>
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
                              {status.connections.filter(
                                (item) => !item.signedOut,
                              ).length
                                ? t("uploadHelp")
                                : t("needAccountFirst")}
                            </p>
                          </div>
                          {!!status.connections.some(
                            (item) => !item.signedOut,
                          ) && (
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
                                {status.connections.filter((item) => !item.signedOut).map((item) => (
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
                          className="settings-switch"
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
      {!!status.connections.some((item) => !item.signedOut) && (
        <details className="sync-account-disclosure">
          <summary>{f("accountAdvanced")}</summary>
          <AccountBindings connections={status.connections} refresh={refresh} />
        </details>
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
          initialFocus={panel === "projects" ? "container" : "auto"}
          returnFocus={panelTrigger.current}
          title={
            panel === "upload"
              ? f(uploadProject?.intent === "share" ? "shareTitle" : "uploadTitle")
              : panel === "projects"
                ? f("viewProjects")
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
                  {f(uploadProject.intent === "share" ? "shareHelp" : "uploadHelp", {
                    name:
                      localProjects.find(
                        (project) => project.id === uploadProject.projectId,
                      )?.name ?? "",
                  })}
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
                        {status.connections.filter((item) => !item.signedOut).map((item) => (
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
            {panel === "projects" && (
              <section className="sync-project-browser">
                <div className="sync-project-browser-toolbar">
                  <p className="sync-project-account">
                    {connectionLabel(server)}
                  </p>
                  <label className="sync-project-search-field">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="search"
                      className="sync-project-search"
                      aria-label={f("projectSearch")}
                      placeholder={f("projectSearch")}
                      value={projectQuery}
                      onChange={(event) => setProjectQuery(event.target.value)}
                    />
                  </label>
                </div>
                <table className="sync-project-table">
                  <colgroup>
                    <col />
                    <col className="sync-project-role-column" />
                    <col className="sync-project-visibility-column" />
                    <col className="sync-project-actions-column" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{f("projectColumn")}</th>
                      <th scope="col" className="sync-project-role">
                        {f("roleColumn")}
                      </th>
                      <th scope="col" className="sync-project-visibility">
                        {f("showing")}
                      </th>
                      <th scope="col" className="sync-project-row-actions">
                        {f("actionsColumn")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {remote
                      .filter((project) =>
                        project.name
                          .toLocaleLowerCase()
                          .includes(projectQuery.toLocaleLowerCase()),
                      )
                      .map((project) => {
                        const binding = status.projects.find(
                          (item) =>
                            item.connectionId === server &&
                            item.remoteProjectId === project.id,
                        );
                        return (
                          <tr key={project.id}>
                            <th scope="row" className="sync-project-row-name">
                              <div className="sync-project-title">
                                <span>{project.name}</span>
                                {project.archived && (
                                  <small>{t("archived")}</small>
                                )}
                              </div>
                            </th>
                            <td className="sync-project-role">
                              {role(project.role)}
                            </td>
                            <td className="sync-project-visibility">
                              {binding ? (
                                <label className="sync-project-visibility-control">
                                  <input
                                    type="checkbox"
                                    aria-label={f("showProject", {
                                      name: project.name,
                                    })}
                                    checked={!hidden.has(binding.projectId)}
                                    disabled={busy}
                                    onChange={(event) => {
                                      const visible = event.target.checked;
                                      void run(() =>
                                        desktop.invoke(
                                          "sync:projectVisibility",
                                          {
                                            projectId: binding.projectId,
                                            visible,
                                          },
                                        ),
                                      );
                                    }}
                                  />
                                  <span className="sync-project-visibility-caption">
                                    {f("showing")}
                                  </span>
                                </label>
                              ) : (
                                <span className="sync-project-not-downloaded">
                                  {f("notDownloaded")}
                                </span>
                              )}
                            </td>
                            <td className="sync-project-row-actions">
                              <div>
                                <button
                                  className="settings-button sync-project-row-button"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(() =>
                                      openRemote(server, project.id),
                                    )
                                  }
                                >
                                  {binding ? f("openCompact") : f("download")}
                                </button>
                                {project.role === "admin" && (
                                  <button
                                    className="settings-button sync-project-row-button"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(() =>
                                        loadDashboard(server, project.id),
                                      )
                                    }
                                  >
                                    {f("shareCompact")}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    {!busy &&
                      !error &&
                      !remote.some((project) =>
                        project.name
                          .toLocaleLowerCase()
                          .includes(projectQuery.toLocaleLowerCase()),
                      ) && (
                        <tr>
                          <td
                            colSpan={4}
                            className="sync-project-browser-empty"
                          >
                            {remote.length
                              ? t("noMatchingProjects")
                              : t("noRemoteProjects")}
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
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
    </div>
  );
}
