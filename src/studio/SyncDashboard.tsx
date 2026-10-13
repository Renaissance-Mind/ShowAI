import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  Copy,
  Database,
  Folder,
  Link2,
  Plus,
  User,
  X,
} from "../ui/icons";
import type {
  ProjectRole,
  ServerConnection,
  SyncProject,
} from "../sync/protocol";
import { getLocale, type MessageKey } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sync";
import common from "../i18n/messages/common";

export type SyncMember = { id: string; name: string; role: ProjectRole };
export type SyncInvite = {
  digest: string;
  role: ProjectRole;
  expires_at: string;
  accepted_by: string | null;
  accepted_count?: number;
  revoked: number;
  max_uses?: number | null;
  target_name?: string | null;
};
type SyncKey = MessageKey<typeof messages>;
const roles: Record<ProjectRole, SyncKey> = {
  admin: "role.admin",
  editor: "role.editor",
  viewer: "role.viewer",
};
const permissions: Record<ProjectRole, SyncKey> = {
  admin: "permission.admin",
  editor: "permission.editor",
  viewer: "permission.viewer",
};
const inviteUseOptions = [1, 5, 25, 100];

/** Renders a translated sentence with its `{name}` placeholder in bold. */
function withStrong(template: string, name: string) {
  const [before, after = ""] = template.split("{name}");
  return (
    <>
      {before}
      <strong>{name}</strong>
      {after}
    </>
  );
}

export default function SyncDashboard({
  connection,
  projects,
  selectedId,
  members,
  invites,
  busy,
  inviteRole,
  generatedInvite,
  generatedInviteExpiresAt,
  generatedInvitePolicy,
  onSelect,
  onCreate,
  onRole,
  onRemove,
  onInviteRole,
  onInvite,
  onCopy,
  onRevoke,
  onArchive,
}: {
  connection?: Omit<ServerConnection, "token">;
  projects: SyncProject[];
  selectedId: string;
  members: SyncMember[];
  invites: SyncInvite[];
  busy: boolean;
  inviteRole: ProjectRole;
  generatedInvite: string;
  generatedInviteExpiresAt: string;
  generatedInvitePolicy: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<boolean>;
  onRole: (member: SyncMember, role: ProjectRole) => void;
  onRemove: (member: SyncMember, revokeInvites: boolean) => Promise<boolean>;
  onInviteRole: (role: ProjectRole) => void;
  onInvite: (options: { maxUses: number | null; targetName?: string }) => void;
  onCopy: () => Promise<boolean>;
  onRevoke: (digest: string) => void;
  onArchive: (archived: boolean) => Promise<boolean>;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const expiry = (date: string) =>
    new Date(date).toLocaleString(getLocale(), {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const roleOptions = (Object.keys(roles) as ProjectRole[]).map((value) => (
    <option key={value} value={value}>
      {t(roles[value])}
    </option>
  ));
  const [showCreate, setShowCreate] = useState(false),
    [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [inviteUses, setInviteUses] = useState("25"),
    [inviteTarget, setInviteTarget] = useState("");
  const [revokeRelated, setRevokeRelated] = useState(true);
  const controlledInvites =
    !!connection?.capabilities?.includes("invite-controls-v1");
  const [remove, setRemove] = useState<SyncMember | null>(null),
    [archive, setArchive] = useState(false),
    [copied, setCopied] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const project = projects.find((item) => item.id === selectedId);
  const managed = projects.filter((item) => item.role === "admin");
  const pendingInvites = invites.filter((item) => !item.revoked);
  const admins = members.filter((member) => member.role === "admin").length;
  useEffect(() => {
    setRemove(null);
    setArchive(false);
    if (content.current) content.current.scrollTop = 0;
  }, [selectedId]);
  useEffect(() => {
    setCopied(false);
  }, [generatedInvite]);
  useEffect(() => {
    if (showCreate) nameInput.current?.focus();
  }, [showCreate]);
  useEffect(() => {
    if (remove || archive)
      confirmation.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [remove, archive]);
  function cancelConfirmation() {
    setRemove(null);
    setArchive(false);
    confirmationTrigger.current?.focus();
  }

  return (
    <div className="sync-management">
      <aside className="sync-management-sidebar" aria-label={t("managedProjects")}>
        <div className="sync-server-identity">
          <Database size={18} aria-hidden="true" />
          <div>
            <strong>{connection?.name}</strong>
            <span>{connection?.user.name}</span>
          </div>
        </div>
        <div className="sync-project-list-heading">
          <h3>{t("projects")}</h3>
          <span>{managed.length}</span>
        </div>
        {managed.length > 5 && (
          <input
            aria-label={t("searchManagedProjects")}
            placeholder={t("searchProjects")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <select
          className="sync-mobile-project-select"
          aria-label={t("switchManagedProject")}
          disabled={busy || !managed.length}
          value={selectedId}
          onChange={(event) => {
            setQuery("");
            onSelect(event.target.value);
          }}
        >
          {!selectedId && <option value="">{t("chooseProject")}</option>}
          {managed.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.archived ? ` · ${t("archived")}` : ""}
            </option>
          ))}
        </select>
        <nav className="sync-managed-projects" aria-label={t("projectList")}>
          {managed
            .filter((item) =>
              item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((item) => (
              <button
                key={item.id}
                aria-current={item.id === selectedId ? "page" : undefined}
                disabled={busy}
                onClick={() => onSelect(item.id)}
              >
                <Folder size={17} aria-hidden="true" />
                <span>
                  {item.name}
                  {item.archived && <small>{t("archived")}</small>}
                </span>
              </button>
            ))}
          {!busy && !managed.length && (
            <p className="sync-empty-note">{t("noManagedProjects")}</p>
          )}
          {query &&
            !managed.some((item) =>
              item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            ) && (
              <p className="sync-empty-note">{t("noMatchingProjects")}</p>
            )}
        </nav>
        <div className={`sync-create-project ${showCreate ? "is-open" : ""}`}>
          {showCreate ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onCreate(name.trim()).then((ok) => {
                  if (ok) {
                    setName("");
                    setQuery("");
                    setShowCreate(false);
                  }
                });
              }}
            >
              <div className="sync-create-heading">
                <label htmlFor="sync-new-project">{t("newProject")}</label>
                <button
                  type="button"
                  aria-label={t("cancelNewProject")}
                  disabled={busy}
                  onClick={() => setShowCreate(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <input
                ref={nameInput}
                id="sync-new-project"
                aria-label={t("newProjectName")}
                placeholder={t("enterProjectName")}
                required
                maxLength={200}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                className="settings-button sync-primary"
                disabled={busy || !name.trim()}
              >
                {t("createProject")}
              </button>
            </form>
          ) : (
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16} aria-hidden="true" />
              {t("newProject")}
            </button>
          )}
        </div>
      </aside>
      <main ref={content} className="sync-management-content">
        {project ? (
          <>
            <header className="sync-project-overview">
              <div className="sync-eyebrow">{t("currentProject")}</div>
              <h2>
                {project.name}
                {project.archived && (
                  <span className="sync-badge">{t("archived")}</span>
                )}
              </h2>
              <p>{t("adminOverview", { count: members.length })}</p>
            </header>
            <section
              className="sync-management-section"
              aria-labelledby="sync-members-title"
            >
              <div className="sync-management-section-heading">
                <h3 id="sync-members-title">{t("projectMembers")}</h3>
                <span>{t("memberCount", { count: members.length })}</span>
              </div>
              <table className="sync-members-table">
                <thead>
                  <tr>
                    <th scope="col">{t("column.member")}</th>
                    <th scope="col">{t("column.role")}</th>
                    <th scope="col">
                      <span className="sync-visually-hidden">
                        {t("column.actions")}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const lastAdmin = member.role === "admin" && admins === 1;
                    return (
                      <tr key={member.id}>
                        <td>
                          <div className="sync-member-identity">
                            <User size={18} aria-hidden="true" />
                            <div>
                              <strong>
                                {member.name}
                                {member.id === connection?.user.id && (
                                  <span className="sync-badge">{t("you")}</span>
                                )}
                              </strong>
                              {lastAdmin && <small>{t("onlyAdmin")}</small>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            aria-label={t("memberRoleFor", {
                              name: member.name,
                            })}
                            title={
                              lastAdmin
                                ? t("lastAdminRole")
                                : t(permissions[member.role])
                            }
                            value={member.role}
                            disabled={busy || lastAdmin}
                            onChange={(event) =>
                              onRole(member, event.target.value as ProjectRole)
                            }
                          >
                            {roleOptions}
                          </select>
                        </td>
                        <td>
                          <button
                            className="sync-text-button sync-danger"
                            disabled={busy || lastAdmin}
                            title={
                              lastAdmin
                                ? t("lastAdminRemove")
                                : t("removeMemberNamed", { name: member.name })
                            }
                            aria-label={t("removeMemberNamed", {
                              name: member.name,
                            })}
                            onClick={(event) => {
                              confirmationTrigger.current = event.currentTarget;
                              setArchive(false);
                              setRemove(member);
                              setRevokeRelated(true);
                            }}
                          >
                            {t("removeMember")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {admins === 1 && (
                <p className="sync-permission-note">{t("lastAdminNote")}</p>
              )}
              {remove && (
                <div
                  ref={confirmation}
                  className="sync-inline-confirm"
                  role="group"
                  aria-label={t("confirmRemoveMember")}
                >
                  <p>
                    {withStrong(t("removeMemberQuestion"), remove.name)}
                    <span>{t("removeMemberConsequence")}</span>
                  </p>
                  {controlledInvites && (
                    <label className="sync-revoke-choice">
                      <input
                        type="checkbox"
                        checked={revokeRelated}
                        disabled={busy}
                        onChange={(event) =>
                          setRevokeRelated(event.target.checked)
                        }
                      />
                      {t("revokeRelatedInvites")}
                    </label>
                  )}
                  <div>
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={cancelConfirmation}
                    >
                      {tc("cancel")}
                    </button>
                    <button
                      className="settings-button sync-danger"
                      disabled={busy}
                      onClick={() => {
                        confirmationTrigger.current?.focus();
                        void onRemove(
                          remove,
                          controlledInvites && revokeRelated,
                        ).then((ok) => {
                          if (ok) setRemove(null);
                        });
                      }}
                    >
                      {t("confirmRemove")}
                    </button>
                  </div>
                </div>
              )}
            </section>
            <section
              className="sync-management-section sync-invite-section"
              aria-labelledby="sync-invite-title"
            >
              <div className="sync-management-section-heading">
                <h3 id="sync-invite-title">
                  <Link2 size={17} aria-hidden="true" />
                  {t("inviteMembers")}
                </h3>
              </div>
              <p className="sync-section-description">
                {controlledInvites
                  ? t("inviteHelpControlled")
                  : t("inviteHelpOpen")}
              </p>
              <div className="sync-invite-controls">
                <label>
                  <span>{t("roleAfterJoin")}</span>
                  <select
                    aria-label={t("inviteRole")}
                    value={inviteRole}
                    disabled={busy}
                    onChange={(event) =>
                      onInviteRole(event.target.value as ProjectRole)
                    }
                  >
                    {roleOptions}
                  </select>
                </label>
                {controlledInvites && (
                  <>
                    <label>
                      <span>{t("inviteUses")}</span>
                      <select
                        aria-label={t("inviteUsesLimit")}
                        value={inviteUses}
                        disabled={busy}
                        onChange={(event) => setInviteUses(event.target.value)}
                      >
                        {inviteUseOptions.map((count) => (
                          <option key={count} value={String(count)}>
                            {t("accountCount", { count })}
                          </option>
                        ))}
                        <option value="unlimited">
                          {t("policy.unlimited")}
                        </option>
                      </select>
                    </label>
                    <label>
                      <span>{t("targetAccount")}</span>
                      <input
                        aria-label={t("targetAccountLabel")}
                        placeholder={t("targetAccountPlaceholder")}
                        maxLength={100}
                        value={inviteTarget}
                        disabled={busy}
                        onChange={(event) =>
                          setInviteTarget(event.target.value)
                        }
                      />
                    </label>
                  </>
                )}
                <button
                  className="settings-button sync-primary"
                  disabled={busy}
                  onClick={() =>
                    onInvite({
                      maxUses:
                        inviteUses === "unlimited" ? null : Number(inviteUses),
                      ...(inviteTarget.trim()
                        ? { targetName: inviteTarget.trim() }
                        : {}),
                    })
                  }
                >
                  {t("createInviteLink")}
                </button>
              </div>
              <p className="sync-permission-note">
                {t(permissions[inviteRole])}
              </p>
              {generatedInvite && (
                <div className="sync-generated-invite">
                  <label htmlFor="sync-generated-link">{t("inviteLink")}</label>
                  <div>
                    <input
                      id="sync-generated-link"
                      aria-label={t("generatedInviteLink")}
                      readOnly
                      value={generatedInvite}
                      onFocus={(event) => event.target.select()}
                    />
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() => {
                        void onCopy().then((ok) => {
                          if (ok) setCopied(true);
                        });
                      }}
                    >
                      {copied ? (
                        <Check size={15} aria-hidden="true" />
                      ) : (
                        <Copy size={15} aria-hidden="true" />
                      )}
                      {copied ? tc("copied") : t("copyLink")}
                    </button>
                  </div>
                  <p>
                    {generatedInvitePolicy || t("anyoneCanJoin")}
                    {generatedInviteExpiresAt &&
                      ` · ${t("expiresAt", { date: expiry(generatedInviteExpiresAt) })}`}
                  </p>
                </div>
              )}
              {!!pendingInvites.length && (
                <details className="sync-pending-invites">
                  <summary>
                    {t("existingInvites")} <span>{pendingInvites.length}</span>
                  </summary>
                  {pendingInvites.map((invite) => {
                    const expired =
                      new Date(invite.expires_at).getTime() <= Date.now();
                    return (
                      <div className="sync-invite-row" key={invite.digest}>
                        <div>
                          <strong>{t(roles[invite.role])}</strong>
                          <span>
                            {t("invite.joined", {
                              count:
                                invite.accepted_count ??
                                (invite.accepted_by ? 1 : 0),
                            })}
                            {" / "}
                            {invite.max_uses != null
                              ? t("invite.limit", { count: invite.max_uses })
                              : t("policy.unlimited")}
                            {invite.target_name
                              ? ` · ${t("invite.target", { name: invite.target_name })}`
                              : ""}{" "}
                            ·{" "}
                            {expired
                              ? t("invite.expired")
                              : t("expiresAt", {
                                  date: expiry(invite.expires_at),
                                })}
                          </span>
                        </div>
                        <button
                          className="sync-text-button sync-danger"
                          disabled={busy}
                          onClick={() => onRevoke(invite.digest)}
                        >
                          {t("revokeInvite")}
                        </button>
                      </div>
                    );
                  })}
                </details>
              )}
            </section>
            <section className="sync-archive-section" aria-label={t("projectArchive")}>
              <div>
                <h3>
                  {project.archived ? t("restoreProject") : t("archiveProject")}
                </h3>
                <p>{t("archiveHelp")}</p>
              </div>
              <button
                className="settings-button"
                disabled={busy}
                onClick={(event) => {
                  if (project.archived) void onArchive(false);
                  else {
                    confirmationTrigger.current = event.currentTarget;
                    setRemove(null);
                    setArchive(true);
                  }
                }}
              >
                <Archive size={15} aria-hidden="true" />
                {project.archived ? t("restoreProject") : t("archiveProject")}
              </button>
            </section>
            {archive && (
              <div
                ref={confirmation}
                className="sync-inline-confirm"
                role="group"
                aria-label={t("confirmArchiveProject")}
              >
                <p>
                  {withStrong(t("archiveQuestion"), project.name)}
                  <span>{t("archiveConsequence")}</span>
                </p>
                <div>
                  <button
                    className="settings-button"
                    disabled={busy}
                    onClick={cancelConfirmation}
                  >
                    {tc("cancel")}
                  </button>
                  <button
                    className="settings-button"
                    disabled={busy}
                    onClick={() => {
                      confirmationTrigger.current?.focus();
                      void onArchive(true).then((ok) => {
                        if (ok) setArchive(false);
                      });
                    }}
                  >
                    {t("confirmArchive")}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="sync-management-empty">
            <Folder size={28} aria-hidden="true" />
            <h2>{busy ? t("readingProjects") : t("startCollaborating")}</h2>
            <p>
              {busy
                ? t("loadingMembers")
                : managed.length
                  ? t("selectProjectHint")
                  : t("createProjectHint")}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
