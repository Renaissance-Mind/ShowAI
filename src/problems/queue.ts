import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeError,
  type ProblemActionId,
  type ProblemContext,
  type ProblemDescription,
} from "./describe";
import type { ToastItem, ToastKind } from "./ProblemNotice";
import { recordProblem } from "./problem-log";

export interface ReportOptions extends ProblemContext {
  key?: string;
  retry?: () => void;
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

export function useProblemQueue() {
  const [problems, setProblems] = useState<QueuedProblem[]>([]);
  const next = useRef(0);
  const report = useCallback((error: unknown, options: ReportOptions = {}) => {
    const {
      key: explicit,
      retry,
      handlers,
      ...context
    } = {
      ...attachedOptions(error),
      ...options,
    };
    const problem = describeError(error, context);
    recordProblem({
      at: problem.at,
      source: problem.source,
      code: problem.code,
      message: [problem.action, problem.message].filter(Boolean).join(": "),
    });
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
  action?: ToastItem["action"];
  details?: string;
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
        const kept = current.filter((item) => item.message !== message);
        for (const item of current)
          if (!kept.includes(item)) {
            clearTimeout(timers.current.get(item.id));
            timers.current.delete(item.id);
          }
        return [
          ...kept,
          {
            id,
            message,
            kind,
            action: options.action,
            details: options.details,
          },
        ].slice(-MAX_TOASTS);
      });
      const duration =
        options.duration ?? (kind === "warning" ? undefined : DEFAULT_DURATION);
      if (duration !== undefined)
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      return id;
    },
    [dismiss],
  );
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
