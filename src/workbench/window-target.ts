export interface WindowTarget {
  projectId?: string;
  pageId?: string;
  folderId?: string;
  blocks?: string;
  invite?: string;
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
