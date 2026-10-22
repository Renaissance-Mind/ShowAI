import type {
  DirectoryPreferences,
  DirectorySortBy,
  FolderMetadata,
  PageSummary,
} from "./model";

/** Labels are translated by the workbench from each option's value. */
export const directorySortOptions = [
  { value: "name" },
  { value: "createdAt" },
  { value: "updatedAt" },
] as const;

export function isDirectorySortBy(value: unknown): value is DirectorySortBy {
  return ["name", "createdAt", "updatedAt", "manual"].includes(value as string);
}

export interface DirectoryEntry {
  kind: "folder" | "page";
  id: string;
  name: string;
  parentId: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  hash?: string;
}

export function directoryEntries(
  folders: FolderMetadata[],
  pages: PageSummary[],
): DirectoryEntry[] {
  return [
    ...folders.map((folder) => ({ ...folder, kind: "folder" as const })),
    ...pages.map((page) => ({
      ...page,
      kind: "page" as const,
      name: page.title || "无标题",
      pinned: page.favorite,
    })),
  ];
}

const names = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

/** Folders and pages share one order; pins always lead and ties remain deterministic. */
export function sortDirectoryItems<
  T extends Omit<DirectoryEntry, "kind" | "parentId">,
>(
  items: T[],
  preferences: DirectoryPreferences = {},
  legacyOrder: string[] = [],
): T[] {
  const sortBy = preferences.sortBy ?? "updatedAt";
  const ranks = new Map(
    (preferences.manualOrder ?? legacyOrder).map((id, index) => [id, index]),
  );
  return [...items].sort((a, b) => {
    const pinned = Number(b.pinned) - Number(a.pinned);
    if (pinned) return pinned;
    if (sortBy === "manual") {
      const rank =
        (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity);
      if (rank) return rank;
    } else if (sortBy !== "name") {
      const date = Date.parse(b[sortBy]) - Date.parse(a[sortBy]);
      if (date) return date;
    }
    return names.compare(a.name, b.name) || a.id.localeCompare(b.id, "en");
  });
}
