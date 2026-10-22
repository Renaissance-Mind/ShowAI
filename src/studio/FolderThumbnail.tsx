import { Folder } from "../ui/icons";
import PageThumbnail from "./PageThumbnail";

export interface FolderThumbnailEntry {
  kind: "folder" | "page";
  id: string;
  updatedAt: string;
}

/**
 * A folder card: a soft folder shape holding its first entries as small
 * portrait sheets, as many as fit side by side (at most four). Subfolders
 * appear as folder sheets so a card never loads more than four pages.
 */
export default function FolderThumbnail({
  projectId,
  entries,
}: {
  projectId: string;
  entries: FolderThumbnailEntry[];
}) {
  return (
    <span className="studio-folder-thumbnail" aria-hidden="true" inert>
      <span className="studio-folder-body">
        {entries.length ? (
          entries.slice(0, 4).map((entry) => (
            <span
              key={entry.id}
              className="studio-folder-item"
              data-kind={entry.kind}
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
    </span>
  );
}
