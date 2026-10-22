import type { CSSProperties } from "react";
import PageThumbnail from "./PageThumbnail";

export interface FolderThumbnailEntry {
  kind: "folder" | "page";
  id: string;
  updatedAt: string;
  /** Entries directly inside a subfolder; its pockets are drawn blank. */
  count?: number;
}

/** Pockets drawn in one folder; later entries stay behind the front cover. */
const POCKETS = 3;

/**
 * An expanding (accordion) folder whose pockets hold the first entries as
 * their own thumbnails. Subfolders appear as smaller folders with blank
 * sheets so a directory card never loads more than three pages.
 */
export default function FolderThumbnail({
  projectId,
  entries,
  count,
  nested = false,
}: {
  projectId: string;
  entries: FolderThumbnailEntry[];
  count: number;
  nested?: boolean;
}) {
  const sheets: (FolderThumbnailEntry | null)[] = nested
    ? Array.from({ length: Math.min(POCKETS, count) }, () => null)
    : entries.slice(0, POCKETS);
  return (
    <span
      className="studio-folder-thumbnail"
      data-nested={nested || undefined}
      aria-hidden="true"
      inert
    >
      <span className="studio-folder-back" />
      <span className="studio-folder-gusset" data-side="left" />
      <span className="studio-folder-gusset" data-side="right" />
      {sheets.map((entry, index) => (
        <span
          key={entry?.id ?? index}
          className="studio-folder-sheet"
          data-pocket={index}
          style={{ "--pocket": index } as CSSProperties}
        >
          {entry?.kind === "page" ? (
            <PageThumbnail
              projectId={projectId}
              pageId={entry.id}
              updatedAt={entry.updatedAt}
            />
          ) : entry?.kind === "folder" ? (
            <FolderThumbnail
              projectId={projectId}
              entries={[]}
              count={entry.count ?? 0}
              nested
            />
          ) : null}
        </span>
      ))}
      <span className="studio-folder-divider" />
      <span className="studio-folder-front">
        {!nested && count > 0 && (
          <span className="studio-folder-count">{count}</span>
        )}
      </span>
    </span>
  );
}
