import { useEffect, useState, type ReactNode } from "react";
import { Folder, Loader2, Plus } from "../../ui/icons";
import type { ProjectGroup, ProjectSummary } from "../../core/model";
import type { LibraryTarget } from "../LibraryNavigation";
import Dialog from "../../ui/Dialog";
import PageIcon from "../../components/PageIcon";
import PageIconDialog from "../../components/PageIconDialog";
import { desktop, errorMessage } from "../../host/bridge";
import { useTranslator } from "../../i18n/react";
import accountFlowMessages from "../../i18n/messages/accountFlow";
import commonMessages from "../../i18n/messages/common";
import navigationMessages from "../../i18n/messages/navigation";
import studioMessages from "../../i18n/messages/studio";

export function MoveProjectDialog({
  groups,
  currentGroup,
  onClose,
  onCreate,
  onSave,
}: {
  groups: ProjectGroup[];
  currentGroup: string;
  onClose: () => void;
  onCreate: () => void;
  onSave: (groupId: string | null) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [groupId, setGroupId] = useState(currentGroup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={t("moveToGroupTitle")} onClose={onClose}>
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          void onSave(groupId || null)
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {t("group")}
          <select
            aria-label={t("targetGroup")}
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">{t("ungrouped")}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <button className="studio-button" type="button" onClick={onCreate}>
          <Plus size={15} />
          {t("newGroup")}
        </button>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" type="button" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button className="studio-button primary" disabled={busy}>
            {busy && <Loader2 size={14} className="studio-spin" />}
            {t("move")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

export function NameDialog({
  title,
  inputLabel,
  initialValue = "",
  onClose,
  onSave,
}: {
  title: string;
  inputLabel: string;
  initialValue?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const tc = useTranslator(commonMessages);
  const [name, setName] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          setError("");
          void onSave(name.trim())
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {inputLabel}
          <input
            aria-label={inputLabel}
            value={name}
            maxLength={1000}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" type="button" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button
            className="studio-button primary"
            disabled={!name.trim() || busy}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}
            {initialValue ? tc("save") : tc("create")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

export function DeleteDialog({
  target,
  onClose,
  onDelete,
}: {
  target: LibraryTarget;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tn = useTranslator(navigationMessages);
  const tc = useTranslator(commonMessages);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      title={t(
        target.kind === "project"
          ? "deleteProject"
          : target.kind === "folder"
            ? "deleteFolder"
            : "deletePage",
      )}
      onClose={onClose}
    >
      <div className="studio-form">
        <p className="studio-delete-description">
          {t("deleteConfirm", { title: target.title })}
          {target.kind !== "page" && t("deleteChildren")}
        </p>
        <p className="settings-help">{tn("deleteRestoreHint")}</p>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button
            className="studio-button danger"
            data-autofocus
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onDelete()
                .catch((reason) => setError(errorMessage(reason)))
                .finally(() => setBusy(false));
            }}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}
            {tc("delete")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}

export function ProjectDialog({
  project,
  onClose,
  onSave,
}: {
  project?: ProjectSummary;
  onClose: () => void;
  onSave: (name: string, icon: string) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const f = useTranslator(accountFlowMessages);
  const [locationName, setLocationName] = useState("");
  const [locationError, setLocationError] = useState("");
  useEffect(() => {
    if (project) return;
    void desktop
      .invoke<{
        defaultConnectionId: string | null;
        connections: { id: string; name: string; user: { name: string } }[];
      }>("sync:status")
      .then((status) => {
        const connection = status.connections.find(
          (item) => item.id === status.defaultConnectionId,
        );
        setLocationName(
          connection
            ? `${connection.name} · ${connection.user.name}`
            : f("localLocation"),
        );
      })
      .catch((reason) => setLocationError(errorMessage(reason)));
  }, [project]);
  return (
    <DirectoryDialog
      title={project ? t("projectSettings") : t("newProjectTitle")}
      inputLabel={t("projectName")}
      placeholder={t("projectNamePlaceholder")}
      iconButtonLabel={t("setProjectIcon")}
      iconDialogTitle={t("projectIcon")}
      submitLabel={project ? tc("save") : t("createProject")}
      initialName={project?.name}
      initialIcon={project?.icon}
      onClose={onClose}
      onSave={onSave}
    >
      {!project && (
        <p className={locationError ? "studio-form-error" : "settings-help"}>
          {locationError ||
            (locationName && f("savingTo", { name: locationName }))}
        </p>
      )}
    </DirectoryDialog>
  );
}

export function FolderDialog({
  folder,
  onClose,
  onSave,
}: {
  folder?: LibraryTarget;
  onClose: () => void;
  onSave: (name: string, icon: string) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  return (
    <DirectoryDialog
      title={folder ? t("folderSettings") : t("newFolder")}
      inputLabel={t("folderName")}
      iconButtonLabel={t("setFolderIcon")}
      iconDialogTitle={t("folderIcon")}
      submitLabel={folder ? tc("save") : tc("create")}
      initialName={folder?.title}
      initialIcon={folder?.icon}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

/** Projects and folders share one name-and-icon form with a folder glyph fallback. */
function DirectoryDialog({
  title,
  inputLabel,
  placeholder,
  iconButtonLabel,
  iconDialogTitle,
  submitLabel,
  initialName = "",
  initialIcon = "",
  onClose,
  onSave,
  children,
}: {
  children?: ReactNode;
  title: string;
  inputLabel: string;
  placeholder?: string;
  iconButtonLabel: string;
  iconDialogTitle: string;
  submitLabel: string;
  initialName?: string;
  initialIcon?: string;
  onClose: () => void;
  onSave: (name: string, icon: string) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState(initialIcon);
  const [choosingIcon, setChoosingIcon] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Dialog title={title} onClose={onClose}>
        <form
          className="studio-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            setError("");
            void onSave(name.trim(), icon)
              .catch((reason) => setError(errorMessage(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            {t("name")}
            <input
              aria-label={inputLabel}
              placeholder={placeholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={1000}
            />
          </label>
          <button
            type="button"
            className="studio-button studio-project-icon-choice"
            disabled={busy}
            onClick={() => setChoosingIcon(true)}
            aria-label={iconButtonLabel}
          >
            <PageIcon value={icon} size={28} fallback={<Folder size={28} />} />
            <span>{t("setIconButton")}</span>
          </button>
          {children}
          {error && (
            <p className="studio-form-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button type="button" className="studio-button" onClick={onClose}>
              {tc("cancel")}
            </button>
            <button
              className="studio-button primary"
              disabled={!name.trim() || busy}
            >
              {busy ? <Loader2 size={15} className="studio-spin" /> : null}
              {submitLabel}
            </button>
          </footer>
        </form>
      </Dialog>
      {choosingIcon && (
        <PageIconDialog
          title={iconDialogTitle}
          value={icon}
          fallback={<Folder size={56} />}
          onClose={() => setChoosingIcon(false)}
          onSave={async (next) => {
            setIcon(next);
          }}
        />
      )}
    </>
  );
}
