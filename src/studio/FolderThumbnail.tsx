import { memo } from "react";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import type { FolderPreview } from "./folder-previews";
import PageThumbnail from "./PageThumbnail";

export default memo(function FolderThumbnail({
  projectId,
  preview,
}: {
  projectId: string;
  preview?: FolderPreview;
}) {
  const t = useTranslator(commonMessages);
  const cover = preview?.cover;
  return (
    <span className="studio-folder-thumbnail" aria-hidden="true" inert>
      <span className="studio-folder-back" />
      {(preview?.sheets ?? 0) >= 3 && (
        <span className="studio-folder-sheet" data-position="2" />
      )}
      {(preview?.sheets ?? 0) >= 2 && (
        <span className="studio-folder-sheet" data-position="1" />
      )}
      <span
        className="studio-folder-sheet"
        data-position="0"
        data-cover-page={cover?.id}
      >
        {cover && (
          <>
            <span className="studio-folder-sheet-title">
              {cover.title || t("untitled")}
            </span>
            <PageThumbnail
              key={cover.id}
              projectId={projectId}
              pageId={cover.id}
              updatedAt={cover.updatedAt}
              hash={cover.hash}
              padding={5}
            />
          </>
        )}
      </span>
      <span className="studio-folder-flap" />
    </span>
  );
});
