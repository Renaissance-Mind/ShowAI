import type { Locale } from "../i18n";
export const PROJECT_SCOPE_LIMIT = 1000;

export type TabCommand = "new" | "close" | "next" | "previous";

export interface DesktopError {
  code: string;
  message: string;
  currentHash?: string;
  currentRevision?: string;
  conflictId?: string;
  errno?: string;
  syscall?: string;
  path?: string;
  kind?: string;
  actualBytes?: number;
  limitBytes?: number;
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
  builtinDocs?: boolean;
  sourceCommit?: string;
  arch?: string;
  osVersion?: string;
  versions?: { node: string; electron?: string; chrome?: string };
}

export interface AppUpdateState {
  supported: boolean;
  unavailableReason?: "development" | "missingFeed" | "browser";
  automatic: boolean;
  currentVersion: string;
  phase:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "ready"
    | "failed";
  version?: string;
  percent?: number;
  retryDownload?: boolean;
  checkedAt?: string;
  error?: string;
}

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
  | "shortcuts"
  | "find"
  | "findReplace"
  | "findNext"
  | "findPrevious";

export interface UnsavedPage {
  projectId: string;
  pageId: string;
  title: string;
  reason: string;
  source?: string;
}

export type CloseBlockerCode =
  | "PAGE_NOT_RETAINED"
  | "PAGE_NOT_SAVED"
  | "PAGE_CONFLICT"
  | "DATASET_NOT_RETAINED"
  | "ASSISTANT_DRAFT_NOT_SAVED"
  | "LISTENER_REFUSED"
  | "LISTENER_FAILED"
  | "LISTENER_TIMEOUT"
  | "NO_REPLY";

export type CloseSource =
  "pages" | "datasets" | "assistant" | "sidebar" | "workbench" | "window";

export interface CloseBlocker {
  code: CloseBlockerCode;
  source: CloseSource;
  message?: string;
  projectId?: string;
  pageId?: string;
  datasetId?: string;
  title?: string;
  seconds?: number;
}

export type CloseResult =
  | boolean
  | { allow: boolean; pages?: UnsavedPage[]; blockers?: CloseBlocker[] };

export interface CloseReport {
  allow: boolean;
  pages: UnsavedPage[];
  blockers: CloseBlocker[];
  reason: string;
}

export function closeAllowed(result: CloseResult): boolean {
  return typeof result === "boolean" ? result : result.allow === true;
}

export interface DesktopChange {
  type: "files" | "home";
  home: string;
  projectIds?: string[];
  pageIds?: string[];
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

export type DesktopAppearance = "light" | "dark";

export interface ShowAIBridge {
  onPreviewCapture?(listener: (action: "load" | "clear") => void): () => void;
  previewReady?(id: string, error?: string): void;
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
  onAppUpdate?(listener: (state: AppUpdateState) => void): () => void;
  logPath?(): Promise<string>;
  openLogFolder?(): Promise<void>;
  diagnostics?(): Promise<string>;
  logTail?(lines?: number): Promise<string>;
  exportDiagnostics?(text: string): Promise<{ path: string } | null>;
  onBeforeClose(
    listener: () => Promise<CloseResult>,
    source?: CloseSource,
  ): () => void;
  onBeforeReload?(
    listener: () => Promise<CloseResult>,
    source?: CloseSource,
  ): () => void;
  prepareReload?(): Promise<boolean>;
  prepareReloadReport?(): Promise<CloseReport>;
}

export type DesktopResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: DesktopError };
