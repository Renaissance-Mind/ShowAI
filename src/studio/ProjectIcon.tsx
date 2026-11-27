import FolderIcon from "../components/FolderIcon";
import { Cloud } from "../ui/icons";
import "./project-icon.css";

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
  return (
    <span
      className="studio-project-icon"
      data-cloud={cloud || undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <FolderIcon
        value={value}
        size={size}
        open={expanded}
        strokeWidth={1.75}
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
