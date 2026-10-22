import { memo, type CSSProperties } from "react";
import { Folder } from "../ui/icons";
import PageThumbnail from "./PageThumbnail";

export interface FolderThumbnailEntry {
  kind: "folder" | "page";
  id: string;
  updatedAt: string;
}

/**
 * A folder's preview: its first entries as a small fan of sheets on a tinted
 * ground that sets folders apart from pages. The first entry stands in front;
 * subfolders appear as folder sheets, so a card loads at most three pages.
 */
export default memo(
  function FolderThumbnail({
    projectId,
    entries,
  }: {
    projectId: string;
    entries: FolderThumbnailEntry[];
  }) {
    const sheets = entries.slice(0, 3);
    return (
      <span
        className="studio-folder-thumbnail"
        data-sheets={sheets.length}
        aria-hidden="true"
        inert
      >
        {sheets.length ? (
          sheets.map((entry, index) => (
            <span
              key={entry.id}
              className="studio-folder-sheet"
              data-kind={entry.kind}
              data-position={index}
              style={{ zIndex: sheets.length - index } as CSSProperties}
            >
              {entry.kind === "page" ? (
                <PageThumbnail
                  projectId={projectId}
                  pageId={entry.id}
                  updatedAt={entry.updatedAt}
                  padding={3}
                />
              ) : (
                <Folder size={18} strokeWidth={1.5} />
              )}
            </span>
          ))
        ) : (
          <Folder className="studio-folder-empty" size={30} strokeWidth={1} />
        )}
      </span>
    );
  },
  (previous, next) =>
    previous.projectId === next.projectId &&
    previous.entries.length === next.entries.length &&
    previous.entries.every((entry, index) => {
      const other = next.entries[index];
      return (
        entry.kind === other.kind &&
        entry.id === other.id &&
        entry.updatedAt === other.updatedAt
      );
    }),
);
