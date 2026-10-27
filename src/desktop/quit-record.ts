import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CloseBlocker } from "./bridge";

/**
 * Machine-readable record of windows that refused to close, next to the main
 * log. It exists only while at least one window is held open; a quit that
 * succeeds removes it.
 */
export const QUIT_BLOCKED_NAME = "quit-blocked.json";

export type CloseTrigger = "close" | "quit";

export interface QuitBlockedWindow {
  windowId: number;
  /** Window title: the open page's title, or "ShowAI". */
  title: string;
  /** What asked the window to close. */
  trigger: CloseTrigger;
  /**
   * awaiting-decision: the dialog explaining the refusal is open;
   * kept-open: the person chose to keep editing, or the dialog was dismissed.
   */
  state: "awaiting-decision" | "kept-open";
  since: string;
  updatedAt: string;
  blockers: CloseBlocker[];
}

export interface QuitBlockedRecord {
  format: "showai-quit-blocked";
  version: 1;
  pid: number;
  appVersion: string;
  packaged: boolean;
  mode: "desktop";
  sourceCommit: string;
  home: string;
  /** The main-process log with the matching entries. */
  log: string;
  updatedAt: string;
  windows: QuitBlockedWindow[];
}

export type QuitRecordIdentity = Omit<
  QuitBlockedRecord,
  "format" | "version" | "updatedAt" | "windows"
>;

export class QuitRecord {
  readonly path: string;
  private entries = new Map<number, QuitBlockedWindow>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly directory: string,
    private readonly identity: () => QuitRecordIdentity,
    private readonly report: (error: unknown) => void,
  ) {
    this.path = join(directory, QUIT_BLOCKED_NAME);
  }

  /** Records or updates one held-open window and rewrites the file. */
  set(
    windowId: number,
    entry: Omit<QuitBlockedWindow, "windowId" | "since" | "updatedAt">,
  ): Promise<void> {
    const now = new Date().toISOString();
    const previous = this.entries.get(windowId);
    this.entries.set(windowId, {
      windowId,
      ...entry,
      since: previous?.since ?? now,
      updatedAt: now,
    });
    return this.flush();
  }

  /** The window closed or agreed to close. */
  delete(windowId: number): Promise<void> {
    if (!this.entries.delete(windowId)) return this.queue;
    return this.flush();
  }

  /** A quit succeeded: nothing is held open any more. */
  clear(): Promise<void> {
    this.entries.clear();
    return this.flush();
  }

  windows(): QuitBlockedWindow[] {
    return [...this.entries.values()];
  }

  private flush(): Promise<void> {
    const windows = this.windows();
    const record: QuitBlockedRecord | undefined = windows.length
      ? {
          format: "showai-quit-blocked",
          version: 1,
          ...this.identity(),
          updatedAt: new Date().toISOString(),
          windows,
        }
      : undefined;
    const write = async () => {
      // The record is a reporting boundary: a failed write is logged, never fatal.
      try {
        if (!record) {
          await rm(this.path, { force: true });
          return;
        }
        await mkdir(this.directory, { recursive: true });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(record, null, 2) + "\n", {
          mode: 0o600,
        });
        await rename(temporary, this.path);
      } catch (error) {
        this.report(error);
      }
    };
    this.queue = this.queue.then(write);
    return this.queue;
  }
}
