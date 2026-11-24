import type { ComponentPropsWithoutRef } from "react";
import FolderIcon from "../../components/FolderIcon";
import PageIcon from "../../components/PageIcon";

export default function DirectoryEntryButton({
  title,
  icon,
  folder,
  thumbnail,
  children,
  ...button
}: Omit<ComponentPropsWithoutRef<"button">, "title"> & {
  title: string;
  icon?: string;
  folder?: boolean;
  thumbnail?: boolean;
}) {
  return (
    <button type="button" className="studio-page-list-open" {...button}>
      {thumbnail && <span className="studio-thumbnail-space" />}
      <span className="studio-page-list-icon">
        {folder ? (
          <FolderIcon value={icon} size={19} strokeWidth={2} />
        ) : (
          <PageIcon value={icon} size={19} />
        )}
      </span>
      <strong>{title}</strong>
      {children}
    </button>
  );
}
