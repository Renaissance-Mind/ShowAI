import { useEffect, useState } from "react";
import { Folder, Loader2 } from "../ui/icons";
import Dialog from "./Dialog";
import PageIcon from "../components/PageIcon";
import { desktop, errorMessage } from "./bridge";
import { getLocale } from "../i18n";
import { useTranslator } from "../i18n/react";
import navigationMessages from "../i18n/messages/navigation";
import commonMessages from "../i18n/messages/common";
import surfaceMessages from "../i18n/messages/surface";
import type { DeletedEntries } from "../core/deleted-entries";
import type { ProjectSummary } from "../core/model";
import {
  clientIsMac,
  formatShortcut,
  shortcutGroups,
} from "./keyboard-shortcuts";
import "./library-navigation-dialogs.css";

export type RestoreTarget =
  | { kind: "project"; projectId: string; title: string }
  | { kind: "folder"; projectId: string; id: string; title: string }
  | { kind: "page"; projectId: string; id: string; title: string };

/** Deleting archives an item; restoring clears the flag through one action. */
export function restoreItem(target: RestoreTarget) {
  return desktop.invoke("library:restore", {
    kind: target.kind,
    projectId: target.projectId,
    ...(target.kind === "folder" ? { folderId: target.id } : {}),
    ...(target.kind === "page" ? { pageId: target.id } : {}),
  });
}

const date = (value: string) =>
  new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
  }).format(new Date(value));

function RestoreList({
  heading,
  items,
  busy,
  onRestore,
}: {
  heading: string;
  items: {
    key: string;
    title: string;
    icon?: string;
    detail: string;
    folder: boolean;
    target: RestoreTarget;
  }[];
  busy: string;
  onRestore: (target: RestoreTarget, key: string) => void;
}) {
  const t = useTranslator(navigationMessages);
  if (!items.length) return null;
  return (
    <section className="navigation-restore-section">
      <h3>{heading}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <span className="navigation-restore-icon">
              {item.folder ? (
                <PageIcon
                  value={item.icon}
                  size={17}
                  fallback={<Folder size={17} />}
                />
              ) : (
                <PageIcon value={item.icon} size={17} />
              )}
            </span>
            <span className="navigation-restore-text">
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            <button
              type="button"
              className="studio-button"
              disabled={!!busy}
              aria-label={t("restoreNamed", { title: item.title })}
              onClick={() => onRestore(item.target, item.key)}
            >
              {busy === item.key && (
                <Loader2 size={14} className="studio-spin" />
              )}
              {t("restore")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DeletedItemsDialog({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: (target: RestoreTarget) => Promise<void>;
}) {
  const t = useTranslator(navigationMessages);
  const tc = useTranslator(commonMessages);
  const [entries, setEntries] = useState<DeletedEntries | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () =>
    desktop
      .invoke<DeletedEntries>("library:deleted")
      .then(setEntries, (reason) => setError(errorMessage(reason)));
  useEffect(() => {
    void load();
  }, []);
  const restore = (target: RestoreTarget, key: string) => {
    setBusy(key);
    setError("");
    void restoreItem(target)
      .then(() => onRestored(target))
      .then(load)
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setBusy(""));
  };
  const empty =
    entries &&
    !entries.projects.length &&
    !entries.folders.length &&
    !entries.pages.length;
  return (
    <Dialog title={t("deleted.title")} onClose={onClose} wide>
      <div className="navigation-restore">
        <p className="settings-help">{t("deleted.intro")}</p>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        {!entries && !error && <p role="status">{t("reading")}</p>}
        {empty && <p role="status">{t("deleted.empty")}</p>}
        {entries && (
          <>
            <RestoreList
              heading={t("deleted.projects")}
              busy={busy}
              onRestore={restore}
              items={entries.projects.map((item) => ({
                key: `project:${item.id}`,
                title: item.name,
                icon: item.icon,
                detail: date(item.updatedAt),
                folder: true,
                target: {
                  kind: "project",
                  projectId: item.id,
                  title: item.name,
                },
              }))}
            />
            <RestoreList
              heading={t("deleted.folders")}
              busy={busy}
              onRestore={restore}
              items={entries.folders.map((item) => ({
                key: `folder:${item.projectId}:${item.id}`,
                title: item.name,
                icon: item.icon,
                detail: t("deleted.location", {
                  project: item.projectName,
                  date: date(item.updatedAt),
                }),
                folder: true,
                target: {
                  kind: "folder",
                  projectId: item.projectId,
                  id: item.id,
                  title: item.name,
                },
              }))}
            />
            <RestoreList
              heading={t("deleted.pages")}
              busy={busy}
              onRestore={restore}
              items={entries.pages.map((item) => ({
                key: `page:${item.projectId}:${item.id}`,
                title: item.title || tc("untitled"),
                icon: item.icon,
                detail: t("deleted.location", {
                  project: item.projectName,
                  date: date(item.updatedAt),
                }),
                folder: false,
                target: {
                  kind: "page",
                  projectId: item.projectId,
                  id: item.id,
                  title: item.title || tc("untitled"),
                },
              }))}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

export function HiddenProjectsDialog({
  onClose,
  onShown,
}: {
  onClose: () => void;
  onShown: (project: ProjectSummary) => Promise<void>;
}) {
  const t = useTranslator(navigationMessages);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = async () => {
    const [status, all] = await Promise.all([
      desktop.invoke<{ hiddenProjectIds?: string[] }>("sync:status"),
      desktop.invoke<ProjectSummary[]>("projects:list", {
        includeHidden: true,
      }),
    ]);
    const hidden = new Set(status.hiddenProjectIds ?? []);
    setProjects(all.filter((project) => hidden.has(project.id)));
  };
  useEffect(() => {
    void load().catch((reason) => setError(errorMessage(reason)));
  }, []);
  return (
    <Dialog title={t("hidden.title")} onClose={onClose}>
      <div className="navigation-restore">
        <p className="settings-help">{t("hidden.intro")}</p>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        {!projects && !error && <p role="status">{t("reading")}</p>}
        {projects && !projects.length && (
          <p role="status">{t("hidden.empty")}</p>
        )}
        {!!projects?.length && (
          <section className="navigation-restore-section">
            <ul>
              {projects.map((project) => (
                <li key={project.id}>
                  <span className="navigation-restore-icon">
                    <PageIcon
                      value={project.icon}
                      size={17}
                      fallback={<Folder size={17} />}
                    />
                  </span>
                  <span className="navigation-restore-text">
                    <strong>{project.name}</strong>
                  </span>
                  <button
                    type="button"
                    className="studio-button"
                    disabled={!!busy}
                    aria-label={t("showNamed", { name: project.name })}
                    onClick={() => {
                      setBusy(project.id);
                      setError("");
                      void desktop
                        .invoke("sync:projectVisibility", {
                          projectId: project.id,
                          visible: true,
                        })
                        .then(() => onShown(project))
                        .then(load)
                        .catch((reason) => setError(errorMessage(reason)))
                        .finally(() => setBusy(""));
                    }}
                  >
                    {busy === project.id && (
                      <Loader2 size={14} className="studio-spin" />
                    )}
                    {t("show")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}

export function ShortcutsDialog({
  browser = false,
  tabs,
  windows,
  onClose,
}: {
  /** The browser workbench: shortcuts the browser keeps for itself are left out. */
  browser?: boolean;
  tabs: boolean;
  windows: boolean;
  onClose: () => void;
}) {
  const t = useTranslator(navigationMessages);
  const ts = useTranslator(surfaceMessages);
  const mac = clientIsMac();
  const names = {
    Click: t("key.click"),
    Space: t("key.space"),
    Menu: t("key.menu"),
    Arrows: t("key.arrows"),
  };
  return (
    <Dialog title={t("shortcuts.title")} onClose={onClose} wide>
      <div className="navigation-shortcuts">
        {shortcutGroups({ mac, tabs, windows, browser }).map((group) => (
          <section key={group.id} aria-labelledby={`shortcuts-${group.id}`}>
            <h3 id={`shortcuts-${group.id}`}>
              {t(`shortcuts.${group.id}`)}
            </h3>
            <dl>
              {group.entries.map((entry, index) => (
                <div key={index}>
                  <dt>
                    {entry.keys.map((chord, keyIndex) => (
                      <span key={chord}>
                        {keyIndex > 0 && (
                          <span className="navigation-shortcut-or">
                            {t("shortcuts.or")}
                          </span>
                        )}
                        <kbd>{formatShortcut(chord, mac, names)}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>
                    {"navigation" in entry.label
                      ? t(entry.label.navigation)
                      : ts(entry.label.surface)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
