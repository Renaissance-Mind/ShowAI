import { validateDocument } from "./artifact";
import type { ShowDocument, Workspace } from "../types";

export const MAX_WORKSPACE_DOCUMENTS = 1000;

export function hasWorkspaceCapacity(existing: number, added: number): boolean {
  return existing + added <= MAX_WORKSPACE_DOCUMENTS;
}

export type HistoryStore = Record<
  string,
  { document: ShowDocument; savedAt: string }[]
>;

export function validateHistory(input: unknown): HistoryStore {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("历史记录格式不正确");
  return Object.fromEntries(
    Object.entries(input).map(([id, snapshots]) => {
      if (!Array.isArray(snapshots) || snapshots.length > 15)
        throw new Error("历史记录版本数量不正确");
      return [
        id,
        snapshots.map((snapshot) => {
          if (
            !snapshot ||
            typeof snapshot !== "object" ||
            typeof snapshot.savedAt !== "string" ||
            !Number.isFinite(Date.parse(snapshot.savedAt))
          )
            throw new Error("历史记录缺少有效时间");
          const document = validateDocument(snapshot.document);
          if (document.id !== id) throw new Error("历史记录的页面 ID 不匹配");
          return { document, savedAt: snapshot.savedAt };
        }),
      ];
    }),
  );
}

/** Reject ambiguous IDs and cycles before a document tree reaches the UI. */
export function validateDocumentTree(input: unknown): ShowDocument[] {
  if (
    !Array.isArray(input) ||
    !input.length ||
    !hasWorkspaceCapacity(0, input.length)
  )
    throw new Error("工作区需要包含 1–1000 个页面");
  const documents = input.map(validateDocument);
  const index = new Map(documents.map((doc) => [doc.id, doc]));
  if (index.size !== documents.length)
    throw new Error("工作区包含重复的页面 ID");
  for (const doc of documents) {
    const seen = new Set([doc.id]);
    let parent = doc.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error("页面层级包含循环引用");
      seen.add(parent);
      const entry = index.get(parent);
      if (!entry) throw new Error("页面的父页面不存在");
      parent = entry.parentId;
    }
  }
  return documents;
}

export function validateWorkspace(input: unknown): Workspace {
  if (!input || typeof input !== "object") throw new Error("工作区格式不正确");
  const value = input as Workspace;
  if (value.version !== 1) throw new Error("不支持的工作区版本");
  const documents = validateDocumentTree(value.documents);
  const activeId =
    documents.find((doc) => doc.id === value.activeId && !doc.archived)?.id ??
    documents.find((doc) => !doc.archived)?.id;
  if (!activeId) throw new Error("工作区中没有可打开的页面");
  return {
    version: 1,
    documents,
    activeId,
    theme: ["light", "dark", "system"].includes(value.theme)
      ? value.theme
      : "light",
    font: ["sans", "serif", "mono"].includes(value.font) ? value.font : "sans",
    wide: value.wide === true,
  };
}

export function importDocumentTree(input: unknown): ShowDocument[] {
  const documents = validateDocumentTree(input);
  const ids = new Map(documents.map((doc) => [doc.id, crypto.randomUUID()]));
  return documents.map((doc) => ({
    ...doc,
    id: ids.get(doc.id)!,
    parentId: doc.parentId ? ids.get(doc.parentId)! : null,
    archived: false,
  }));
}

export function descendantIds(documents: ShowDocument[], id: string): string[] {
  const seen = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(
      ...documents.filter((doc) => doc.parentId === next).map((doc) => doc.id),
    );
  }
  return [...seen];
}
