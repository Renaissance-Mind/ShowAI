export interface WindowTarget {
  projectId?: string;
  pageId?: string;
  folderId?: string;
  invite?: string;
}

export function windowQuery(target?: WindowTarget): Record<string, string> {
  if (target?.projectId) {
    return {
      project: target.projectId,
      ...(target.pageId ? { page: target.pageId } : {}),
      ...(target.folderId ? { folder: target.folderId } : {}),
    };
  }
  return target?.invite ? { invite: target.invite } : {};
}
