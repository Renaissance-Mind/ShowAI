export interface DesktopError {
  code: string;
  message: string;
  currentHash?: string;
}

export interface DesktopInfo {
  home: string;
  version: string;
  platform: string;
  packaged: boolean;
  mode?: "desktop" | "browser";
  cli: { command: string; args: string[]; env: Record<string, string> };
}

export interface DesktopChange {
  type: "files" | "home";
  home: string;
}

export interface ShowAIBridge {
  invoke<T = unknown>(
    action: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  onChange(listener: (change: DesktopChange) => void): () => void;
  onBeforeClose(listener: () => Promise<boolean>): () => void;
}

export type DesktopResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: DesktopError };
