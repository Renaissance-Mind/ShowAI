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
  /** Source commit the App was built from; "unknown" when it was not recorded. */
  sourceCommit?: string;
  arch?: string;
  osVersion?: string;
  versions?: { node: string; electron?: string; chrome?: string };
}

/** Native menu items the workbench carries out with its existing actions. */
export type MenuCommand =
  | "newProject"
  | "newPage"
  | "newTab"
  | "import"
  | "export"
  | "settings"
  | "projects"
  | "docs"
  | "faq"
  | "about"
  | "reportProblem"
  | "copyDiagnostics"
  | "shortcuts";

/** A page whose changes could not be written when its window was closing. */
export interface UnsavedPage {
  projectId: string;
  pageId: string;
  title: string;
  reason: string;
  /** Page source (.showai.json) of the unsaved draft, for export. */
  source?: string;
}

/** A close listener either allows closing or explains which pages hold it open. */
export type CloseResult = boolean | { allow: boolean; pages?: UnsavedPage[] };

export function closeAllowed(result: CloseResult): boolean {
  return typeof result === "boolean" ? result : result.allow === true;
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
  /** Private to native capture frames. */
  onPreviewCapture?(listener: (action: "load" | "clear") => void): () => void;
  previewReady?(id: string, error?: string): void;
  /** Desktop can rasterize directory pages in a separate renderer process. */
  pageThumbnails?: boolean;
  onPageThumbnail?(
    listener: (reference: {
      projectId: string;
      pageId: string;
      theme: string;
    }) => void,
  ): () => void;
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
  onMenuCommand?(listener: (command: MenuCommand) => void): () => void;
  /** Desktop only: the main-process log and its folder. */
  logPath?(): Promise<string>;
  openLogFolder?(): Promise<void>;
  /** Plain-text diagnostics (versions, platform, library, log path), redacted. */
  diagnostics?(): Promise<string>;
  /** The last lines of the main-process log, redacted. */
  logTail?(lines?: number): Promise<string>;
  /** Saves redacted diagnostics where the person chooses; null when cancelled. */
  exportDiagnostics?(text: string): Promise<{ path: string } | null>;
  onBeforeClose(listener: () => Promise<CloseResult>): () => void;
  onBeforeReload?(listener: () => Promise<boolean>): () => void;
  prepareReload?(): Promise<boolean>;
}

export type DesktopResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: DesktopError };
