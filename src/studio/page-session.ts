import { coalescedTask } from "../lib/coalesced-task";
import type { JSONContent } from "@tiptap/core";
import type { PageRecord } from "../core/model";
import type { CompiledComponent } from "../components/custom/types";
import type { ShowDocument } from "../types";
import type { EditorDraftRecord } from "../core/editor-drafts";
import { errorCode, errorMessage } from "./bridge";

export interface LoadedPage extends PageRecord {
  components: CompiledComponent[];
  reuseComponents?: boolean;
  readOnly?: boolean;
  incomingCrossDevice?: boolean;
}
export type PageRefresh = LoadedPage | { unchanged: true; readOnly?: boolean };
export type SaveStatus =
  "saved" | "saving" | "changed" | "retained" | "conflict" | "error";
export interface PageSnapshot {
  draft: ShowDocument | null;
  renderVersion: number;
  record: LoadedPage | null;
  status: SaveStatus;
  error: string;
  draftNotice: string;
  conflictId?: string;
  mergeBase?: string;
  reviewingConflict: boolean;
  saveFailureAttempt: number;
  projectId: string | null;
  availableDrafts: EditorDraftRecord[];
  dirty: boolean;
  busy: boolean;
}
export interface PageSession {
  id: string;
  getSnapshot(): PageSnapshot;
  getMetadata(): PageSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeMetadata(listener: () => void): () => void;
  open(projectId: string, pageId: string): Promise<boolean>;
  edit(patch: Partial<ShowDocument>): void;
  editContent(content: JSONContent): void;
  flush(settle?: boolean): Promise<boolean>;
  leave(): Promise<boolean>;
  reload(): Promise<void>;
  reloadCurrent(): Promise<boolean>;
  refresh(componentsChanged?: boolean): Promise<void>;
  retainDraft(): Promise<void>;
  recoverDraft(id: string): Promise<void>;
  keepCopy(): Promise<LoadedPage | null>;
  retry(): Promise<boolean>;
  acceptResolution(): Promise<void>;
  prepareResolution(
    document: ShowDocument,
    revision: string,
    hash: string,
  ): void;
  prepareExternalResolution(document: ShowDocument, id: string): void;
  clear(): Promise<boolean>;
  isDirty(): boolean;
  isBusy(): boolean;
  isDurable(): boolean;
  dispose(): void;
}
export interface PageSessionOptions {
  clientId: string;
  invoke<T>(action: string, args?: Record<string, unknown>): Promise<T>;
  saveDelayMs?: number;
  draftDelayMs?: number;
}

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
const ref = <T>(current: T) => ({ current });

/** A page owns its drafts and save queue independently of the displayed tab. */
export function createPageSession(options: PageSessionOptions): PageSession {
  const listeners = new Set<() => void>();
  const metadataListeners = new Set<() => void>();
  let disposed = false;
  let notifying = false;
  let metadataChanged = false;
  let durableSequence = 0;
  let snapshot: PageSnapshot;
  let metadata: PageSnapshot;
  function setter<T>(read: () => T, write: (value: T) => void) {
    return (value: T | ((previous: T) => T)) => {
      write(
        typeof value === "function"
          ? (value as (before: T) => T)(read())
          : value,
      );
      publish();
    };
  }
  function readSnapshot(): PageSnapshot {
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
      projectId: projectRef.current,
      availableDrafts,
      dirty: revision.current > savedRevision.current,
      busy: !!pending.current || !!draftWrites.current.size,
    };
  }
  function publish() {
    if (disposed) return;
    snapshot = readSnapshot();
    if (
      !metadata ||
      snapshot.draft?.id !== metadata.draft?.id ||
      snapshot.draft?.title !== metadata.draft?.title ||
      snapshot.draft?.icon !== metadata.draft?.icon ||
      snapshot.record !== metadata.record ||
      snapshot.status !== metadata.status ||
      snapshot.error !== metadata.error ||
      snapshot.renderVersion !== metadata.renderVersion ||
      snapshot.draftNotice !== metadata.draftNotice ||
      snapshot.conflictId !== metadata.conflictId ||
      snapshot.mergeBase !== metadata.mergeBase ||
      snapshot.reviewingConflict !== metadata.reviewingConflict ||
      snapshot.saveFailureAttempt !== metadata.saveFailureAttempt ||
      snapshot.projectId !== metadata.projectId ||
      snapshot.dirty !== metadata.dirty ||
      snapshot.busy !== metadata.busy ||
      snapshot.availableDrafts !== metadata.availableDrafts
    ) {
      metadata = snapshot;
      metadataChanged = true;
    }
    if (notifying) return;
    notifying = true;
    queueMicrotask(() => {
      notifying = false;
      if (disposed) return;
      const notifyMetadata = metadataChanged;
      metadataChanged = false;
      for (const listener of listeners) listener();
      if (notifyMetadata) for (const listener of metadataListeners) listener();
    });
  }

  let draft: ShowDocument | null = null;
  const setDraft = setter<ShowDocument | null>(
    () => draft,
    (value) => {
      draft = value;
    },
  );
  let renderVersion: number = 0;
  const setRenderVersion = setter<number>(
    () => renderVersion,
    (value) => {
      renderVersion = value;
    },
  );
  const refreshingPage = ref(false);
  let record: LoadedPage | null = null;
  const setRecord = setter<LoadedPage | null>(
    () => record,
    (value) => {
      record = value;
    },
  );
  const recordRef = ref<LoadedPage | null>(null);
  let status: SaveStatus = "saved";
  const setStatus = setter<SaveStatus>(
    () => status,
    (value) => {
      status = value;
    },
  );
  let error: string = "";
  const setError = setter<string>(
    () => error,
    (value) => {
      error = value;
    },
  );
  let conflictId: string | undefined = undefined;
  const setConflictId = setter<string | undefined>(
    () => conflictId,
    (value) => {
      conflictId = value;
    },
  );
  let mergeBase: string | undefined = undefined;
  const setMergeBase = setter<string | undefined>(
    () => mergeBase,
    (value) => {
      mergeBase = value;
    },
  );
  let reviewingConflict: boolean = false;
  const setReviewingConflict = setter<boolean>(
    () => reviewingConflict,
    (value) => {
      reviewingConflict = value;
    },
  );
  let saveFailureAttempt: number = 0;
  const setSaveFailureAttempt = setter<number>(
    () => saveFailureAttempt,
    (value) => {
      saveFailureAttempt = value;
    },
  );
  const resolution = ref<{
    baseRevision?: string;
    currentRevision?: string;
    externalConflictId?: string;
  } | null>(null);
  const projectRef = ref<string | null>(null);
  const current = ref<ShowDocument | null>(null);
  const base = ref("");
  const baseRevision = ref<string | undefined>(undefined);
  const draftBase = ref<string | undefined>(undefined);
  const operations = ref(new Map<number, { id: string; groupId: string }>());
  const editGroup = ref({ id: crypto.randomUUID(), at: 0 });
  const revision = ref(0);
  const savedRevision = ref(0);
  const pending = ref<Promise<boolean> | null>(null);
  const blocked = ref(false);
  const opening = ref(0);
  const clientId = ref<string | undefined>(options.clientId);
  const retained = ref<EditorDraftRecord | null>(null);
  const recoveredFrom = ref<Pick<
    EditorDraftRecord,
    "id" | "generation"
  > | null>(null);
  let availableDrafts: EditorDraftRecord[] = [];
  const setAvailableDrafts = setter<EditorDraftRecord[]>(
    () => availableDrafts,
    (value) => {
      availableDrafts = value;
    },
  );
  let draftNotice: string = "";
  const setDraftNotice = setter<string>(
    () => draftNotice,
    (value) => {
      draftNotice = value;
    },
  );
  const draftWrites = ref(new Map<string, Promise<EditorDraftRecord>>());
  const autoSaveTimer = ref<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draftTimer = ref<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The draft store keeps one baseline per base revision and can otherwise
  // read it from the library, so the full base page is sent only once.
  const sentBaseline = ref<string | null>(null);
  const persist = async (
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
      const baseline = JSON.stringify([owner, source.id, draftBase.current]);
      const baseContent =
        sentBaseline.current !== baseline &&
        recordRef.current?.revision === draftBase.current
          ? recordRef.current?.document
          : undefined;
      const saved = await options.invoke<EditorDraftRecord>("drafts:save", {
        input: {
          kind: "page",
          clientId: clientId.current,
          resourceId: source.id,
          projectId: owner,
          baseRevision: draftBase.current,
          baseContent,
          title: source.title,
          content: source,
          sequence,
          recoverySource: recoveredFrom.current ?? undefined,
        },
      });
      if (baseContent) sentBaseline.current = baseline;
      if (
        projectRef.current === owner &&
        current.current?.id === source.id &&
        (retained.current?.sequence ?? -1) <= (saved.sequence ?? sequence)
      ) {
        retained.current = saved;
        durableSequence = Math.max(durableSequence, sequence);
      }
      return saved;
    })();
    draftWrites.current.set(key, task);
    publish();
    try {
      return await task;
    } finally {
      if (draftWrites.current.get(key) === task)
        draftWrites.current.delete(key);
      publish();
    }
  };

  const flush = async (settle = true): Promise<boolean> => {
    if (pending.current) {
      const succeeded = await pending.current;
      return succeeded && settle ? flush(true) : succeeded;
    }
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
            ? await options.invoke<LoadedPage>("history:resolve", {
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
              ? await options.invoke<LoadedPage>("history:mergeSave", {
                  projectId: projectRef.current,
                  pageId: source.id,
                  document: source,
                  ...resolution.current,
                  historyContext: {
                    operationId: operation.id,
                    message: "解决本机保存冲突",
                  },
                })
              : await options.invoke<LoadedPage>("pages:save", {
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
            await options.invoke("drafts:complete", {
              id: savedDraft.id,
              generation: savedDraft.generation,
              revision: saved.revision,
            });
            if (retained.current?.generation === savedDraft.generation)
              retained.current = null;
            if (recoveredFrom.current) {
              const original = recoveredFrom.current;
              await options.invoke("drafts:remove", {
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
          if (!settle) break;
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
    publish();
    try {
      return await promise;
    } finally {
      if (pending.current === promise) pending.current = null;
      publish();
      if (
        !disposed &&
        !blocked.current &&
        revision.current > savedRevision.current
      ) {
        setStatus(durableSequence >= revision.current ? "retained" : "changed");
        scheduleSave();
      }
    }
  };

  const install = (projectId: string, page: LoadedPage) => {
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
    durableSequence = 0;
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
  };

  const open = async (projectId: string, pageId: string) => {
    const ticket = ++opening.current;
    if (!(await flush())) return false;
    if (opening.current !== ticket) return false;
    const fetchedAtBase = base.current;
    const loaded = await options.invoke<LoadedPage>("pages:get", {
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
    const drafts = await options.invoke<EditorDraftRecord[]>("drafts:list", {
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
    const candidate = drafts.find((item) => item.clientId === clientId.current);
    setAvailableDrafts(drafts.filter((item) => item.id !== candidate?.id));
    if (candidate) {
      const restored = await options.invoke<{
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
        scheduleDraft();
        scheduleSave();
      }
    }
    return true;
  };

  // Reopening flushes edits before and after the read, and refuses to replace
  // unresolved drafts. Only the page's renderer needs a fresh mount.
  const reloadCurrent = async () => {
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
  };

  const edit = (patch: Partial<ShowDocument>) => {
    if (!current.current || recordRef.current?.readOnly) return;
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
    scheduleDraft();
    scheduleSave();
  };
  const editContent = (content: JSONContent) => edit({ content });
  const recoverDraft = async (id: string) => {
    if (!current.current || !projectRef.current) return;
    const ticket = opening.current,
      source = current.current,
      owner = projectRef.current;
    if (revision.current > savedRevision.current)
      await persist(source, revision.current, owner);
    const sequence = revision.current;
    const recovered = await options.invoke<{
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
    scheduleDraft();
    scheduleSave();
  };

  let verifyComponents = false;
  const refreshTask = coalescedTask(async () => {
    if (!projectRef.current || !current.current) return;
    if (pending.current) await pending.current;
    if (!projectRef.current || !current.current) return;
    const projectId = projectRef.current,
      pageId = current.current.id;
    const knownBase = base.current,
      ticket = opening.current;
    try {
      const full = verifyComponents;
      verifyComponents = false;
      const response = await options.invoke<PageRefresh>("pages:get", {
        projectId,
        pageId,
        ...(!full
          ? { ifHash: knownBase, ifRevision: baseRevision.current }
          : {}),
        knownComponents: recordRef.current?.components.map(
          ({ id, version, integrity, scope }) => ({
            id,
            version,
            integrity,
            scope,
          }),
        ),
      });
      if (
        projectRef.current !== projectId ||
        current.current?.id !== pageId ||
        opening.current !== ticket ||
        base.current !== knownBase
      )
        return;
      if ("unchanged" in response) {
        if (
          recordRef.current &&
          recordRef.current.readOnly !== response.readOnly
        ) {
          recordRef.current = {
            ...recordRef.current,
            readOnly: response.readOnly,
          };
          setRecord(recordRef.current);
        }
        return;
      }
      const loaded = response.reuseComponents
        ? { ...response, components: recordRef.current?.components ?? [] }
        : response;
      if (
        projectRef.current !== projectId ||
        current.current?.id !== pageId ||
        opening.current !== ticket ||
        base.current !== knownBase
      )
        return;
      if (
        loaded.hash === knownBase &&
        loaded.revision === baseRevision.current &&
        loaded.readOnly === recordRef.current?.readOnly &&
        !loaded.workspaceConflicts?.length
      ) {
        if (full && loaded.components !== recordRef.current?.components) {
          recordRef.current = loaded;
          setRecord(loaded);
        }
        return;
      }
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
        setError("文件已被其他工具修改。请选择保留本地草稿，或载入文件版本。");
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
  });

  const refresh = (componentsChanged = false) => {
    verifyComponents ||= componentsChanged;
    return refreshTask();
  };
  const reload = async () => {
    const ticket = ++opening.current;
    if (pending.current) await pending.current;
    if (!projectRef.current || !current.current) return;
    const projectId = projectRef.current,
      pageId = current.current.id,
      sequence = revision.current;
    const loaded = await options.invoke<LoadedPage>("pages:get", {
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
  };

  const keepCopy = async () => {
    const ticket = ++opening.current;
    if (pending.current) await pending.current;
    if (!projectRef.current || !current.current) return null;
    const projectId = projectRef.current,
      pageId = current.current.id,
      sequence = revision.current;
    const sourceDraft = await persist(current.current, sequence, projectId),
      sourceOrigin = recoveredFrom.current;
    const copied = await options.invoke<LoadedPage>("pages:create", {
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
      await options.invoke("drafts:remove", {
        id: sourceDraft.id,
        generation: sourceDraft.generation,
      });
      if (sourceOrigin)
        await options.invoke("drafts:remove", {
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
  };

  const retry = async () => {
    blocked.current = false;
    setError("");
    const saved = await flush();
    if (saved) setStatus("saved");
    return saved;
  };

  const prepareResolution = (
    document: ShowDocument,
    currentRevision: string,
    currentHash: string,
  ) => {
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
    scheduleDraft();
  };

  const prepareExternalResolution = (document: ShowDocument, id: string) => {
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
  };

  // A reviewed merge or external resolution supersedes this draft. Archive its
  // exact generation; another window's newer draft must remain recoverable.
  const acceptResolution = async () => {
    const saved = retained.current;
    if (saved)
      await options.invoke("drafts:remove", {
        id: saved.id,
        generation: saved.generation,
      });
    if (recoveredFrom.current) {
      const original = recoveredFrom.current;
      await options.invoke("drafts:remove", {
        id: original.id,
        generation: original.generation,
      });
    }
    await reload();
  };

  const retainDraft = async () => {
    if (current.current && projectRef.current)
      await persist(current.current, revision.current, projectRef.current);
  };

  const clear = async () => {
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
  };

  let saveStartedAt = 0;
  function scheduleSave() {
    if (
      disposed ||
      blocked.current ||
      revision.current <= savedRevision.current
    )
      return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    saveStartedAt ||= Date.now();
    const delay = Math.max(
      0,
      Math.min(options.saveDelayMs ?? 700, 2000 - (Date.now() - saveStartedAt)),
    );
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = undefined;
      saveStartedAt = 0;
      void flush(false);
    }, delay);
  }
  function scheduleDraft() {
    if (
      disposed ||
      draftTimer.current ||
      revision.current <= savedRevision.current
    )
      return;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = undefined;
      void retainDraft()
        .then(() => {
          if (
            !blocked.current &&
            !pending.current &&
            revision.current > savedRevision.current
          )
            setStatus(
              durableSequence >= revision.current ? "retained" : "changed",
            );
        })
        .catch((reason) => {
          setError(`本机草稿保存失败：${errorMessage(reason)}`);
          setStatus("error");
          blocked.current = true;
        });
    }, options.draftDelayMs ?? 200);
  }
  const leave = async (): Promise<boolean> => {
    try {
      while (
        current.current &&
        projectRef.current &&
        durableSequence < revision.current
      )
        await persist(
          structuredClone(current.current),
          revision.current,
          projectRef.current,
        );
      if (!blocked.current && revision.current > savedRevision.current)
        void flush(false);
      return true;
    } catch (reason) {
      setError(`本机草稿保存失败：${errorMessage(reason)}`);
      setStatus("error");
      blocked.current = true;
      return false;
    }
  };
  const api: PageSession = {
    id: crypto.randomUUID(),
    getSnapshot: () => snapshot,
    getMetadata: () => metadata,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeMetadata(listener) {
      metadataListeners.add(listener);
      return () => {
        metadataListeners.delete(listener);
      };
    },
    open,
    edit,
    editContent,
    flush,
    leave,
    reload,
    reloadCurrent,
    refresh,
    retainDraft,
    recoverDraft,
    keepCopy,
    retry,
    acceptResolution,
    prepareResolution,
    prepareExternalResolution,
    clear,
    isDirty: () => revision.current > savedRevision.current,
    isBusy: () => !!pending.current || !!draftWrites.current.size,
    isDurable: () =>
      durableSequence >= revision.current ||
      revision.current <= savedRevision.current,
    dispose() {
      disposed = true;
      clearTimeout(autoSaveTimer.current);
      clearTimeout(draftTimer.current);
      listeners.clear();
      metadataListeners.clear();
    },
  };
  snapshot = readSnapshot();
  metadata = snapshot;
  return api;
}
