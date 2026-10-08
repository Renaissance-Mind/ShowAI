import { coalescedTask } from "../lib/coalesced-task";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { PageRecord } from "../core/model";
import type { CompiledComponent } from "../components/custom/types";
import type { ShowDocument } from "../types";
import { desktop, errorCode, errorMessage } from "./bridge";
import type { EditorDraftRecord } from "../core/editor-drafts";

export interface LoadedPage extends PageRecord {
  components: CompiledComponent[];
  reuseComponents?: boolean;
  readOnly?: boolean;
  incomingCrossDevice?: boolean;
}
export type SaveStatus = "saved" | "saving" | "changed" | "conflict" | "error";

function pageContentKey(document: ShowDocument): string {
  const { createdAt: _created, updatedAt: _updated, ...content } = document;
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : value;
  return JSON.stringify(normalize(content));
}

/** Serializes auto-saves and keeps external edits from silently replacing a draft. */
export function usePage() {
  const [draft, setDraft] = useState<ShowDocument | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const refreshingPage = useRef(false);
  const [record, setRecord] = useState<LoadedPage | null>(null);
  const recordRef = useRef<LoadedPage | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState("");
  const [conflictId, setConflictId] = useState<string | undefined>();
  const [mergeBase, setMergeBase] = useState<string | undefined>();
  const [reviewingConflict, setReviewingConflict] = useState(false);
  const [saveFailureAttempt, setSaveFailureAttempt] = useState(0);
  const resolution = useRef<{
    baseRevision?: string;
    currentRevision?: string;
    externalConflictId?: string;
  } | null>(null);
  const projectRef = useRef<string | null>(null);
  const current = useRef<ShowDocument | null>(null);
  const base = useRef("");
  const baseRevision = useRef<string | undefined>(undefined);
  const draftBase = useRef<string | undefined>(undefined);
  const operations = useRef(new Map<number, { id: string; groupId: string }>());
  const editGroup = useRef({ id: crypto.randomUUID(), at: 0 });
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false);
  const opening = useRef(0);
  const clientId = useRef<string | undefined>(undefined);
  if (!clientId.current) {
    clientId.current =
      sessionStorage.getItem("showai:editor-client") ?? crypto.randomUUID();
    sessionStorage.setItem("showai:editor-client", clientId.current);
  }
  const retained = useRef<EditorDraftRecord | null>(null);
  const recoveredFrom = useRef<Pick<
    EditorDraftRecord,
    "id" | "generation"
  > | null>(null);
  const [availableDrafts, setAvailableDrafts] = useState<EditorDraftRecord[]>(
    [],
  );
  const [draftNotice, setDraftNotice] = useState("");
  const draftWrites = useRef(new Map<string, Promise<EditorDraftRecord>>());
  const persist = useCallback(
    async (
      source: ShowDocument,
      sequence: number,
      owner: string,
    ): Promise<EditorDraftRecord> => {
      const key = JSON.stringify([
        owner,
        source.id,
        sequence,
        draftBase.current,
        recoveredFrom.current,
      ]);
      const pending = draftWrites.current.get(key);
      if (pending) return pending;
      const task = (async () => {
        const saved = await desktop.invoke<EditorDraftRecord>("drafts:save", {
          input: {
            kind: "page",
            clientId: clientId.current,
            resourceId: source.id,
            projectId: owner,
            baseRevision: draftBase.current,
            title: source.title,
            content: source,
            sequence,
            recoverySource: recoveredFrom.current ?? undefined,
          },
        });
        if (
          projectRef.current === owner &&
          current.current?.id === source.id &&
          (retained.current?.sequence ?? -1) <= (saved.sequence ?? sequence)
        )
          retained.current = saved;
        return saved;
      })();
      draftWrites.current.set(key, task);
      try {
        return await task;
      } finally {
        if (draftWrites.current.get(key) === task)
          draftWrites.current.delete(key);
      }
    },
    [],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (pending.current) return pending.current;
    if (!current.current || !projectRef.current || blocked.current)
      return !blocked.current;
    const run = async () => {
      while (
        revision.current > savedRevision.current &&
        current.current &&
        projectRef.current
      ) {
        const editingSource = current.current;
        const source = structuredClone(editingSource);
        const sequence = revision.current;
        const operation = operations.current.get(sequence) ?? {
          id: crypto.randomUUID(),
          groupId: editGroup.current.id,
        };
        operations.current.set(sequence, operation);
        setStatus("saving");
        try {
          const existingDraft = retained.current;
          const savedDraft =
            existingDraft?.sequence === sequence &&
            existingDraft.projectId === projectRef.current &&
            existingDraft.resourceId === source.id &&
            existingDraft.baseRevision === draftBase.current
              ? existingDraft
              : await persist(source, sequence, projectRef.current);
          const response = resolution.current?.externalConflictId
            ? await desktop.invoke<LoadedPage>("history:resolve", {
                projectId: projectRef.current,
                id: resolution.current.externalConflictId,
                resolution: "merge",
                document: source,
                historyContext: {
                  operationId: operation.id,
                  message: "解决本机保存冲突",
                },
              })
            : resolution.current
              ? await desktop.invoke<LoadedPage>("history:mergeSave", {
                  projectId: projectRef.current,
                  pageId: source.id,
                  document: source,
                  ...resolution.current,
                  historyContext: {
                    operationId: operation.id,
                    message: "解决本机保存冲突",
                  },
                })
              : await desktop.invoke<LoadedPage>("pages:save", {
                  projectId: projectRef.current,
                  pageId: source.id,
                  document: source,
                  baseHash: base.current,
                  baseRevision: baseRevision.current,
                  knownComponents: recordRef.current?.components.map(
                    ({ id, version, integrity, scope }) => ({
                      id,
                      version,
                      integrity,
                      scope,
                    }),
                  ),
                  historyContext: {
                    operationId: operation.id,
                    groupId: operation.groupId,
                    message: "编辑页面",
                  },
                });
          const saved = {
            ...response,
            components: response.reuseComponents
              ? (recordRef.current?.components ?? [])
              : response.components,
          };
          recordRef.current = saved;
          base.current = saved.hash;
          baseRevision.current = saved.revision;
          draftBase.current = saved.revision;
          setMergeBase(saved.revision);
          operations.current.delete(sequence);
          savedRevision.current = sequence;
          setRecord(saved);
          if (revision.current === sequence) {
            const keys = (value: ShowDocument) =>
              JSON.stringify([value.content, value.layout, value.surfaceViews]);
            const installed =
              keys(source) === keys(saved.document)
                ? {
                    ...saved.document,
                    content: editingSource.content,
                    layout: editingSource.layout,
                    surfaceViews: editingSource.surfaceViews,
                  }
                : saved.document;
            current.current = installed;
            setDraft(installed);
          }
          if (saved.workspaceConflicts?.length) {
            setConflictId(saved.workspaceConflicts[0].id);
            blocked.current = true;
            setStatus("conflict");
            setError(
              "正式修改已保存，但外部文件也有修改，外部版本已保留。请处理冲突。",
            );
            return false;
          }
          if (saved.revision && savedDraft.sequence === sequence) {
            await desktop.invoke("drafts:complete", {
              id: savedDraft.id,
              generation: savedDraft.generation,
              revision: saved.revision,
            });
            if (retained.current?.generation === savedDraft.generation)
              retained.current = null;
            if (recoveredFrom.current) {
              const original = recoveredFrom.current;
              await desktop.invoke("drafts:remove", {
                id: original.id,
                generation: original.generation,
              });
              recoveredFrom.current = null;
            }
          }
          setStatus("saved");
          resolution.current = null;
          setReviewingConflict(false);
          setError("");
          setConflictId(undefined);
          setDraftNotice("");
        } catch (reason) {
          setReviewingConflict(false);
          setSaveFailureAttempt((value) => value + 1);
          if (reason && typeof reason === "object" && "conflictId" in reason)
            setConflictId(String(reason.conflictId));
          blocked.current = true;
          setStatus(errorCode(reason) === "CONFLICT" ? "conflict" : "error");
          setError(errorMessage(reason));
          return false;
        }
      }
      return true;
    };
    const promise = run();
    pending.current = promise;
    try {
      return await promise;
    } finally {
      if (pending.current === promise) pending.current = null;
    }
  }, [persist]);

  const install = useCallback((projectId: string, page: LoadedPage) => {
    setSaveFailureAttempt(0);
    resolution.current = null;
    setReviewingConflict(false);
    projectRef.current = projectId;
    current.current = page.document;
    base.current = page.hash;
    baseRevision.current = page.revision;
    draftBase.current = page.revision;
    setMergeBase(page.revision);
    setConflictId(page.workspaceConflicts?.[0]?.id);
    operations.current.clear();
    editGroup.current = { id: crypto.randomUUID(), at: 0 };
    revision.current = 0;
    savedRevision.current = 0;
    blocked.current = false;
    setDraft(page.document);
    setRecord(page);
    recordRef.current = page;
    retained.current = null;
    recoveredFrom.current = null;
    setAvailableDrafts([]);
    setDraftNotice("");
    setStatus(page.workspaceConflicts?.length ? "conflict" : "saved");
    setError(
      page.workspaceConflicts?.length
        ? "外部文件有未处理修改，外部版本已保留。"
        : "",
    );
    blocked.current = !!page.workspaceConflicts?.length;
  }, []);

  const open = useCallback(
    async (projectId: string, pageId: string) => {
      const ticket = ++opening.current;
      if (!(await flush())) return false;
      if (opening.current !== ticket) return false;
      const fetchedAtBase = base.current;
      const loaded = await desktop.invoke<LoadedPage>("pages:get", {
        projectId,
        pageId,
      });
      if (opening.current !== ticket) return false;
      // The editor remains usable during disk I/O. Save keystrokes entered after
      // the first flush before replacing its draft with the newly loaded page.
      if (!(await flush()) || opening.current !== ticket) return false;
      if (
        projectRef.current === projectId &&
        current.current?.id === pageId &&
        base.current !== fetchedAtBase
      )
        return true;
      install(projectId, loaded);
      const drafts = await desktop.invoke<EditorDraftRecord[]>("drafts:list", {
        kind: "page",
        projectId,
        resourceId: pageId,
      });
      if (
        opening.current !== ticket ||
        projectRef.current !== projectId ||
        current.current?.id !== pageId
      )
        return true;
      const candidate = drafts.find(
        (item) => item.clientId === clientId.current,
      );
      setAvailableDrafts(drafts.filter((item) => item.id !== candidate?.id));
      if (candidate) {
        const restored = await desktop.invoke<{
          record: EditorDraftRecord;
          content: ShowDocument;
        }>("drafts:read", { id: candidate.id });
        if (opening.current !== ticket || revision.current !== 0) return true;
        const recoveredSequence = restored.record.sequence ?? 0;
        revision.current = recoveredSequence;
        savedRevision.current = recoveredSequence;
        if (
          pageContentKey(restored.content) !== pageContentKey(loaded.document)
        ) {
          current.current = restored.content;
          setDraft(restored.content);
          revision.current = recoveredSequence + 1;
          retained.current = restored.record;
          recoveredFrom.current = restored.record.recoverySource ?? null;
          setMergeBase(restored.record.baseRevision);
          draftBase.current = restored.record.baseRevision;
          const conflict =
            !!loaded.workspaceConflicts?.length ||
            (!!loaded.revision && !restored.record.baseRevision) ||
            (!!restored.record.baseRevision &&
              restored.record.baseRevision !== loaded.revision);
          blocked.current = conflict;
          setStatus(conflict ? "conflict" : "changed");
          setError(
            conflict
              ? !restored.record.baseRevision && loaded.revision
                ? "这份旧库草稿缺少可靠的基础版本，已保留在本机。可以保留为副本，或载入正式版本。"
                : "已恢复本机草稿，正式版本也有新修改。请比较并处理。"
              : "",
          );
          setDraftNotice("已恢复本机未提交的草稿");
        }
      }
      return true;
    },
    [flush, install],
  );

  // Reopening flushes edits before and after the read, and refuses to replace
  // unresolved drafts. Only the page's renderer needs a fresh mount.
  const reloadCurrent = useCallback(async () => {
    if (!projectRef.current || !current.current || refreshingPage.current)
      return false;
    const projectId = projectRef.current,
      pageId = current.current.id;
    refreshingPage.current = true;
    try {
      if (
        !(await open(projectId, pageId)) ||
        projectRef.current !== projectId ||
        current.current?.id !== pageId
      )
        return false;
      setRenderVersion((version) => version + 1);
      return true;
    } finally {
      refreshingPage.current = false;
    }
  }, [open]);

  const edit = useCallback((patch: Partial<ShowDocument>) => {
    if (!current.current) return;
    const next = {
      ...current.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    current.current = next;
    const now = Date.now();
    if (now - editGroup.current.at > 2000)
      editGroup.current.id = crypto.randomUUID();
    editGroup.current.at = now;
    revision.current++;
    setDraft(next);
    if (!blocked.current) setStatus("changed");
  }, []);
  const editContent = useCallback(
    (content: JSONContent) => edit({ content }),
    [edit],
  );
  const recoverDraft = useCallback(
    async (id: string) => {
      if (!current.current || !projectRef.current) return;
      const ticket = opening.current,
        source = current.current,
        owner = projectRef.current;
      if (revision.current > savedRevision.current)
        await persist(source, revision.current, owner);
      const sequence = revision.current;
      const recovered = await desktop.invoke<{
        record: EditorDraftRecord;
        content: ShowDocument;
      }>("drafts:read", { id });
      if (
        opening.current !== ticket ||
        revision.current !== sequence ||
        current.current?.id !== source.id
      ) {
        setError("读取草稿期间又有新的编辑，当前编辑已保留。请再次选择草稿。");
        return;
      }
      if (
        recovered.record.projectId !== owner ||
        recovered.record.resourceId !== source.id
      )
        throw new Error("草稿不属于当前页面。");
      current.current = recovered.content;
      setDraft(recovered.content);
      recoveredFrom.current = recovered.record;
      revision.current++;
      const conflict =
        !!conflictId ||
        !!record?.workspaceConflicts?.length ||
        (!!baseRevision.current && !recovered.record.baseRevision) ||
        (!!recovered.record.baseRevision &&
          recovered.record.baseRevision !== baseRevision.current);
      setMergeBase(recovered.record.baseRevision);
      draftBase.current = recovered.record.baseRevision;
      blocked.current = conflict;
      setStatus(conflict ? "conflict" : "changed");
      setError(
        conflict
          ? !recovered.record.baseRevision && baseRevision.current
            ? "这份旧库草稿缺少可靠的基础版本，已保留在本机。可以保留为副本，或载入正式版本。"
            : "已恢复本机草稿，正式版本也有新修改。请比较并处理。"
          : "",
      );
      setDraftNotice("已恢复选中的本机草稿");
      setAvailableDrafts((items) => items.filter((item) => item.id !== id));
    },
    [persist, record, conflictId],
  );

  useEffect(() => {
    if (status !== "changed") return;
    const timer = setTimeout(() => void flush(), 450);
    return () => clearTimeout(timer);
  }, [draft, status, flush]);

  useEffect(() => {
    if (
      !draft ||
      !projectRef.current ||
      revision.current <= savedRevision.current
    )
      return;
    const owner = projectRef.current,
      sequence = revision.current;
    const timer = setTimeout(() => {
      const source = structuredClone(draft);
      void persist(source, sequence, owner).catch((reason) => {
        if (projectRef.current !== owner || current.current?.id !== source.id)
          return;
        setError(`本机草稿保存失败：${errorMessage(reason)}`);
        setStatus("error");
        blocked.current = true;
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [draft, persist]);

  const refresh = useMemo(
    () =>
      coalescedTask(async () => {
        if (!projectRef.current || !current.current) return;
        if (pending.current) await pending.current;
        if (!projectRef.current || !current.current) return;
        const projectId = projectRef.current,
          pageId = current.current.id;
        const knownBase = base.current,
          ticket = opening.current;
        try {
          const loaded = await desktop.invoke<LoadedPage>("pages:get", {
            projectId,
            pageId,
          });
          if (
            projectRef.current !== projectId ||
            current.current?.id !== pageId ||
            opening.current !== ticket ||
            base.current !== knownBase ||
            (loaded.hash === knownBase &&
              loaded.revision === baseRevision.current &&
              loaded.readOnly === recordRef.current?.readOnly &&
              !loaded.workspaceConflicts?.length)
          )
            return;
          if (
            revision.current > savedRevision.current ||
            loaded.workspaceConflicts?.length
          ) {
            if (
              loaded.incomingCrossDevice &&
              !loaded.workspaceConflicts?.length &&
              !blocked.current
            ) {
              await flush();
              return;
            }
            setConflictId(loaded.workspaceConflicts?.[0]?.id);
            blocked.current = true;
            setStatus("conflict");
            setError(
              "文件已被其他工具修改。请选择保留本地草稿，或载入文件版本。",
            );
          } else install(projectId, loaded);
        } catch (reason) {
          if (
            projectRef.current !== projectId ||
            current.current?.id !== pageId ||
            opening.current !== ticket ||
            base.current !== knownBase
          )
            return;
          setError(errorMessage(reason));
          setStatus("error");
        }
      }),
    [install, flush],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = desktop.onChange((change) => {
      if (
        change.type !== "home" &&
        !change.all &&
        !(
          change.allPages &&
          change.projectIds?.includes(projectRef.current ?? "")
        ) &&
        change.pageIds &&
        !change.pageIds.includes(current.current?.id ?? "")
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 300);
    });
    const focused = () => {
      void refresh();
    };
    window.addEventListener("focus", focused);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("focus", focused);
    };
  }, [refresh]);

  const reload = useCallback(async () => {
    const ticket = ++opening.current;
    if (pending.current) await pending.current;
    if (!projectRef.current || !current.current) return;
    const projectId = projectRef.current,
      pageId = current.current.id,
      sequence = revision.current;
    const loaded = await desktop.invoke<LoadedPage>("pages:get", {
      projectId,
      pageId,
    });
    if (
      ticket !== opening.current ||
      projectRef.current !== projectId ||
      current.current?.id !== pageId
    )
      return;
    if (revision.current !== sequence) {
      blocked.current = true;
      setStatus("conflict");
      setError("读取文件期间又有新的编辑，草稿已保留。请再次选择如何处理。");
      return;
    }
    install(projectId, loaded);
  }, [install]);

  const keepCopy = useCallback(async () => {
    const ticket = ++opening.current;
    if (pending.current) await pending.current;
    if (!projectRef.current || !current.current) return null;
    const projectId = projectRef.current,
      pageId = current.current.id,
      sequence = revision.current;
    const sourceDraft = await persist(current.current, sequence, projectId),
      sourceOrigin = recoveredFrom.current;
    const copied = await desktop.invoke<LoadedPage>("pages:create", {
      projectId,
      document: {
        ...current.current,
        title: `${current.current.title || "无标题"} 副本`,
      },
    });
    if (
      ticket !== opening.current ||
      projectRef.current !== projectId ||
      current.current?.id !== pageId
    )
      return null;
    const latest = current.current,
      changedDuringCopy = revision.current !== sequence;
    if (!changedDuringCopy) {
      await desktop.invoke("drafts:remove", {
        id: sourceDraft.id,
        generation: sourceDraft.generation,
      });
      if (sourceOrigin)
        await desktop.invoke("drafts:remove", {
          id: sourceOrigin.id,
          generation: sourceOrigin.generation,
        });
    }
    install(projectId, copied);
    if (changedDuringCopy) {
      recoveredFrom.current = sourceDraft;
      edit({
        ...latest,
        id: copied.document.id,
        title: `${latest.title || "无标题"} 副本`,
        createdAt: copied.document.createdAt,
      });
    }
    return copied;
  }, [install, edit, persist]);

  const retry = useCallback(async () => {
    blocked.current = false;
    setError("");
    const saved = await flush();
    if (saved) setStatus("saved");
    return saved;
  }, [flush]);

  const prepareResolution = useCallback(
    (document: ShowDocument, currentRevision: string, currentHash: string) => {
      if (!mergeBase || !current.current || current.current.id !== document.id)
        throw new Error("保存冲突的基础版本已失效，请重新查看。 ");
      resolution.current = { baseRevision: mergeBase, currentRevision };
      base.current = currentHash;
      baseRevision.current = currentRevision;
      current.current = structuredClone(document);
      revision.current++;
      blocked.current = true;
      setDraft(current.current);
      setStatus("conflict");
      setError("保存失败：请修改当前合并草稿，然后重新保存，或放弃修改。");
      setReviewingConflict(true);
      setRenderVersion((value) => value + 1);
    },
    [mergeBase],
  );

  const prepareExternalResolution = useCallback(
    (document: ShowDocument, id: string) => {
      if (!current.current || current.current.id !== document.id)
        throw new Error("冲突不属于当前页面。");
      resolution.current = { externalConflictId: id };
      current.current = structuredClone(document);
      revision.current++;
      blocked.current = true;
      setDraft(current.current);
      setStatus("conflict");
      setError("保存失败：请修改当前合并草稿，然后重新保存，或放弃修改。");
      setReviewingConflict(true);
      setRenderVersion((value) => value + 1);
    },
    [],
  );

  // A reviewed merge or external resolution supersedes this draft. Archive its
  // exact generation; another window's newer draft must remain recoverable.
  const acceptResolution = useCallback(async () => {
    const saved = retained.current;
    if (saved)
      await desktop.invoke("drafts:remove", {
        id: saved.id,
        generation: saved.generation,
      });
    if (recoveredFrom.current) {
      const original = recoveredFrom.current;
      await desktop.invoke("drafts:remove", {
        id: original.id,
        generation: original.generation,
      });
    }
    await reload();
  }, [reload]);

  const retainDraft = useCallback(async () => {
    if (current.current && projectRef.current)
      await persist(current.current, revision.current, projectRef.current);
  }, [persist]);

  const clear = useCallback(async () => {
    const ticket = ++opening.current;
    if (!(await flush())) return false;
    if (opening.current !== ticket) return false;
    current.current = null;
    projectRef.current = null;
    base.current = "";
    baseRevision.current = undefined;
    draftBase.current = undefined;
    operations.current.clear();
    revision.current = 0;
    savedRevision.current = 0;
    setDraft(null);
    setRecord(null);
    setError("");
    setStatus("saved");
    return true;
  }, [flush]);

  useEffect(() => desktop.onBeforeClose(flush), [flush]);
  useEffect(() => {
    window.showai?.setDirty?.(!!draft && status !== "saved");
  }, [draft, status]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void (resolution.current ? retry() : flush());
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [flush, retry]);

  return {
    draft,
    renderVersion,
    record,
    status,
    error,
    draftNotice,
    conflictId,
    mergeBase,
    reviewingConflict,
    saveFailureAttempt,
    prepareResolution,
    prepareExternalResolution,
    projectId: projectRef.current,
    open,
    edit,
    editContent,
    flush,
    reload,
    reloadCurrent,
    acceptResolution,
    retainDraft,
    availableDrafts,
    recoverDraft,
    keepCopy,
    retry,
    refresh,
    clear,
  };
}
