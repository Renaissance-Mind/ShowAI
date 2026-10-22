import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeError,
  type ProblemActionId,
  type ProblemContext,
  type ProblemDescription,
} from "./describe";
import type { ToastItem, ToastKind } from "./ProblemNotice";

export interface ReportOptions extends ProblemContext {
  /**
   * Groups problems of one operation so a later success clears them with
   * `resolve(key)`. Defaults to `action`.
   */
  key?: string;
  /** Offered as 重试 when the description suggests retrying. */
  retry?: () => void;
  /** Handlers for other suggested actions, e.g. chooseLocation. */
  handlers?: Partial<Record<ProblemActionId, () => void>>;
}

export interface QueuedProblem {
  id: number;
  key: string;
  problem: ProblemDescription;
  count: number;
  retry?: () => void;
  handlers?: Partial<Record<ProblemActionId, () => void>>;
}

const GENERAL = "general";
const CONTEXT = Symbol.for("showai.problemContext");

/**
 * Attaches the operation to an error where it is thrown, so a generic
 * `.catch(report)` further up still titles it (e.g. 读取内容库失败).
 * Options passed to `report` itself take precedence.
 */
export function labelProblem<T>(error: T, options: ReportOptions): T | Error {
  const target =
    error && typeof error === "object" ? error : new Error(String(error));
  Object.defineProperty(target, CONTEXT, {
    value: options,
    configurable: true,
  });
  return target;
}

function attachedOptions(error: unknown): ReportOptions {
  return error && typeof error === "object" && CONTEXT in error
    ? ((error as Record<symbol, ReportOptions>)[CONTEXT] ?? {})
    : {};
}

/**
 * Problems of different operations stack; the same problem again only
 * raises its count. `resolve(key)` clears an operation once it succeeds.
 */
export function useProblemQueue() {
  const [problems, setProblems] = useState<QueuedProblem[]>([]);
  const next = useRef(0);
  const report = useCallback((error: unknown, options: ReportOptions = {}) => {
    const { key: explicit, retry, handlers, ...context } = {
      ...attachedOptions(error),
      ...options,
    };
    const problem = describeError(error, context);
    const key = explicit ?? context.action ?? GENERAL;
    setProblems((current) => {
      const same = current.find(
        (item) =>
          item.key === key &&
          item.problem.code === problem.code &&
          item.problem.message === problem.message,
      );
      const entry: QueuedProblem = same
        ? { ...same, problem, count: same.count + 1, retry, handlers }
        : { id: ++next.current, key, problem, count: 1, retry, handlers };
      // Newest first; equal-priority notices keep this order in a NoticeStack.
      return [entry, ...current.filter((item) => item !== same)].slice(0, 20);
    });
  }, []);
  const resolve = useCallback((key: string) => {
    setProblems((current) =>
      current.some((item) => item.key === key)
        ? current.filter((item) => item.key !== key)
        : current,
    );
  }, []);
  const dismiss = useCallback((id: number) => {
    setProblems((current) => current.filter((item) => item.id !== id));
  }, []);
  const clear = useCallback(() => setProblems([]), []);
  return { problems, report, resolve, dismiss, clear };
}

export interface ToastOptions {
  kind?: ToastKind;
  /** A single follow-up such as 撤销 or 查看. */
  action?: ToastItem["action"];
  /** Milliseconds; success and info default to 5 s, warnings stay. */
  duration?: number;
}

const DEFAULT_DURATION = 5000;
const MAX_TOASTS = 3;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);
  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const kind = options.kind ?? "success";
      const id = ++next.current;
      setToasts((current) => {
        // The same text again replaces the older toast instead of stacking.
        const kept = current.filter((item) => item.message !== message);
        for (const item of current)
          if (!kept.includes(item)) {
            clearTimeout(timers.current.get(item.id));
            timers.current.delete(item.id);
          }
        return [...kept, { id, message, kind, action: options.action }].slice(
          -MAX_TOASTS,
        );
      });
      const duration =
        options.duration ?? (kind === "warning" ? undefined : DEFAULT_DURATION);
      if (duration !== undefined)
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );
  /** Clears transient toasts; warnings stay unless `all` is set. */
  const clear = useCallback((all = false) => {
    setToasts((current) => {
      const kept = all ? [] : current.filter((item) => item.kind === "warning");
      for (const item of current)
        if (!kept.includes(item)) {
          clearTimeout(timers.current.get(item.id));
          timers.current.delete(item.id);
        }
      return kept;
    });
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);
  return { toasts, show, dismiss, clear };
}
