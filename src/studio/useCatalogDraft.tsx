import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorDraftRecord } from "../core/editor-drafts";
import { desktop, errorMessage } from "./bridge";

/** Forms are stored verbatim so unfinished JSON and source remain editable. */
export function useCatalogDraft<T>({
  kind,
  projectId,
  resourceId,
  title,
  content,
  onRestore,
  enabled = true,
}: {
  kind: "component" | "template";
  projectId?: string;
  resourceId: string;
  title: string;
  content: T;
  onRestore: (content: T) => void;
  enabled?: boolean;
}) {
  const [candidates, setCandidates] = useState<EditorDraftRecord[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const initial = useRef(JSON.stringify(content));
  const current = useRef(content);
  current.current = content;
  const restore = useRef(onRestore);
  restore.current = onRestore;
  const identity = useRef<string | undefined>(undefined);
  if (!identity.current) {
    const windowId =
      sessionStorage.getItem("showai:editor-client") ?? crypto.randomUUID();
    sessionStorage.setItem("showai:editor-client", windowId);
    // Reopening a form gets a separate draft, preserving previously offered candidates.
    identity.current = `${windowId}:${crypto.randomUUID()}`;
  }
  const sequence = useRef(0),
    saved = useRef<EditorDraftRecord | undefined>(undefined);
  const pending = useRef<Promise<EditorDraftRecord | undefined>>(
    Promise.resolve(undefined),
  );
  const active = useRef(true);
  const recovered = useRef<EditorDraftRecord | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    if (enabled && projectId)
      void desktop
        .invoke<EditorDraftRecord[]>("drafts:list", {
          kind,
          projectId,
          resourceId,
        })
        .then(
          (items) => {
            if (!active.current) return;
            setCandidates(items);
            const own = items.find(
              (item) => item.clientId === identity.current,
            );
            sequence.current = Math.max(sequence.current, own?.sequence ?? 0);
          },
          (reason) => {
            if (active.current) setError(errorMessage(reason));
          },
        );
    return () => {
      active.current = false;
    };
  }, [enabled, kind, projectId, resourceId]);
  const persist = useCallback(
    async (force = false) => {
      if (
        !enabled ||
        !projectId ||
        (!force && JSON.stringify(current.current) === initial.current)
      )
        return pending.current;
      const payload = structuredClone(current.current),
        tick = ++sequence.current;
      const operation = pending.current.then(() =>
        desktop.invoke<EditorDraftRecord>("drafts:save", {
          input: {
            kind,
            projectId,
            resourceId,
            title,
            clientId: identity.current,
            sequence: tick,
            content: payload,
          },
        }),
      );
      // Keep the queue usable after a reported I/O failure. The caller sees the error.
      pending.current = operation.catch(() => undefined);
      const record = await operation;
      saved.current = record;
      if (active.current) {
        setNotice("未提交修改已保存在本机草稿中");
        setError("");
      }
      return record;
    },
    [enabled, kind, projectId, resourceId, title],
  );
  const key = JSON.stringify(content);
  useEffect(() => {
    if (key === initial.current) return;
    const timer = setTimeout(
      () =>
        void persist().catch((reason) => {
          if (active.current) setError(errorMessage(reason));
        }),
      180,
    );
    return () => clearTimeout(timer);
  }, [key, persist]);
  useEffect(
    () =>
      desktop.onBeforeClose(async () => {
        try {
          await persist();
          return true;
        } catch (reason) {
          setError(errorMessage(reason));
          return false;
        }
      }),
    [persist],
  );
  async function recover(record: EditorDraftRecord) {
    try {
      // Preserve current edits before applying a separately retained form.
      await persist();
      const restored = await desktop.invoke<{ content: T }>("drafts:read", {
        id: record.id,
      });
      restore.current(restored.content);
      recovered.current = record;
      setCandidates([]);
      setNotice("已恢复本机草稿，检查后可保存为新版本");
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  async function complete(
    submitted: EditorDraftRecord | undefined,
    submittedContent: T,
  ) {
    await pending.current;
    if (JSON.stringify(current.current) !== JSON.stringify(submittedContent)) {
      await persist(true);
      return;
    }
    const latest = saved.current ?? submitted;
    if (latest)
      await desktop.invoke("drafts:remove", {
        id: latest.id,
        generation: latest.generation,
      });
    if (recovered.current)
      await desktop.invoke("drafts:remove", {
        id: recovered.current.id,
        generation: recovered.current.generation,
      });
    initial.current = JSON.stringify(current.current);
    saved.current = undefined;
    setNotice("");
  }
  async function close(onClose: () => void) {
    try {
      await persist();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  return { candidates, notice, error, persist, recover, complete, close };
}

export function CatalogDraftRecovery({
  draft,
}: {
  draft: Pick<
    ReturnType<typeof useCatalogDraft>,
    "error" | "notice" | "candidates" | "recover"
  >;
}) {
  return (
    <>
      {draft.error && (
        <p className="studio-form-error" role="alert">
          本机草稿保存失败：{draft.error}
        </p>
      )}
      {draft.notice && (
        <p className="catalog-draft-notice" role="status">
          {draft.notice}
        </p>
      )}
      {!!draft.candidates.length && (
        <section className="catalog-draft-recovery" aria-label="可恢复草稿">
          <p>有未提交的本机草稿，可选择恢复后继续编辑。</p>
          {draft.candidates.map((item) => (
            <button
              key={item.id}
              className="studio-button small"
              onClick={() => void draft.recover(item)}
            >
              恢复草稿 · {new Date(item.savedAt).toLocaleString("zh-CN")} ·{" "}
              {item.title || "未命名"}
            </button>
          ))}
        </section>
      )}
    </>
  );
}
