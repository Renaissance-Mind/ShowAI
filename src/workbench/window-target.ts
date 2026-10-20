export interface WindowTarget {
  projectId?: string;
  pageId?: string;
  folderId?: string;
  /** Comma-separated content IDs to highlight once the page opens. */
  blocks?: string;
  invite?: string;
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
  return target?.invite ? { invite: target.invite } : {};
}
