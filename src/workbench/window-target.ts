export interface WindowTarget {
  projectId?: string;
  pageId?: string;
  folderId?: string;
  /** Comma-separated content IDs to highlight once the page opens. */
  blocks?: string;
  invite?: string;
  /** The App's first window brings back the tabs of the previous session. */
  restoreTabs?: boolean;
}

export function windowQuery(target?: WindowTarget): Record<string, string> {
  if (target?.projectId) {
    return {
      project: target.projectId,
      ...(target.pageId ? { page: target.pageId } : {}),
      ...(target.pageId && target.blocks ? { blocks: target.blocks } : {}),
      ...(target.folderId ? { folder: target.folderId } : {}),
    };
  }
  if (target?.invite) return { invite: target.invite };
  return target?.restoreTabs ? { restore: "tabs" } : {};
}
