import PageIcon from "./PageIcon";
import { Folder, FolderOpen } from "../ui/icons";
import {
  folderPresetFromIcon,
  folderPresetSource,
} from "./folder-icon-presets";

export default function FolderIcon({
  value,
  open = false,
  size = 18,
}: {
  value?: string;
  open?: boolean;
  size?: number;
}) {
  const preset = folderPresetFromIcon(value);
  if (preset)
    return (
      <img
        src={folderPresetSource(preset, open)}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
    );
  const Outline = open ? FolderOpen : Folder;
  return (
    <PageIcon
      value={value}
      size={size}
      fallback={<Outline size={size} strokeWidth={1.7} />}
    />
  );
}
