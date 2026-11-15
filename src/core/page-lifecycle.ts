import { instantiateTemplate } from "./catalog";
import { deletedEntries, type DeletedEntries } from "./deleted-entries";
import type { PageRecord, ShowDocument } from "./model";
import type { FileStore } from "./store";
import { translator } from "../i18n";
import commonMessages from "../i18n/messages/common";
import workbenchMessages from "../i18n/messages/workbench";

const t = translator(workbenchMessages);
const tc = translator(commonMessages);

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
