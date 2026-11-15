export const FRAME_RUNTIME_ERROR = "showai:runtime-error";

export interface FrameRuntimeError {
  kind: "error" | "rejection";
  message: string;
  stack?: string;
}

export function installFrameErrorReporter(channel: string) {
  let sent = 0;
  const report = (
    kind: "error" | "rejection",
    error: unknown,
    fallback: string,
  ) => {
    const value = error as { message?: unknown; stack?: unknown } | null;
    const message = String(
      (value && typeof value === "object" && value.message) ||
        fallback ||
        error ||
        "",
    ).slice(0, 2000);
    if (!message || /^ResizeObserver loop/.test(message) || sent >= 20) return;
    sent++;
    parent.postMessage(
      {
        channel,
        type: "showai:runtime-error",
        kind,
        message,
        ...(value &&
        typeof value === "object" &&
        typeof value.stack === "string"
          ? { stack: value.stack.slice(0, 4000) }
          : {}),
      },
      "*",
    );
  };
  window.addEventListener(
    "error",
    (event) => report("error", event.error, event.message),
    true,
  );
  window.addEventListener(
    "unhandledrejection",
    (event) => report("rejection", event.reason, ""),
    true,
  );
}

export function readFrameRuntimeError(
  event: { source: unknown; data: unknown },
  frame: unknown,
  channel: string,
): FrameRuntimeError | null {
  if (!frame || event.source !== frame) return null;
  const data = event.data as Record<string, unknown> | null;
  if (
    !data ||
    typeof data !== "object" ||
    data.channel !== channel ||
    data.type !== FRAME_RUNTIME_ERROR ||
    (data.kind !== "error" && data.kind !== "rejection") ||
    typeof data.message !== "string" ||
    !data.message.trim()
  )
    return null;
  return {
    kind: data.kind,
    message: data.message.trim().slice(0, 2000),
    ...(typeof data.stack === "string" && data.stack
      ? { stack: data.stack.slice(0, 4000) }
      : {}),
  };
}

export function repeatsRuntimeError(
  message: string,
  error: FrameRuntimeError | null,
) {
  return !!error && message.includes(error.message);
}
