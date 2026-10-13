import { mergeValues } from "./catalog-merge";
import type { FolderMetadata } from "./model";

/** Folder ids, rather than array positions, identify independently edited directories. */
export function mergeFolders(
  base: FolderMetadata[],
  ours: FolderMetadata[],
  theirs: FolderMetadata[],
): { folders: FolderMetadata[]; conflict: boolean } {
  const before = new Map(base.map((folder) => [folder.id, folder]));
  const local = new Map(ours.map((folder) => [folder.id, folder]));
  const remote = new Map(theirs.map((folder) => [folder.id, folder]));
  const folders: FolderMetadata[] = [];
  let conflict = false;
  for (const id of new Set([
    ...before.keys(),
    ...local.keys(),
    ...remote.keys(),
  ])) {
    const original = before.get(id);
    let one = local.get(id),
      two = remote.get(id);
    if (original && one && two) {
      const updatedAt = [one.updatedAt, two.updatedAt].sort().at(-1)!;
      one = { ...one, updatedAt };
      two = { ...two, updatedAt };
    }
    const merged = mergeValues(original, one, two, `/folders/${id}`);
    conflict ||= merged.conflicts.length > 0;
    if (merged.value !== undefined)
      folders.push(merged.value as FolderMetadata);
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    const visited = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent || visited.has(parentId) || visited.size >= 64) {
        conflict = true;
        break;
      }
      visited.add(parentId);
      parentId = parent.parentId;
    }
  }
  return { folders, conflict };
}
