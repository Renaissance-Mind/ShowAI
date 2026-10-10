import type { TabCommand } from "../workbench/tab-shortcuts";
export const PROJECT_SCOPE_LIMIT = 1000;

export interface DesktopError {
  code: string;
  message: string;
  currentHash?: string;
  currentRevision?: string;
  conflictId?: string;
}

export interface DesktopInfo {
  home: string;
  version: string;
  platform: string;
  packaged: boolean;
  mode?: "desktop" | "browser";
  libraryVersion?: 1 | 2;
  cli: { command: string; args: string[]; env: Record<string, string> };
}

export interface DesktopChange {
  type: "files" | "home";
  home: string;
  projectIds?: string[];
  pageIds?: string[];
  catalog?: boolean;
  projects?: boolean;
  sidebar?: boolean;
  all?: boolean;
  allPages?: boolean;
}

export interface DesktopWindowState {
  fullScreen: boolean;
}

export type DesktopAppearance = "light" | "dark";

export interface ShowAIBridge {
  openWindow?(
    args: Record<string, unknown>,
    prepare: () => Promise<boolean>,
  ): Promise<boolean>;
  setAppearance?(appearance: DesktopAppearance): Promise<void>;
  getWindowState?(): Promise<DesktopWindowState>;
  onWindowStateChange?(
    listener: (state: DesktopWindowState) => void,
  ): () => void;
  invoke<T = unknown>(
    action: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  onChange(listener: (change: DesktopChange) => void): () => void;
  onTabCommand?(listener: (command: TabCommand) => void): () => void;
  onRefreshPage?(listener: () => void): () => void;
  onBeforeClose(listener: () => Promise<boolean>): () => void;
  prepareReload?(): Promise<boolean>;
}

export type DesktopResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: DesktopError };
