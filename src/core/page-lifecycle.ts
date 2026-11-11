import { instantiateTemplate } from "./catalog";
import { deletedEntries, type DeletedEntries } from "./deleted-entries";
import type { PageRecord, ShowDocument } from "./model";
import type { FileStore } from "./store";
import { translator } from "../i18n";
import commonMessages from "../i18n/messages/common";
import workbenchMessages from "../i18n/messages/workbench";

const t = translator(workbenchMessages);
const tc = translator(commonMessages);

/**
 * Delete (archive), restore or pin a page. Deleting only archives, so the page
 * stays listed under deleted items until it is restored. Without a base the
 * change applies to the current version.
 */
export async function updatePageState(
  store: FileStore,
  projectId: string,
  pageId: string,
  fields: { archived?: boolean; pinned?: boolean },
  base: { baseHash?: string; baseRevision?: string } = {},
): Promise<PageRecord> {
  const current = base.baseHash
    ? undefined
    : await store.readPage(projectId, pageId);
  return store.updatePageMetadata(
    projectId,
    pageId,
    {
      ...(fields.archived !== undefined ? { archived: fields.archived } : {}),
      ...(fields.pinned !== undefined ? { favorite: fields.pinned } : {}),
    },
    base.baseHash ?? current!.hash,
    base.baseHash ? base.baseRevision : current!.revision,
  );
}

/**
 * The document for a copy of a page: new block ids, not archived, in the same
 * folder while that folder still exists. The caller creates the page.
 */
export async function duplicatePageDocument(
  store: FileStore,
  projectId: string,
  pageId: string,
  title?: string,
): Promise<ShowDocument> {
  const original = await store.readPage(projectId, pageId);
  const parentId = (await store.listFolders(projectId)).some(
    (folder) => folder.id === original.document.parentId,
  )
    ? original.document.parentId
    : null;
  return {
    ...instantiateTemplate({
      ...original.document,
      title:
        title ??
        t("pageCopyTitle", {
          title: original.document.title || tc("untitledPage"),
        }),
      archived: false,
    }),
    parentId,
  };
}

/**
 * Deleted projects, folders and pages that can be restored, limited to the
 * given projects when a connection is bound to them.
 */
export async function listDeletedEntries(
  store: FileStore,
  projectIds?: string[],
): Promise<DeletedEntries> {
  const projects = (await store.listProjects({ includeArchived: true })).filter(
    (project) => !projectIds || projectIds.includes(project.id),
  );
  return deletedEntries(
    await Promise.all(
      projects.map(async (project) => ({
        project,
        ...(project.archived
          ? { folders: [], pages: [] }
          : {
              folders: await store.listFolders(project.id, {
                includeArchived: true,
              }),
              pages: await store.listPages(project.id),
            }),
      })),
    ),
  );
}
