import {
  Check,
  FilePlus2,
  FileText,
  Folder,
  LayoutTemplate,
  MoreHorizontal,
  Pin,
  Plus,
  Sparkles,
} from "../../ui/icons";
import { getLocale } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import navigationMessages from "../../i18n/messages/navigation";
import studioMessages from "../../i18n/messages/studio";
import PageIcon from "../../components/PageIcon";
import type { LibraryMenuPoint } from "../LibraryNavigation";
import PageThumbnail from "../PageThumbnail";
import FolderThumbnail from "../FolderThumbnail";
import { clientIsMac, isDeleteShortcut } from "../keyboard-shortcuts";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { MenuState } from "./menus/useMenuState";
import type { DirectoryState } from "./useDirectory";
import type { StudioRouter } from "./useStudioRouter";
import type { PageActions } from "./usePageActions";
import type { LibraryEdits } from "./useLibraryEdits";
import type { LibraryMoves } from "./useLibraryMoves";

function shortDate(value: string) {
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

/** The open project or folder: its pages and folders as a list or as cards. */
export function DirectoryView({
  feedback: { action },
  library: { projectTarget, folderTarget },
  route: { selectedFolder, deferredQuery },
  menus: { showMenu, directoryView },
  directory: {
    project,
    currentFolder,
    visibleEntries,
    folderThumbnailEntries,
    pageSelection,
  },
  router: { openTargetClick },
  pageActions: { createPage, createPageForAgent, beginNewPage },
  edits: { libraryKeyCommand },
  moves: { libraryDrag, beginBatchPages },
  contentCreationDisabled,
}: {
  feedback: StudioFeedback;
  library: LibraryState;
  route: RouteState;
  menus: MenuState;
  directory: DirectoryState;
  router: StudioRouter;
  pageActions: PageActions;
  edits: LibraryEdits;
  moves: LibraryMoves;
  contentCreationDisabled: boolean;
}) {
  const t = useTranslator(studioMessages);
  const tn = useTranslator(navigationMessages);
  function showDirectoryCreationMenu(
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
  ) {
    if (!project || (selectedFolder && !currentFolder)) return;
    showMenu(
      currentFolder
        ? folderTarget(currentFolder, project.id)
        : projectTarget(project),
      anchor,
      point,
      false,
      true,
    );
  }
  return (
    <>
      {visibleEntries.length || !deferredQuery ? (
        <div
          className="studio-page-list"
          data-view={directoryView}
          data-selecting={pageSelection.active || undefined}
        >
          {visibleEntries.map(({ target, updatedAt, hash }) => (
            <div
              key={target.id}
              {...(!pageSelection.active
                ? libraryDrag.bindings.row(target, false)
                : {})}
              data-library-id={target.id}
              data-selectable
              className={`studio-page-list-row${pageSelection.ids.includes(target.id) ? " selected" : ""}`}
              onContextMenu={(event) => {
                event.preventDefault();
                const anchor =
                  event.currentTarget.querySelector<HTMLElement>(
                    ".studio-row-menu",
                  );
                if (anchor)
                  showMenu(
                    target,
                    anchor,
                    { x: event.clientX, y: event.clientY },
                    false,
                    false,
                    pageSelection.ids.includes(target.id),
                  );
              }}
              onKeyDown={(event) => {
                const deleting = isDeleteShortcut(event, clientIsMac());
                if (deleting && pageSelection.ids.length) {
                  event.preventDefault();
                  event.stopPropagation();
                  beginBatchPages("delete");
                  return;
                }
                if (event.key === "F2" || deleting) {
                  event.preventDefault();
                  libraryKeyCommand(
                    target,
                    event.key === "F2" ? "rename" : "delete",
                  );
                  return;
                }
                if (
                  event.key !== "ContextMenu" &&
                  !(event.shiftKey && event.key === "F10")
                )
                  return;
                event.preventDefault();
                const anchor =
                  event.currentTarget.querySelector<HTMLElement>(
                    ".studio-row-menu",
                  );
                if (anchor) showMenu(target, anchor);
              }}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={pageSelection.ids.includes(target.id)}
                aria-label={t("selectPage", { title: target.title })}
                className="studio-page-checkbox"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) =>
                  pageSelection.toggle(target.id, event.shiftKey)
                }
              >
                <Check size={12} strokeWidth={3} />
              </button>
              {directoryView !== "list" &&
                (target.kind === "page" ? (
                  <PageThumbnail
                    projectId={target.projectId}
                    pageId={target.id}
                    updatedAt={updatedAt}
                    hash={hash}
                  />
                ) : (
                  <FolderThumbnail
                    projectId={target.projectId}
                    entries={folderThumbnailEntries(target.id)}
                  />
                ))}
              <button
                className="studio-page-list-open"
                data-open-page={target.kind === "page" ? target.id : undefined}
                data-open-project={
                  target.kind === "page" ? target.projectId : undefined
                }
                onClick={(event) => {
                  if (pageSelection.active)
                    pageSelection.toggle(target.id, event.shiftKey);
                  else openTargetClick(target, event);
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) openTargetClick(target, event);
                }}
              >
                {directoryView !== "list" && (
                  <span className="studio-thumbnail-space" />
                )}
                <span className="studio-page-list-icon">
                  {target.kind === "folder" ? (
                    <PageIcon
                      value={target.icon}
                      size={19}
                      fallback={<Folder size={19} />}
                    />
                  ) : (
                    <PageIcon
                      value={target.kind === "page" ? target.icon : ""}
                      size={19}
                    />
                  )}
                </span>
                <strong>{target.title}</strong>
                {target.pinned && <Pin size={12} aria-label={t("pinned")} />}
                <time>{shortDate(updatedAt)}</time>
              </button>
              <button
                className="studio-icon studio-row-menu"
                aria-label={t("itemActions", {
                  title: target.title,
                })}
                aria-haspopup="menu"
                onClick={(event) => showMenu(target, event.currentTarget)}
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
          ))}
          {!deferredQuery && !pageSelection.active && (
            <div className="studio-page-list-row studio-page-list-add">
              <button
                type="button"
                className="studio-page-list-open"
                aria-label={t("addContentHint")}
                aria-haspopup="menu"
                title={t("addContentHint")}
                disabled={contentCreationDisabled}
                onClick={(event) =>
                  showDirectoryCreationMenu(
                    event.currentTarget,
                    event.detail
                      ? { x: event.clientX, y: event.clientY }
                      : undefined,
                  )
                }
              >
                <Plus
                  size={directoryView === "list" ? 18 : 28}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </button>
            </div>
          )}
        </div>
      ) : null}
      {!visibleEntries.length && (
        <div className="studio-empty">
          <FilePlus2 size={30} strokeWidth={1.2} />
          <h2>
            {deferredQuery
              ? t("noMatchingContent")
              : currentFolder
                ? t("folderEmpty")
                : t("projectEmpty")}
          </h2>
          {!deferredQuery && <p>{t("emptyHint")}</p>}
          {!deferredQuery && project && (
            <div
              className="studio-empty-actions"
              role="group"
              aria-label={tn("emptyActions")}
            >
              <button
                type="button"
                className="studio-button"
                disabled={contentCreationDisabled}
                onClick={action(() =>
                  createPage(
                    "blank",
                    undefined,
                    "page",
                    {
                      projectId: project.id,
                      parentId: selectedFolder,
                    },
                    true,
                  ),
                )}
              >
                <FileText size={15} aria-hidden="true" />
                {tn("newPage")}
              </button>
              <button
                type="button"
                className="studio-button primary"
                disabled={contentCreationDisabled}
                onClick={action(() =>
                  createPageForAgent({
                    projectId: project.id,
                    parentId: selectedFolder,
                  }),
                )}
              >
                <Sparkles size={15} aria-hidden="true" />
                {tn("newPageForAgent")}
              </button>
              <button
                type="button"
                className="studio-button"
                disabled={contentCreationDisabled}
                onClick={action(() => beginNewPage(project.id, selectedFolder))}
              >
                <LayoutTemplate size={15} aria-hidden="true" />
                {tn("newFromTemplate")}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
