import type { ComponentProps } from "react";
import FolderIcon from "./FolderIcon";
import { useTranslator } from "../i18n/react";
import folderIconMessages from "../i18n/messages/folderIcons";
import type { IconPresetPicker } from "./PageIconDialog";
import {
  folderIconGroups,
  folderPresetFromIcon,
  folderPresetSource,
  rasterizeFolderPreset,
} from "./folder-icon-presets";
import "./folder-icon-defaults.css";

function FolderIconDefaults({
  busy,
  value,
  onChoose,
  onDefault,
}: ComponentProps<IconPresetPicker["Options"]>) {
  const t = useTranslator(folderIconMessages);
  const selectedPreset = folderPresetFromIcon(value)?.id;
  return (
    <div className="folder-icon-defaults">
      {folderIconGroups.map((group) => (
        <section key={group.id} className="folder-icon-group">
          <h3>{t(group.nameKey)}</h3>
          <div className="folder-icon-grid">
            {group.id === "color" && (
              <button
                type="button"
                className="folder-icon-standard"
                title={t("defaultColor")}
                aria-label={t("defaultColor")}
                aria-pressed={!value}
                disabled={busy}
                onClick={onDefault}
              >
                <FolderIcon size={30} />
              </button>
            )}
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
                  onClick={() => onChoose(() => rasterizeFolderPreset(preset))}
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
        </section>
      ))}
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
  isPreset: (value) => !!folderPresetFromIcon(value),
} satisfies IconPresetPicker;
