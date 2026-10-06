import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { PageRecord } from "../core/model";
import type { CompiledComponent } from "../components/custom/types";
import type { ShowDocument } from "../types";
import { desktop, errorCode, errorMessage } from "./bridge";

export interface LoadedPage extends PageRecord {
  components: CompiledComponent[];
}
export type SaveStatus = "saved" | "saving" | "changed" | "conflict" | "error";

/** Serializes auto-saves and keeps external edits from silently replacing a draft. */
export function usePage() {
  const [draft, setDraft] = useState<ShowDocument | null>(null);
  const [record, setRecord] = useState<LoadedPage | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState("");
  const projectRef = useRef<string | null>(null);
  const current = useRef<ShowDocument | null>(null);
  const base = useRef("");
  const baseRevision = useRef<string | undefined>(undefined);
  const operations = useRef(new Map<number, { id: string; groupId: string }>());
  const editGroup = useRef({ id: crypto.randomUUID(), at: 0 });
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false);
  const opening = useRef(0);

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
        const source = structuredClone(current.current);
        const sequence = revision.current;
        const operation = operations.current.get(sequence) ?? {
          id: crypto.randomUUID(),
          groupId: editGroup.current.id,
        };
        operations.current.set(sequence, operation);
        setStatus("saving");
        try {
          const saved = await desktop.invoke<LoadedPage>("pages:save", {
            projectId: projectRef.current,
            pageId: source.id,
            document: source,
            baseHash: base.current,
            baseRevision: baseRevision.current,
            historyContext: {
              operationId: operation.id,
              groupId: operation.groupId,
              message: "编辑页面",
            },
          });
          base.current = saved.hash;
          baseRevision.current = saved.revision;
          operations.current.delete(sequence);
          savedRevision.current = sequence;
          setRecord(saved);
          if (revision.current === sequence) {
            current.current = saved.document;
            setDraft(saved.document);
          }
          setStatus("saved");
          setError("");
        } catch (reason) {
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
  }, []);

  const install = useCallback((projectId: string, page: LoadedPage) => {
    projectRef.current = projectId;
    current.current = page.document;
    base.current = page.hash;
    baseRevision.current = page.revision;
    operations.current.clear();
    editGroup.current = { id: crypto.randomUUID(), at: 0 };
    revision.current = 0;
    savedRevision.current = 0;
    blocked.current = false;
    setDraft(page.document);
    setRecord(page);
    setStatus("saved");
    setError("");
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
      return true;
    },
    [flush, install],
  );

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

  useEffect(() => {
    if (status !== "changed") return;
    const timer = setTimeout(() => void flush(), 450);
    return () => clearTimeout(timer);
  }, [draft, status, flush]);

  const refresh = useCallback(async () => {
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
        loaded.hash === knownBase
      )
        return;
      if (revision.current > savedRevision.current) {
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
  }, [install]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = desktop.onChange(() => {
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
    install(projectId, copied);
    if (changedDuringCopy)
      edit({
        ...latest,
        id: copied.document.id,
        title: `${latest.title || "无标题"} 副本`,
        createdAt: copied.document.createdAt,
      });
    return copied;
  }, [install, edit]);

  const retry = useCallback(async () => {
    blocked.current = false;
    setError("");
    return flush();
  }, [flush]);

  const clear = useCallback(async () => {
    const ticket = ++opening.current;
    if (!(await flush())) return false;
    if (opening.current !== ticket) return false;
    current.current = null;
    projectRef.current = null;
    base.current = "";
    baseRevision.current = undefined;
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
        void flush();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [flush]);

  return {
    draft,
    record,
    status,
    error,
    projectId: projectRef.current,
    open,
    edit,
    editContent,
    flush,
    reload,
    keepCopy,
    retry,
    refresh,
    clear,
  };
}
