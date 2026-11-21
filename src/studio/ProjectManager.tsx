import { useNotify } from "../problems/toast-context";
import { useSessionDraft } from "./session-draft";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CircleAlert,
  Cloud,
  CloudCheck,
  CloudOff,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Share2,
  X,
} from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/accountFlow";
import syncMessages from "../i18n/messages/sync";
import common from "../i18n/messages/common";
import type { ProjectSummary } from "../core/model";
import type {
  ProjectConnection,
  SyncConfiguration,
  SyncProject,
} from "../sync/protocol";
import {
  managedProjects,
  type ManagedProject,
  type ProjectAccount,
} from "./managed-projects";
import { desktop, errorMessage } from "../host/bridge";
import Dialog from "../ui/Dialog";
import Select from "../ui/Select";
import AccountLogin from "./AccountLogin";
import { LibraryContextMenu } from "../ui/LibraryContextMenu";

type DownloadState = {
  connectionId: string;
  remoteProjectId: string;
  projectId?: string;
  requestId?: string;
};
export type ManagedSyncStatus = Omit<SyncConfiguration, "connections"> & {
  connections: ProjectAccount[];
  downloads?: DownloadState[];
  running: boolean;
};

export default function ProjectManager({
  status,
  localProjects,
  filter,
  onFilter,
  onRefresh,
  onOpenProject,
  onShare,
  onUpload,
  onSignIn,
  onDetails,
  onConflict,
  onJoin,
}: {
  status: ManagedSyncStatus;
  localProjects: ProjectSummary[];
  filter: string;
  onFilter: (id: string) => void;
  onRefresh: () => Promise<void>;
  onOpenProject?: (id: string) => Promise<void>;
  onShare: (row: ManagedProject) => void;
  onUpload: (id: string) => void;
  onSignIn: (account: ProjectAccount) => void;
  onDetails: (id: string) => void;
  onConflict: (binding: ProjectConnection) => void;
  onJoin: () => void;
}) {
  const f = useTranslator(messages),
    t = useTranslator(syncMessages),
    tc = useTranslator(common);
  const [catalogs, setCatalogs] = useState<Record<string, SyncProject[]>>({}),
    [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({}),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  const [query, setQuery] = useSessionDraft("project-manager.query", ""),
    [archived, setArchived] = useState(false),
    [pending, setPending] = useState<Set<string>>(new Set()),
    [errors, setErrors] = useState<Record<string, string>>({});
  const notify = useNotify();
  const [menu, setMenu] = useState<{
      row: ManagedProject;
      anchor: HTMLElement;
    } | null>(null),
    [dialog, setDialog] = useState<{
      kind: "create" | "rename" | "archive" | "pause";
      row?: ManagedProject;
    } | null>(null);
  const [name, setName] = useState(""),
    [loginInCreate, setLoginInCreate] = useState(false),
    [location, setLocation] = useState(status.defaultConnectionId ?? "");
  const downloadIds = useRef(new Map<string, string>()),
    creationId = useRef(crypto.randomUUID()),
    cancelled = useRef(new Set<string>()),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const accounts = JSON.stringify(
    status.connections.map(({ id, url, signedOut }) => ({
      id,
      url,
      signedOut,
    })),
  );
  const enrollments = JSON.stringify(
    status.projects.map(({ projectId, connectionId, remoteProjectId }) => ({
      projectId,
      connectionId,
      remoteProjectId,
    })),
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    const connections = status.connections.filter((item) => !item.signedOut);
    void Promise.all(
      connections.map(async (account) => {
        try {
          const projects = await desktop.invoke<SyncProject[]>(
            "sync:projects",
            { connectionId: account.id },
          );
          return { id: account.id, projects, error: "" };
        } catch (reason) {
          return {
            id: account.id,
            projects: undefined,
            error: errorMessage(reason),
          };
        }
      }),
    )
      .then((results) => {
        if (!active) return;
        setCatalogs((current) =>
          Object.fromEntries(
            connections.map((account) => {
              const value = results.find((item) => item.id === account.id);
              return [account.id, value?.projects ?? current[account.id] ?? []];
            }),
          ),
        );
        setCatalogErrors(
          Object.fromEntries(
            results
              .filter((item) => item.error)
              .map((item) => [item.id, item.error]),
          ),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accounts, revision, enrollments]);
  async function act(key: string, operation: () => Promise<void>) {
    setPending((current) => new Set(current).add(key));
    setErrors((current) => ({ ...current, [key]: "" }));
    try {
      await operation();
      if (mounted.current) await onRefresh();
      return true;
    } catch (reason) {
      if (mounted.current)
        setErrors((current) => ({ ...current, [key]: errorMessage(reason) }));
      return false;
    } finally {
      if (mounted.current)
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
    }
  }
  async function download(row: ManagedProject) {
    if (!row.connection || !row.remote?.head) return;
    cancelled.current.delete(row.key);
    const requestId = crypto.randomUUID();
    downloadIds.current.set(row.key, requestId);
    await act(row.key, async () => {
      const result = await desktop.invoke<ManagedSyncStatus>("sync:subscribe", {
        connectionId: row.connection!.id,
        remoteProjectId: row.remote!.id,
        requestId,
      });
      if (cancelled.current.has(row.key)) return;
      const binding = result.projects.find(
        (item) =>
          item.remoteProjectId === row.remote!.id &&
          result.connections.find((account) => account.id === item.connectionId)
            ?.serverId === row.connection!.serverId,
      );
      if (binding?.error) throw new Error(binding.error);
      const scan = await desktop.invoke<{ projects: ProjectSummary[] }>(
        "projects:scan",
        { includeArchived: true, includeHidden: true },
      );
      if (!scan.projects.some((item) => item.id === binding?.projectId))
        throw new Error(f("projects.downloadIncomplete"));
      notify(f("projects.downloaded", { name: row.name }));
    });
    if (downloadIds.current.get(row.key) === requestId)
      downloadIds.current.delete(row.key);
  }
  async function cancelDownload(row: ManagedProject) {
    cancelled.current.add(row.key);
    await act(`${row.key}:cancel`, async () => {
      await desktop.invoke("sync:cancelDownload", {
        connectionId: row.connection!.id,
        remoteProjectId: row.remote!.id,
        requestId:
          downloadIds.current.get(row.key) ??
          status.downloads?.find(
            (item) =>
              item.remoteProjectId === row.remote?.id &&
              item.connectionId === row.connection?.id,
          )?.requestId,
      });
      notify(f("projects.downloadCancelled", { name: row.name }));
    });
  }
  async function enable(row: ManagedProject, enabled: boolean) {
    if (!row.binding || !row.local) return;
    const success = await act(row.key, async () => {
      await desktop.invoke("sync:setEnabled", {
        projectId: row.local!.id,
        enabled,
      });
      const projectId = row.local!.id;
      notify(
        f(enabled ? "projects.syncEnabled" : "projects.syncStopped", {
          name: row.name,
        }),
        {
          duration: 10000,
          action: {
            label: f("projects.undo"),
            onSelect: () => {
              void desktop
                .invoke("sync:setEnabled", { projectId, enabled: !enabled })
                .then(async () => {
                  if (mounted.current) await onRefresh();
                  notify(f("projects.undone"));
                })
                .catch((reason) =>
                  notify(errorMessage(reason), {
                    kind: "warning",
                    duration: 8000,
                  }),
                );
            },
          },
        },
      );
    });
    if (success) setDialog(null);
  }
  async function sync(row: ManagedProject) {
    if (!row.local) return;
    if (!row.binding) {
      onUpload(row.local.id);
      return;
    }
    if (row.connection?.signedOut) {
      onSignIn(row.connection);
      return;
    }
    if (row.binding.paused) {
      await enable(row, true);
      return;
    }
    let plan: { pending: boolean } | undefined;
    const checked = await act(row.key, async () => {
      plan = await desktop.invoke<{ pending: boolean }>("sync:pausePlan", {
        projectId: row.local!.id,
      });
    });
    if (checked && plan?.pending) setDialog({ kind: "pause", row });
    else if (checked) await enable(row, false);
  }
  const rows = managedProjects(
    localProjects,
    status.projects,
    status.connections,
    catalogs,
    filter,
  ).filter(
    (row) =>
      row.archived === archived &&
      row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const hidden = new Set(status.hiddenProjectIds ?? []);
  function iconButton(
    label: string,
    icon: React.ReactNode,
    click: () => void,
    disabled = false,
    extra = "",
    unavailableReason?: string,
    text?: string,
  ) {
    return (
      <button
        type="button"
        className={`${text ? "settings-button" : "studio-icon"} sync-action ${extra}`}
        aria-label={label}
        title={label}
        data-icon-tooltip={disabled ? unavailableReason : undefined}
        aria-description={disabled ? unavailableReason : undefined}
        disabled={disabled}
        onClick={click}
      >
        {icon}
        {text}
      </button>
    );
  }
  function label(row: ManagedProject, downloading: boolean) {
    if (downloading) return f("projects.downloading");
    if (!row.local)
      return row.remote?.head === null
        ? f("projects.unpublished")
        : f("projects.cloudOnly");
    if (row.binding?.paused) return f("projects.stopped");
    if (row.connection?.signedOut) return f("signIn");
    if (!row.binding) return t("status.local");
    return t(`state.${row.binding.status}`);
  }
  function stateTone(
    row: ManagedProject,
    downloading: boolean,
  ): "ok" | "warn" | "error" | undefined {
    if (downloading) return "warn";
    if (row.binding?.status === "conflict" || row.binding?.status === "save-failed")
      return "error";
    if (row.connection?.signedOut || row.binding?.status === "offline" || row.binding?.status === "revoked")
      return "warn";
    if (row.binding && !row.binding.paused && row.binding.status === "synced")
      return "ok";
    return undefined;
  }
  return (
    <section
      className="settings-group sync-project-manager"
      aria-labelledby="sync-project-manager-title"
    >
      <div className="settings-group-heading">
        <div>
          <h2 id="sync-project-manager-title">{f("projects.title")}</h2>
          <p className="settings-group-desc">{t("section.projectsHelp")}</p>
        </div>
        <div className="sync-manager-actions">
          {iconButton(
            f("projects.refresh"),
            <RefreshCw size={15} />,
            () => {
              setRevision((n) => n + 1);
              void onRefresh();
            },
            loading,
            "",
            undefined,
            f("projects.refresh"),
          )}
          {iconButton(
            f("invitationTitle"),
            <Link2 size={15} />,
            onJoin,
            false,
            "",
            undefined,
            f("invitationTitle"),
          )}
          {iconButton(
            f("projects.new"),
            <Plus size={16} />,
            () => {
              setName("");
              setLoginInCreate(false);
              creationId.current = crypto.randomUUID();
              setDialog({ kind: "create" });
            },
            false,
            "settings-primary-button",
            undefined,
            f("projects.new"),
          )}
        </div>
      </div>

      <div className="sync-manager-filters">
        <div
          className="settings-segmented"
          role="group"
          aria-label={f("projects.filter")}
        >
          <button
            type="button"
            aria-pressed={!archived}
            onClick={() => setArchived(false)}
          >
            {f("projects.all")}
          </button>
          <button
            type="button"
            aria-pressed={archived}
            onClick={() => setArchived(true)}
          >
            {t("archived")}
          </button>
        </div>
        <label className="sync-source-filter">
          <span>{f("projects.source")}</span>
          <Select
            aria-label={f("projects.location")}
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
          >
            <option value="all">{f("projects.allLocations")}</option>
            <option value="local">{f("localLocation")}</option>
            {status.connections.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.user.name}
              </option>
            ))}
          </Select>
        </label>
        {filter !== "all" && (
          <button
            type="button"
            className="settings-button"
            onClick={() => onFilter("all")}
          >
            {f("clearSourceFilter")}
          </button>
        )}
        <label className="settings-search-field sync-manager-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label={f("projectSearch")}
            placeholder={f("projectSearch")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {Object.entries(catalogErrors)
        .filter(([id]) => filter === "all" || filter === id)
        .map(([id, error]) => (
          <div
            key={id}
            role="alert"
            className="settings-callout sync-alert"
            data-tone="error"
          >
            <CircleAlert size={15} aria-hidden="true" />
            <span>
              {status.connections.find((item) => item.id === id)?.name}: {error}
            </span>
          </div>
        ))}

      <div className="settings-card sync-table-card">
        {rows.length > 0 ? (
          <table className="sync-manager-table">
            <thead>
              <tr>
                <th>{f("projectColumn")}</th>
                <th className="sync-manager-source">{f("projects.source")}</th>
                <th className="sync-manager-state">{f("projects.state")}</th>
                <th>{f("actionsColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const transfer = status.downloads?.some(
                  (item) =>
                    item.remoteProjectId === row.remote?.id &&
                    item.connectionId === row.connection?.id,
                );
                const downloading =
                  !!transfer || (pending.has(row.key) && !row.local);
                const updating = pending.has(row.key) && !!row.local;
                const state = label(row, downloading);
                const tone = stateTone(row, downloading);
                return (
                  <tr key={row.key}>
                    <td>
                      <strong className="sync-project-name">{row.name}</strong>
                      <small>
                        {row.remote
                          ? t(`role.${row.remote.role}`)
                          : row.binding
                            ? t(`role.${row.binding.role}`)
                            : f("localTitle")}
                        <span className="sync-manager-mobile-state">
                          {" "}
                          · {state}
                        </span>
                      </small>
                      {(errors[row.key] ||
                        errors[`${row.key}:cancel`] ||
                        (!row.binding?.paused && row.binding?.error)) && (
                        <p className="sync-error" role="alert">
                          {errors[row.key] ||
                            errors[`${row.key}:cancel`] ||
                            row.binding?.error}
                        </p>
                      )}
                    </td>
                    <td className="sync-manager-source">
                      {row.connection?.name ?? f("localLocation")}
                    </td>
                    <td className="sync-manager-state">
                      <span
                        className="settings-badge"
                        data-tone={tone}
                      >
                        {downloading ? (
                          <Loader2 size={13} className="sync-spin" />
                        ) : !row.local ? (
                          <Cloud size={13} />
                        ) : row.binding ? (
                          row.binding.paused ? (
                            <CloudOff size={13} />
                          ) : (
                            <CloudCheck size={13} />
                          )
                        ) : (
                          <HardDrive size={13} />
                        )}{" "}
                        {state}
                      </span>
                      {row.local && row.connection && (
                        <span
                          className="sync-local-copy"
                          aria-label={f("projects.alreadyDownloaded", {
                            name: row.name,
                          })}
                        >
                          {f("projects.onDevice")}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="sync-manager-row-actions">
                        {row.binding?.status === "conflict" && (
                          <button
                            type="button"
                            className="settings-button settings-primary-button sync-action"
                            onClick={() => onConflict(row.binding!)}
                          >
                            {t("resolveConflict")}
                          </button>
                        )}
                        {downloading
                          ? iconButton(
                              f("projects.cancelDownload", { name: row.name }),
                              <X size={16} />,
                              () => void cancelDownload(row),
                              pending.has(`${row.key}:cancel`),
                            )
                          : row.local
                            ? iconButton(
                                f("projects.open", { name: row.name }),
                                <FolderOpen size={15} />,
                                () =>
                                  void act(row.key, async () => {
                                    await onOpenProject?.(row.local!.id);
                                  }),
                                updating,
                                "",
                                undefined,
                                f("openCompact"),
                              )
                            : row.remote?.head
                              ? iconButton(
                                  f("projects.download", { name: row.name }),
                                  <Download size={15} />,
                                  () => void download(row),
                                  !!row.connection?.signedOut,
                                  "",
                                  undefined,
                                  f("downloadCompact"),
                                )
                              : null}
                        <button
                          type="button"
                          className="settings-button sync-action"
                          aria-label={f("projects.more", { name: row.name })}
                          title={f("projects.more", { name: row.name })}
                          aria-haspopup="menu"
                          aria-expanded={menu?.row.key === row.key}
                          onClick={(e) =>
                            setMenu({ row, anchor: e.currentTarget })
                          }
                        >
                          {f("moreActions")}
                          <MoreHorizontal size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="sync-empty">
            <p>
              {loading
                ? t("readingProjects")
                : query
                  ? t("noMatchingProjects")
                  : archived
                    ? f("projects.noArchived")
                    : t("noLocalProjects")}
            </p>
            {!loading && (query || filter !== "all" || archived) && (
              <button
                type="button"
                className="settings-button"
                onClick={() => {
                  setQuery("");
                  onFilter("all");
                  setArchived(false);
                }}
              >
                {f("clearProjectFilters")}
              </button>
            )}
          </div>
        )}
      </div>

      {menu && (
        <LibraryContextMenu
          anchor={menu.anchor}
          label={f("projects.more", { name: menu.row.name })}
          onClose={() => setMenu(null)}
          items={(() => {
            const row = menu.row,
              admin =
                !row.connection ||
                (row.remote?.role ?? row.binding?.role) === "admin";
            return [
              {
                label: f("shareCompact"),
                icon: <Share2 size={16} />,
                disabled: !admin,
                onSelect: () => onShare(row),
              },
              {
                label: tc("rename"),
                icon: <Pencil size={16} />,
                disabled: !admin,
                onSelect: () => {
                  setName(row.name);
                  setDialog({ kind: "rename", row });
                },
              },
              {
                label: f(
                  row.local && hidden.has(row.local.id)
                    ? "projects.showSidebar"
                    : "projects.hideSidebar",
                ),
                icon:
                  row.local && hidden.has(row.local.id) ? (
                    <Eye size={16} />
                  ) : (
                    <EyeOff size={16} />
                  ),
                disabled: !row.local,
                onSelect: () =>
                  void act(row.key, async () => {
                    await desktop.invoke("sync:projectVisibility", {
                      projectId: row.local!.id,
                      visible: hidden.has(row.local!.id),
                    });
                  }),
              },
              {
                label: f(
                  row.binding && !row.binding.paused
                    ? "projects.stop"
                    : "projects.enable",
                ),
                icon: <CloudOff size={16} />,
                disabled: !row.local,
                onSelect: () => void sync(row),
              },
              ...(row.local && row.binding
                ? [
                    {
                      label: f("projects.details"),
                      icon: <Settings2 size={16} />,
                      onSelect: () => onDetails(row.local!.id),
                    },
                  ]
                : []),
              ...(row.binding?.status === "conflict"
                ? [
                    {
                      label: t("resolveConflict"),
                      icon: <RefreshCw size={16} />,
                      onSelect: () => onConflict(row.binding!),
                    },
                  ]
                : []),
              {
                label: row.archived ? t("restoreProject") : t("archiveProject"),
                icon: row.archived ? (
                  <ArchiveRestore size={16} />
                ) : (
                  <Archive size={16} />
                ),
                disabled: !admin,
                separatorBefore: true,
                onSelect: () => setDialog({ kind: "archive", row }),
              },
            ];
          })()}
        />
      )}
      {dialog && (
        <Dialog
          showTitle={dialog.kind !== "archive" && dialog.kind !== "rename"}
          tone={
            dialog.kind === "pause"
              ? "caution"
              : dialog.kind === "archive" && dialog.row?.archived
                ? "positive"
                : undefined
          }
          description={
            dialog.kind === "archive"
              ? f(
                  dialog.row!.archived
                    ? "projects.restoreConfirm"
                    : "projects.archiveConfirm",
                  { name: dialog.row!.name },
                )
              : dialog.kind === "pause"
                ? f("projects.stopKeepsLocal")
                : undefined
          }
          title={
            loginInCreate && dialog.kind === "create"
              ? f("auth.title")
              : dialog.kind === "create"
                ? f("projects.new")
                : dialog.kind === "rename"
                  ? tc("rename")
                  : dialog.kind === "pause"
                    ? f("projects.stopSync", { name: dialog.row!.name })
                    : dialog.row!.archived
                      ? t("restoreProject")
                      : t("archiveProject")
          }
          onClose={() => setDialog(null)}
          className="sync-dialog sync-simple-dialog"
        >
          <div className="sync-dialog-body studio-dialog-body">
            {dialog.kind === "create" && loginInCreate ? (
              <>
                <AccountLogin
                  initial={{ url: "https://showai.renaissancemind.ai/cloud" }}
                  onConnected={async (id) => {
                    await onRefresh();
                    setLocation(id);
                    setLoginInCreate(false);
                  }}
                />
                <button
                  type="button"
                  className="sync-text-button"
                  onClick={() => setLoginInCreate(false)}
                >
                  {f("projects.backToCreate")}
                </button>
              </>
            ) : dialog.kind === "create" || dialog.kind === "rename" ? (
              <form
                className="studio-dialog-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("dialog", async () => {
                    if (dialog.kind === "create") {
                      if (location) {
                        await desktop.invoke("sync:createProject", {
                          id: creationId.current,
                          connectionId: location,
                          name: name.trim(),
                        });
                      } else
                        await desktop.invoke("sync:createLocalProject", {
                          name: name.trim(),
                        });
                      setQuery("");
                      setArchived(false);
                      onFilter("all");
                      setRevision((n) => n + 1);
                    } else {
                      const row = dialog.row!;
                      if (row.connection && row.remote)
                        await desktop.invoke("sync:manage", {
                          connectionId: row.connection.id,
                          projectId: row.remote.id,
                          operation: "project",
                          input: { name: name.trim() },
                        });
                      if (row.local)
                        await desktop.invoke("projects:rename", {
                          projectId: row.local.id,
                          name: name.trim(),
                        });
                      setRevision((n) => n + 1);
                    }
                    setDialog(null);
                  });
                }}
              >
                <label className="sync-field">
                  <span>{f("projects.name")}</span>
                  <input
                    className="showai-input"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {dialog.kind === "create" && (
                  <label className="sync-field">
                    <span>{f("projects.saveTo")}</span>
                    <Select
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    >
                      <option value="">{f("localLocation")}</option>
                      {status.connections
                        .filter((item) => !item.signedOut)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.user.name}
                          </option>
                        ))}
                    </Select>
                  </label>
                )}
                {dialog.kind === "create" &&
                  !status.connections.some((item) => !item.signedOut) && (
                    <button
                      type="button"
                      className="sync-text-button"
                      onClick={() => setLoginInCreate(true)}
                    >
                      {f("projects.signInToSave")}
                    </button>
                  )}
                <div className="studio-dialog-actions">
                  <button
                    type="button"
                    className="sync-text-button"
                    onClick={() => setDialog(null)}
                  >
                    {tc("cancel")}
                  </button>
                  <button
                    type="submit"
                    className="settings-button sync-primary"
                    disabled={!name.trim() || pending.has("dialog")}
                  >
                    {dialog.kind === "create"
                      ? f("projects.create")
                      : tc("save")}
                  </button>
                </div>
              </form>
            ) : dialog.kind === "pause" ? (
              <div className="studio-dialog-actions">
                <button
                  type="button"
                  className="sync-text-button"
                  onClick={() => setDialog(null)}
                >
                  {f("projects.continueSync")}
                </button>
                <button
                  type="button"
                  className="settings-button sync-primary"
                  disabled={pending.has(dialog.row!.key)}
                  onClick={() => void enable(dialog.row!, false)}
                >
                  {f("projects.keepAndStop")}
                </button>
              </div>
            ) : (
              <div className="studio-dialog-actions">
                <button
                  type="button"
                  className="sync-text-button"
                  onClick={() => setDialog(null)}
                >
                  {tc("cancel")}
                </button>
                <button
                  type="button"
                  className="settings-button sync-primary"
                  disabled={pending.has("dialog")}
                  onClick={() =>
                    void act("dialog", async () => {
                      const row = dialog.row!,
                        next = !row.archived;
                      if (row.connection && row.remote)
                        await desktop.invoke("sync:manage", {
                          connectionId: row.connection.id,
                          projectId: row.remote.id,
                          operation: "project",
                          input: { archived: next },
                        });
                      if (row.local)
                        await desktop.invoke(
                          next ? "projects:remove" : "library:restore",
                          { projectId: row.local.id, kind: "project" },
                        );
                      setRevision((n) => n + 1);
                      setDialog(null);
                    })
                  }
                >
                  {dialog.row!.archived
                    ? t("restoreProject")
                    : t("archiveProject")}
                </button>
              </div>
            )}
            {errors.dialog && (
              <p className="sync-error" role="alert">
                {errors.dialog}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
