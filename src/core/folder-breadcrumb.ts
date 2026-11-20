import type { FolderMetadata } from "./model";

export function folderBreadcrumb(folders: FolderMetadata[], folderId?: string | null) {
  const ancestors: FolderMetadata[] = [];
  const seen = new Set<string>();
  let folder = folders.find(item => item.id === folderId);
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id);
    ancestors.push(folder);
    const parent = folder.parentId;
    folder = folders.find(item => item.id === parent);
  }
  return ancestors.reverse();
}
