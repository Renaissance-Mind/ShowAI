import { directoryItemComparator } from "../core/directory-sort";
import type { FolderMetadata, PageSummary } from "../core/model";

type CoverPage = PageSummary & { name: string; pinned: boolean };

export interface FolderPreview {
  count: number;
  sheets: number;
  cover?: CoverPage;
}

export function indexFolderPreviews(
  folders: FolderMetadata[],
  pages: PageSummary[],
  legacyOrder?: string[],
  frontPages?: ReadonlyMap<string, string>,
): ReadonlyMap<string, FolderPreview> {
  const previews = new Map<string, FolderPreview>();
  const pending = new Map<string, number>();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const direct = new Set<string>();
  const comparators = new Map<
    string,
    ReturnType<typeof directoryItemComparator>
  >();
  const ranks =
    legacyOrder && new Map(legacyOrder.map((id, index) => [id, index]));
  for (const folder of folders) {
    previews.set(folder.id, { count: 0, sheets: 0 });
    if (folder.parentId)
      pending.set(folder.parentId, (pending.get(folder.parentId) ?? 0) + 1);
  }
  for (const page of pages) {
    if (!page.parentId) continue;
    const preview = previews.get(page.parentId);
    if (!preview) continue;
    preview.count++;
    preview.sheets = Math.min(3, preview.sheets + 1);
    const next = { ...page, name: page.title, pinned: page.favorite };
    let compare = comparators.get(page.parentId);
    if (!compare) {
      compare = directoryItemComparator(byId.get(page.parentId), ranks);
      comparators.set(page.parentId, compare);
    }
    const frontId = frontPages?.get(page.parentId);
    if (
      !preview.cover ||
      next.id === frontId ||
      (preview.cover.id !== frontId && compare(next, preview.cover) < 0)
    ) {
      preview.cover = next;
    }
    direct.add(page.parentId);
  }
  const ready = folders.filter((folder) => !pending.has(folder.id));
  const newest = directoryItemComparator();
  for (const folder of folders)
    previews.get(folder.id)!.count += pending.get(folder.id) ?? 0;
  for (const folder of ready) {
    const parent = folder.parentId && previews.get(folder.parentId);
    if (!parent || !folder.parentId) continue;
    const child = previews.get(folder.id)!;
    parent.sheets = Math.min(3, parent.sheets + child.sheets);
    if (
      !direct.has(folder.parentId) &&
      child.cover &&
      (!parent.cover || newest(child.cover, parent.cover) < 0)
    ) {
      parent.cover = child.cover;
    }
    const remaining = pending.get(folder.parentId)! - 1;
    pending.set(folder.parentId, remaining);
    if (!remaining) ready.push(byId.get(folder.parentId)!);
  }
  return previews;
}
