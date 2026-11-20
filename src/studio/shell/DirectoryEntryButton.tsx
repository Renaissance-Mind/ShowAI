import type { ComponentPropsWithoutRef } from "react";
import PageIcon from "../../components/PageIcon";
import { Folder } from "../../ui/icons";

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
        <PageIcon
          value={icon}
          size={19}
          fallback={folder ? <Folder size={19} /> : undefined}
        />
      </span>
      <strong>{title}</strong>
      {children}
    </button>
  );
}
