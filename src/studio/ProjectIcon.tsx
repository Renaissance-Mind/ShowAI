import PageIcon from "../components/PageIcon";
import { Cloud, Folder, FolderOpen } from "../ui/icons";
import "./project-icon.css";

/** Cloud membership stays visible while the row reports transient sync problems. */
export default function ProjectIcon({
  value,
  size = 18,
  expanded = false,
  cloud = false,
}: {
  value?: string;
  size?: number;
  expanded?: boolean;
  cloud?: boolean;
}) {
  const Icon = expanded ? FolderOpen : Folder;
  return (
    <span
      className="studio-project-icon"
      data-cloud={cloud || undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <PageIcon
        value={value}
        size={size}
        fallback={<Icon size={size} strokeWidth={1.75} />}
      />
      {cloud && (
        <span className="studio-project-icon-cloud">
          <Cloud className="studio-project-icon-knockout" strokeWidth={6} />
          <Cloud className="studio-project-icon-mark" strokeWidth={2.25} />
        </span>
      )}
    </span>
  );
}
