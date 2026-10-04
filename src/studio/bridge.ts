export interface DesktopBridge {
  invoke<T = unknown>(
    action: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  onChange(listener: () => void): () => void;
  onBeforeClose(listener: () => Promise<boolean>): () => void;
  setDirty?(dirty: boolean): void;
}

declare global {
  interface Window {
    showai?: DesktopBridge;
  }
}

export const desktop = {
  invoke<T = unknown>(
    action: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    if (!window.showai) throw new Error("Desktop integration is unavailable.");
    return window.showai.invoke<T>(action, args);
  },
  onChange(listener: () => void) {
    return window.showai?.onChange(listener) ?? (() => {});
  },
  onBeforeClose(listener: () => Promise<boolean>) {
    return window.showai?.onBeforeClose(listener) ?? (() => {});
  },
};

export function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}
export function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
