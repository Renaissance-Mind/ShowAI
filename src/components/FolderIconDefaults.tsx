import { useState, type ComponentProps } from "react";
import FolderIcon from "./FolderIcon";
import { useTranslator } from "../i18n/react";
import folderIconMessages from "../i18n/messages/folderIcons";
import type { IconPresetPicker } from "./PageIconDialog";
import {
  defaultFolderIconGroups,
  folderIconGroups,
  folderPresetFromIcon,
  folderPresetSource,
  parseFolderIconGroups,
  rasterizeFolderPreset,
  type FolderIconGroupId,
} from "./folder-icon-presets";
import "./folder-icon-defaults.css";

const storageKey = "showai:folder-icon-groups";

function FolderIconDefaults({
  busy,
  value,
  onChoose,
}: ComponentProps<IconPresetPicker["Options"]>) {
  const t = useTranslator(folderIconMessages);
  const selectedPreset = folderPresetFromIcon(value)?.id;
  const [enabled, setEnabled] = useState(() =>
    parseFolderIconGroups(localStorage.getItem(storageKey)),
  );
  const update = (id: FolderIconGroupId, visible: boolean) => {
    const next = { ...enabled, [id]: visible };
    setEnabled(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const hidden = folderIconGroups.every((group) => !enabled[group.id]);
  return (
    <div className="folder-icon-defaults">
      {folderIconGroups.map((group) => (
        <section key={group.id} className="folder-icon-group">
          <header>
            <h3>{t(group.nameKey)}</h3>
            <input
              className="showai-checkbox folder-icon-switch"
              type="checkbox"
              role="switch"
              checked={enabled[group.id]}
              disabled={busy}
              aria-label={t("toggleGroup", { group: t(group.nameKey) })}
              onChange={(event) => update(group.id, event.target.checked)}
            />
          </header>
          {enabled[group.id] && (
            <div className="folder-icon-grid">
              {group.presets.map((preset) => {
                const label = t(preset.nameKey);
                return (
                  <button
                    type="button"
                    key={preset.id}
                    title={label}
                    aria-label={t("useFolder", { icon: label })}
                    aria-pressed={selectedPreset === preset.id}
                    disabled={busy}
                    onClick={() =>
                      onChoose(() => rasterizeFolderPreset(preset))
                    }
                  >
                    <img
                      src={folderPresetSource(preset)}
                      alt=""
                      draggable={false}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ))}
      {hidden && (
        <div className="folder-icon-empty">
          <p>{t("groupsHidden")}</p>
          <button
            type="button"
            className="studio-button"
            disabled={busy}
            onClick={() => {
              const next = defaultFolderIconGroups();
              setEnabled(next);
              localStorage.setItem(storageKey, JSON.stringify(next));
            }}
          >
            {t("showAllGroups")}
          </button>
        </div>
      )}
    </div>
  );
}

function FolderIconPreview({ value }: { value: string }) {
  const presetValue = folderPresetFromIcon(value) ? value : undefined;
  return (
    <>
      <div className="page-icon-preview-tile" data-folder-state="closed">
        <FolderIcon value={presetValue} size={48} />
      </div>
      <div className="page-icon-preview-tile" data-folder-state="open">
        <FolderIcon value={presetValue} size={48} open />
      </div>
    </>
  );
}

export default {
  Options: FolderIconDefaults,
  Preview: FolderIconPreview,
} satisfies IconPresetPicker;
