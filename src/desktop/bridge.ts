import type { Locale } from "../i18n";
import type { TabCommand } from "../workbench/tab-shortcuts";
export const PROJECT_SCOPE_LIMIT = 1000;

export interface DesktopError {
  code: string;
  message: string;
  currentHash?: string;
  currentRevision?: string;
  conflictId?: string;
  /** Node system error code such as ENOSPC, EACCES, EROFS or ENOENT. */
  errno?: string;
  syscall?: string;
  /** File the system error is about. */
  path?: string;
  /** CAPACITY_EXCEEDED: what exceeded its limit, with sizes in bytes. */
  kind?: string;
  actualBytes?: number;
  limitBytes?: number;
  /** Browser mode: HTTP status of a failed request to the local service. */
  status?: number;
  saveFailed?: boolean;
  details?: Record<string, unknown>;
}

export interface DesktopInfo {
  home: string;
  version: string;
  platform: string;
  packaged: boolean;
  mode?: "desktop" | "browser";
  libraryVersion?: 1 | 2;
  cli: { command: string; args: string[]; env: Record<string, string> };
  /** False where the host publishes the documentation itself (the public website). */
  builtinDocs?: boolean;
}

export interface DesktopChange {
  type: "files" | "home";
  home: string;
  projectIds?: string[];
  pageIds?: string[];
  /** Changed shared datasets as "projectId/datasetId"; "projectId/*" for the whole folder. */
  datasets?: string[];
  catalog?: boolean;
  projects?: boolean;
  sidebar?: boolean;
  all?: boolean;
  allPages?: boolean;
}

export interface DesktopWindowState {
  fullScreen: boolean;
}

/** Private data delivered only to the background page capture frame. */
export interface PagePreviewCapture {
  id: string;
  theme: string;
  padding: number;
  record: import("../studio/usePage").LoadedPage;
}

export type DesktopAppearance = "light" | "dark";

export interface ShowAIBridge {
  /** Desktop can rasterize directory pages in a separate renderer process. */
  pageThumbnails?: boolean;
  inlineInk?: import("../surface/inline-ink").InlineInkBridge;
  openWindow?(
    args: Record<string, unknown>,
    prepare: () => Promise<boolean>,
  ): Promise<boolean>;
  setAppearance?(appearance: DesktopAppearance): Promise<void>;
  /** Keeps native menus and dialogs in the workbench language. */
  setLocale?(locale: Locale): Promise<void>;
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
  onBeforeReload?(listener: () => Promise<boolean>): () => void;
  prepareReload?(): Promise<boolean>;
}

export type DesktopResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: DesktopError };
