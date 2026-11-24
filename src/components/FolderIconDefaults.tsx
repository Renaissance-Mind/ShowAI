import type { ComponentProps } from "react";
import FolderIcon, { FolderIconGlyph } from "./FolderIcon";
import { useTranslator } from "../i18n/react";
import folderIconMessages from "../i18n/messages/folderIcons";
import type { IconPresetPicker } from "./PageIconDialog";
import {
  folderIconGroups,
  folderPresetFromIcon,
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
  const iconSize = 48;
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
                <FolderIconGlyph size={iconSize} />
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
                  onClick={(event) => {
                    const glyph = event.currentTarget.querySelector("svg")!;
                    onChoose(() => rasterizeFolderPreset(preset, glyph));
                  }}
                >
                  <FolderIconGlyph size={iconSize} preset={preset} />
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
  const iconSize = 64;
  return (
    <>
      <div className="page-icon-preview-tile" data-folder-state="closed">
        <FolderIcon value={presetValue} size={iconSize} />
      </div>
      <div className="page-icon-preview-tile" data-folder-state="open">
        <FolderIcon value={presetValue} size={iconSize} open />
      </div>
    </>
  );
}

export default {
  Options: FolderIconDefaults,
  Preview: FolderIconPreview,
  isPreset: (value) => !!folderPresetFromIcon(value),
} satisfies IconPresetPicker;
