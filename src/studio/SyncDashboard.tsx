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

export type SyncMember = { id: string; name: string; role: ProjectRole };
export type SyncInvite = {
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
const permissions: Record<ProjectRole, string> = {
  admin: "编辑内容、管理成员与邀请",
  editor: "编辑项目中的页面与内容",
  viewer: "阅读项目内容，不能修改",
};
const roleOptions = Object.entries(roles).map(([value, label]) => (
  <option key={value} value={value}>
    {label}
  </option>
));

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
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<boolean>;
  onRole: (member: SyncMember, role: ProjectRole) => void;
  onRemove: (member: SyncMember) => Promise<boolean>;
  onInviteRole: (role: ProjectRole) => void;
  onInvite: () => void;
  onCopy: () => Promise<boolean>;
  onRevoke: (digest: string) => void;
  onArchive: (archived: boolean) => Promise<boolean>;
}) {
  const [showCreate, setShowCreate] = useState(false),
    [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [remove, setRemove] = useState<SyncMember | null>(null),
    [archive, setArchive] = useState(false),
    [copied, setCopied] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const project = projects.find((item) => item.id === selectedId);
  const managed = projects.filter((item) => item.role === "admin");
  const pendingInvites = invites.filter(
    (item) => !item.accepted_by && !item.revoked,
  );
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
      <aside className="sync-management-sidebar" aria-label="管理的项目">
        <div className="sync-server-identity">
          <Database size={18} aria-hidden="true" />
          <div>
            <strong>{connection?.name}</strong>
            <span>{connection?.user.name}</span>
          </div>
        </div>
        <div className="sync-project-list-heading">
          <h3>项目</h3>
          <span>{managed.length}</span>
        </div>
        {managed.length > 5 && (
          <input
            aria-label="搜索管理的项目"
            placeholder="搜索项目"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <select
          className="sync-mobile-project-select"
          aria-label="切换管理项目"
          disabled={busy || !managed.length}
          value={selectedId}
          onChange={(event) => {
            setQuery("");
            onSelect(event.target.value);
          }}
        >
          {!selectedId && <option value="">选择项目</option>}
          {managed.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.archived ? " · 已归档" : ""}
            </option>
          ))}
        </select>
        <nav className="sync-managed-projects" aria-label="项目列表">
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
                  {item.archived && <small>已归档</small>}
                </span>
              </button>
            ))}
          {!busy && !managed.length && (
            <p className="sync-empty-note">创建项目后，就能邀请成员协作。</p>
          )}
          {query &&
            !managed.some((item) =>
              item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            ) && <p className="sync-empty-note">没有找到匹配的项目。</p>}
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
                <label htmlFor="sync-new-project">新建项目</label>
                <button
                  type="button"
                  aria-label="取消新建项目"
                  disabled={busy}
                  onClick={() => setShowCreate(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <input
                ref={nameInput}
                id="sync-new-project"
                aria-label="新项目名称"
                placeholder="输入项目名称"
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
                创建项目
              </button>
            </form>
          ) : (
            <button
              className="settings-button"
              disabled={busy}
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16} aria-hidden="true" />
              新建项目
            </button>
          )}
        </div>
      </aside>
      <main ref={content} className="sync-management-content">
        {project ? (
          <>
            <header className="sync-project-overview">
              <div className="sync-eyebrow">当前项目</div>
              <h2>
                {project.name}
                {project.archived && <span className="sync-badge">已归档</span>}
              </h2>
              <p>管理员 · {members.length} 位成员</p>
            </header>
            <section
              className="sync-management-section"
              aria-labelledby="sync-members-title"
            >
              <div className="sync-management-section-heading">
                <h3 id="sync-members-title">项目成员</h3>
                <span>{members.length} 人</span>
              </div>
              <table className="sync-members-table">
                <thead>
                  <tr>
                    <th scope="col">成员</th>
                    <th scope="col">权限</th>
                    <th scope="col">
                      <span className="sync-visually-hidden">操作</span>
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
                                  <span className="sync-badge">你</span>
                                )}
                              </strong>
                              {lastAdmin && <small>唯一管理员</small>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            aria-label={`${member.name}的项目权限`}
                            title={
                              lastAdmin
                                ? "需先设置另一位管理员，才能更改此权限"
                                : permissions[member.role]
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
                                ? "项目需保留至少一位管理员"
                                : `移出${member.name}`
                            }
                            aria-label={`移出${member.name}`}
                            onClick={(event) => {
                              confirmationTrigger.current = event.currentTarget;
                              setArchive(false);
                              setRemove(member);
                            }}
                          >
                            移出
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {admins === 1 && (
                <p className="sync-permission-note">
                  需先设置另一位管理员，才能更改唯一管理员的权限或将其移出。
                </p>
              )}
              {remove && (
                <div
                  ref={confirmation}
                  className="sync-inline-confirm"
                  role="group"
                  aria-label="确认移出成员"
                >
                  <p>
                    移出 <strong>{remove.name}</strong>？
                    <span>该成员将无法访问此项目。</span>
                  </p>
                  <div>
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={cancelConfirmation}
                    >
                      取消
                    </button>
                    <button
                      className="settings-button sync-danger"
                      disabled={busy}
                      onClick={() => {
                        confirmationTrigger.current?.focus();
                        void onRemove(remove).then((ok) => {
                          if (ok) setRemove(null);
                        });
                      }}
                    >
                      确认移出
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
                  邀请成员
                </h3>
              </div>
              <p className="sync-section-description">
                生成链接，分享给需要加入此项目的人。
              </p>
              <div className="sync-invite-controls">
                <label>
                  <span>加入后的权限</span>
                  <select
                    aria-label="邀请权限"
                    value={inviteRole}
                    disabled={busy}
                    onChange={(event) =>
                      onInviteRole(event.target.value as ProjectRole)
                    }
                  >
                    {roleOptions}
                  </select>
                </label>
                <button
                  className="settings-button sync-primary"
                  disabled={busy}
                  onClick={onInvite}
                >
                  生成邀请链接
                </button>
              </div>
              <p className="sync-permission-note">{permissions[inviteRole]}</p>
              {generatedInvite && (
                <div className="sync-generated-invite">
                  <label htmlFor="sync-generated-link">邀请链接</label>
                  <div>
                    <input
                      id="sync-generated-link"
                      aria-label="生成的邀请链接"
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
                      {copied ? "已复制" : "复制链接"}
                    </button>
                  </div>
                  <p>
                    每条链接可供一位成员使用
                    {generatedInviteExpiresAt &&
                      ` · ${new Date(generatedInviteExpiresAt).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} 到期`}
                  </p>
                </div>
              )}
              {!!pendingInvites.length && (
                <details className="sync-pending-invites">
                  <summary>
                    已有邀请 <span>{pendingInvites.length}</span>
                  </summary>
                  {pendingInvites.map((invite) => {
                    const expired =
                      new Date(invite.expires_at).getTime() <= Date.now();
                    return (
                      <div className="sync-invite-row" key={invite.digest}>
                        <div>
                          <strong>{roles[invite.role]}</strong>
                          <span>
                            {expired
                              ? "已过期"
                              : `${new Date(invite.expires_at).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} 到期`}
                          </span>
                        </div>
                        <button
                          className="sync-text-button sync-danger"
                          disabled={busy}
                          onClick={() => onRevoke(invite.digest)}
                        >
                          撤销邀请
                        </button>
                      </div>
                    );
                  })}
                </details>
              )}
            </section>
            <section className="sync-archive-section" aria-label="项目归档">
              <div>
                <h3>{project.archived ? "恢复项目" : "归档项目"}</h3>
                <p>项目内容与历史会保留，归档后可随时恢复。</p>
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
                {project.archived ? "恢复项目" : "归档项目"}
              </button>
            </section>
            {archive && (
              <div
                ref={confirmation}
                className="sync-inline-confirm"
                role="group"
                aria-label="确认归档项目"
              >
                <p>
                  归档 <strong>{project.name}</strong>？
                  <span>项目内容与历史会保留。</span>
                </p>
                <div>
                  <button
                    className="settings-button"
                    disabled={busy}
                    onClick={cancelConfirmation}
                  >
                    取消
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
                    确认归档
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="sync-management-empty">
            <Folder size={28} aria-hidden="true" />
            <h2>{busy ? "正在读取项目…" : "从这里开始协作"}</h2>
            <p>
              {busy
                ? "正在加载项目与成员信息。"
                : managed.length
                  ? "选择左侧项目，查看成员与邀请。"
                  : "从左侧新建项目，然后邀请成员加入。"}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
