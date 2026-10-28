// Renderer side of shared datasets: one session per dataset per window, shared
// by every bound block in that window. Edits apply locally at once, are kept
// as a draft on disk and saved as id-addressed operations; other windows'
// and Agents' writes arrive through file change events and are merged in.
// A field changed differently elsewhere is held with both values until the
// person chooses; it is never overwritten.

import {
  applyOperations,
  cloneValue,
  diffValues,
  equalValues,
  pathKey,
  valueAt,
  type DataPath,
  type DatasetConflict,
  type DatasetOperation,
} from "./operations.mjs";
import { coalescedTask } from "../lib/coalesced-task";

export interface DatasetTransport {
  invoke<T = unknown>(
    action: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
}
interface DatasetFile {
  id: string;
  name: string;
  description?: string;
  value: unknown;
  schema?: unknown;
  origin?: {
    kind: string;
    componentId?: string;
    pageId?: string;
    blockId?: string;
  };
  source?: { kind: "file"; format: string; name?: string };
  updatedAt: string;
}
interface DatasetRecord {
  dataset: DatasetFile;
  hash: string;
  revision?: string;
  readOnly?: boolean;
  external?: {
    path: string;
    format: string;
    bytes: number;
    modifiedAt: string;
  };
}
/** Where the value of an external dataset comes from, as last read. */
export interface DatasetSourceState {
  format: string;
  name?: string;
  path?: string;
  bytes?: number;
  modifiedAt?: string;
  /** False while the linked file cannot be read on this device. */
  available: boolean;
}
export interface HeldConflict extends DatasetConflict {
  id: string;
  at: string;
}
export interface RecoveredDraft {
  clientId: string;
  savedAt: string;
  pending: DatasetOperation[];
  held: HeldConflict[];
}
export interface DatasetSnapshot {
  status: "loading" | "ready" | "missing" | "error";
  projectId: string;
  datasetId: string;
  name?: string;
  description?: string;
  origin?: DatasetFile["origin"];
  /** What bound blocks render: the saved value plus this window's pending edits. */
  value?: unknown;
  hash?: string;
  readOnly: boolean;
  saving: boolean;
  dirty: boolean;
  conflicts: HeldConflict[];
  recovered: RecoveredDraft[];
  error?: string;
  errorCode?: string;
  /** Present for a dataset whose value lives in a file outside the library. */
  source?: DatasetSourceState;
  canUndo: boolean;
  canRedo: boolean;
}

function errorText(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}
function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
/** The external source a SOURCE_UNAVAILABLE error names. */
function unavailableSource(error: unknown): DatasetSourceState | undefined {
  if (errorCode(error) !== "SOURCE_UNAVAILABLE") return undefined;
  const source = (
    error as { details?: { source?: Omit<DatasetSourceState, "available"> } }
  ).details?.source;
  return source ? { ...source, available: false } : undefined;
}

interface HistoryEntry {
  undo: DatasetOperation[];
  redo: DatasetOperation[];
  keys: string;
  at: number;
}

export class DatasetSession {
  private listeners = new Set<() => void>();
  private snapshot: DatasetSnapshot;
  private base?: { hash: string; value: unknown };
  private local: unknown;
  private held: HeldConflict[] = [];
  private loading?: Promise<void>;
  private saving?: Promise<void>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private firstPending = 0;
  private refreshTask = coalescedTask(() => this.refreshNow());
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private draftWritten = false;
  private retryDelay = 0;
  references = 0;

  constructor(
    private readonly client: DatasetClient,
    readonly projectId: string,
    readonly datasetId: string,
  ) {
    this.snapshot = {
      status: "loading",
      projectId,
      datasetId,
      readOnly: false,
      saving: false,
      dirty: false,
      conflicts: [],
      recovered: [],
      canUndo: false,
      canRedo: false,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private publish(patch: Partial<DatasetSnapshot> = {}) {
    const dirty = !!this.base && !equalValues(this.base.value, this.local);
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      value: this.local,
      hash: this.base?.hash,
      dirty,
      conflicts: [...this.held],
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    };
    for (const listener of this.listeners) listener();
  }

  load(): Promise<void> {
    this.loading ??= this.loadNow().finally(() => (this.loading = undefined));
    return this.loading;
  }

  private async loadNow() {
    let record: DatasetRecord;
    try {
      record = await this.client.transport.invoke<DatasetRecord>(
        "datasets:get",
        {
          projectId: this.projectId,
          datasetId: this.datasetId,
        },
      );
    } catch (error) {
      this.publish({
        status: errorCode(error) === "NOT_FOUND" ? "missing" : "error",
        error: errorText(error),
        errorCode: errorCode(error),
        source: unavailableSource(error),
        name:
          (error as { details?: { name?: string } }).details?.name ??
          this.snapshot.name,
      });
      return;
    }
    this.base = { hash: record.hash, value: record.dataset.value };
    this.local = cloneValue(record.dataset.value);
    this.adopt(record);
    // Unsaved writes of this window survive a reload; other windows' are offered.
    const drafts = await this.client.transport
      .invoke<(RecoveredDraft & { clientId: string })[]>("datasets:draftList", {
        projectId: this.projectId,
        datasetId: this.datasetId,
      })
      .catch(() => []);
    const recovered: RecoveredDraft[] = [];
    for (const draft of drafts) {
      if (draft.clientId === this.client.clientId) {
        this.restore(draft);
        this.draftWritten = true;
      } else if (draft.pending.length || draft.held.length)
        recovered.push(draft);
    }
    this.publish({
      status: "ready",
      recovered,
      error: undefined,
      errorCode: undefined,
    });
    if (this.snapshot.dirty) this.scheduleSave(0);
  }

  private adopt(record: DatasetRecord) {
    this.snapshot = {
      ...this.snapshot,
      name: record.dataset.name,
      description: record.dataset.description,
      origin: record.dataset.origin,
      readOnly: !!record.readOnly,
      source: record.dataset.source
        ? {
            format: record.dataset.source.format,
            name: record.dataset.source.name,
            ...(record.external
              ? {
                  path: record.external.path,
                  bytes: record.external.bytes,
                  modifiedAt: record.external.modifiedAt,
                }
              : {}),
            available: true,
          }
        : undefined,
    };
  }

  private restore(draft: {
    pending: DatasetOperation[];
    held: HeldConflict[];
  }) {
    const result = applyOperations(this.local, draft.pending, {
      atomic: false,
    });
    this.local = result.value;
    this.hold([
      ...draft.held,
      ...result.conflicts.map((item) => this.heldFrom(item)),
    ]);
  }

  private heldFrom(conflict: DatasetConflict): HeldConflict {
    return {
      ...conflict,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
    };
  }

  private hold(conflicts: HeldConflict[]) {
    for (const conflict of conflicts) {
      const key = pathKey(conflict.path);
      this.held = [
        ...this.held.filter((item) => pathKey(item.path) !== key),
        conflict,
      ];
    }
  }

  /**
   * Applies a block's change. Writes whose starting value no longer matches
   * this window's current value are held as conflicts. Returns them.
   */
  edit(
    operations: DatasetOperation[],
    options: { history?: boolean } = {},
  ): DatasetConflict[] {
    if (
      !operations.length ||
      this.snapshot.readOnly ||
      this.snapshot.status !== "ready"
    )
      return [];
    const before = this.local;
    const result = applyOperations(this.local, operations, { atomic: false });
    this.local = result.value;
    if (result.conflicts.length)
      this.hold(result.conflicts.map((item) => this.heldFrom(item)));
    if (options.history !== false && result.changed) {
      const entry = {
        undo: diffValues(this.local, before),
        redo: diffValues(before, this.local),
        keys: operations
          .map((operation) => pathKey(operation.path))
          .sort()
          .join("|"),
        at: Date.now(),
      };
      const last = this.past.at(-1);
      // Typing in one field forms one undo step that returns to before the first keystroke.
      if (last && last.keys === entry.keys && entry.at - last.at < 800) {
        const start = applyOperations(before, last.undo, {
          atomic: false,
        }).value;
        this.past[this.past.length - 1] = {
          ...entry,
          undo: diffValues(this.local, start),
          redo: diffValues(start, this.local),
        };
      } else this.past.push(entry);
      if (this.past.length > 100) this.past.shift();
      this.future = [];
    }
    this.publish();
    this.scheduleDraft();
    this.scheduleSave();
    return result.conflicts;
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return false;
    this.future.push(entry);
    this.edit(entry.undo, { history: false });
    this.publish();
    return true;
  }
  redo() {
    const entry = this.future.pop();
    if (!entry) return false;
    this.past.push(entry);
    this.edit(entry.redo, { history: false });
    this.publish();
    return true;
  }

  /** Keeps this window's value ("mine") or the other one ("theirs") for a held field. */
  resolve(id: string, choice: "mine" | "theirs") {
    const conflict = this.held.find((item) => item.id === id);
    if (!conflict) return;
    this.held = this.held.filter((item) => item.id !== id);
    if (choice === "mine") {
      const current = valueAt(this.local, conflict.path);
      const operation: DatasetOperation =
        conflict.mine === undefined
          ? {
              op: "remove",
              path: conflict.path,
              ...(current === undefined ? {} : { before: current }),
            }
          : conflict.op === "insert"
            ? { op: "insert", path: conflict.path, value: conflict.mine }
            : current === undefined
              ? {
                  op: "set",
                  path: conflict.path,
                  value: conflict.mine,
                  absent: true,
                }
              : {
                  op: "set",
                  path: conflict.path,
                  value: conflict.mine,
                  before: current,
                };
      const result = this.edit([operation]);
      if (result.length) return;
    }
    this.publish();
    this.scheduleDraft();
  }

  /** Applies or discards the unsaved writes another window left behind. */
  async recover(clientId: string, choice: "restore" | "discard") {
    const draft = this.snapshot.recovered.find(
      (item) => item.clientId === clientId,
    );
    if (!draft) return;
    if (choice === "restore") {
      this.restore(draft);
      this.scheduleDraft();
      this.scheduleSave();
    }
    await this.client.transport.invoke("datasets:draftRemove", {
      projectId: this.projectId,
      datasetId: this.datasetId,
      clientId,
    });
    this.publish({
      recovered: this.snapshot.recovered.filter(
        (item) => item.clientId !== clientId,
      ),
    });
  }

  private scheduleDraft() {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => void this.persistDraft(), 200);
  }

  private draftWrites: Promise<void> = Promise.resolve();
  /** Draft writes run one at a time, each from the state at that moment. */
  private persistDraft() {
    const write = () => this.persistDraftNow();
    this.draftWrites = this.draftWrites.then(write, write);
    return this.draftWrites;
  }

  private async persistDraftNow() {
    if (!this.base) return;
    const pending = diffValues(this.base.value, this.local);
    if (!pending.length && !this.held.length) {
      if (!this.draftWritten) return;
      this.draftWritten = false;
      await this.client.transport.invoke("datasets:draftRemove", {
        projectId: this.projectId,
        datasetId: this.datasetId,
        clientId: this.client.clientId,
      });
      return;
    }
    await this.client.transport.invoke("datasets:draftSave", {
      projectId: this.projectId,
      datasetId: this.datasetId,
      clientId: this.client.clientId,
      baseHash: this.base.hash,
      pending,
      held: this.held,
    });
    this.draftWritten = true;
  }

  private scheduleSave(delay = 500) {
    if (!this.firstPending) this.firstPending = Date.now();
    clearTimeout(this.saveTimer);
    // A continuous edit still saves within two seconds of its first change.
    const wait = Math.max(
      0,
      Math.min(delay, this.firstPending + 2000 - Date.now()),
    );
    this.saveTimer = setTimeout(() => void this.flush(), wait);
  }

  /** Saves pending writes; resolves true when nothing remains unsaved. */
  async flush(): Promise<boolean> {
    clearTimeout(this.saveTimer);
    if (this.saving) await this.saving;
    if (!this.base || this.snapshot.status !== "ready") return true;
    this.saving = this.saveNow();
    try {
      await this.saving;
    } finally {
      this.saving = undefined;
    }
    return !this.snapshot.dirty && !this.held.length && !this.snapshot.error;
  }

  private async saveNow() {
    // A conflict response merges the rest at once; a few rounds cover concurrent writers.
    for (let round = 0; round < 4 && this.base; round++) {
      const operations = diffValues(this.base.value, this.local);
      if (!operations.length) break;
      const sentBase = this.base,
        sentLocal = this.local;
      this.publish({ saving: true });
      let result: {
        record: DatasetRecord;
        conflicts: DatasetConflict[];
        changed: boolean;
      };
      try {
        result = await this.client.transport.invoke("datasets:apply", {
          projectId: this.projectId,
          datasetId: this.datasetId,
          baseHash: sentBase.hash,
          operations,
        });
      } catch (error) {
        const code = errorCode(error);
        this.publish({
          saving: false,
          error: errorText(error),
          ...(code === "NOT_FOUND" ? { status: "missing" as const } : {}),
        });
        // Writes stay in the draft; transient failures retry, invalid data waits for an edit.
        if (code !== "INVALID_DATA" && code !== "NOT_FOUND") {
          this.retryDelay = Math.min(30000, (this.retryDelay || 1000) * 2);
          this.saveTimer = setTimeout(() => void this.flush(), this.retryDelay);
        }
        await this.persistDraft().catch(() => undefined);
        return;
      }
      this.retryDelay = 0;
      if (result.conflicts.length) {
        // Someone else changed the same fields; hold both and merge the rest.
        this.rebase(result.record);
      } else {
        const later = diffValues(sentLocal, this.local);
        this.base = {
          hash: result.record.hash,
          value: result.record.dataset.value,
        };
        const merged = applyOperations(result.record.dataset.value, later, {
          atomic: false,
        });
        this.local = merged.value;
        this.hold(merged.conflicts.map((item) => this.heldFrom(item)));
        this.adopt(result.record);
      }
      this.publish({ saving: false, error: undefined });
    }
    this.firstPending = 0;
    this.publish({ saving: false });
    await this.persistDraft();
  }

  private rebase(record: DatasetRecord) {
    if (!this.base) return;
    const pending = diffValues(this.base.value, this.local);
    const result = applyOperations(record.dataset.value, pending, {
      atomic: false,
    });
    this.base = { hash: record.hash, value: record.dataset.value };
    this.local = result.value;
    this.hold(result.conflicts.map((item) => this.heldFrom(item)));
    this.adopt(record);
  }

  /** Reads the saved dataset again after a change elsewhere and merges pending writes. */
  refresh(): Promise<void> {
    return this.refreshTask();
  }

  private async refreshNow(): Promise<void> {
    // Loading may have read before the change that requested this refresh.
    if (this.loading) await this.loading;
    else if (!this.base) await this.load();
    if (!this.base) return;
    try {
      if (this.saving) await this.saving;
      const result = await this.client.transport.invoke<
        DatasetRecord | { unchanged: true; readOnly?: boolean }
      >("datasets:get", {
        projectId: this.projectId,
        datasetId: this.datasetId,
        // After a source error the same content still needs its new source details.
        ...(this.snapshot.errorCode === "SOURCE_UNAVAILABLE"
          ? {}
          : { ifHash: this.base.hash }),
      });
      if ("unchanged" in result) {
        if (!!result.readOnly !== this.snapshot.readOnly)
          this.publish({ readOnly: !!result.readOnly });
        return;
      }
      this.rebase(result);
      this.publish({ status: "ready", error: undefined, errorCode: undefined });
      if (this.snapshot.dirty) this.scheduleSave();
      await this.persistDraft();
    } catch (error) {
      this.publish(
        errorCode(error) === "NOT_FOUND"
          ? { status: "missing", error: errorText(error) }
          : errorCode(error) === "SOURCE_UNAVAILABLE"
            ? {
                // The linked file went away: show why instead of stale values.
                status: "error",
                error: errorText(error),
                errorCode: "SOURCE_UNAVAILABLE",
                source: unavailableSource(error),
              }
            : { error: errorText(error) },
      );
    }
  }

  /** The value at a path, for presenting a held conflict. */
  valueAt(path: DataPath) {
    return valueAt(this.local, path);
  }

  rename(name: string) {
    return this.client.transport
      .invoke<{ record: DatasetRecord }>("datasets:apply", {
        projectId: this.projectId,
        datasetId: this.datasetId,
        operations: [],
        name,
      })
      .then((result) => {
        this.adopt(result.record);
        this.publish();
      });
  }

  hasUnsaved() {
    return this.snapshot.dirty || this.held.length > 0;
  }

  /** Before a window closes: save what can be saved; anything else stays in the draft. */
  async prepareClose(): Promise<boolean> {
    return !(await this.closeProblem());
  }

  /** Like prepareClose, but says why unsaved writes could not be kept. */
  async closeProblem(): Promise<DatasetCloseProblem | undefined> {
    let saveError: unknown;
    await this.flush().catch((error) => {
      saveError = error;
      return false;
    });
    clearTimeout(this.draftTimer);
    try {
      await this.persistDraft();
      return undefined;
    } catch (error) {
      if (!this.hasUnsaved()) return undefined;
      return {
        projectId: this.projectId,
        datasetId: this.datasetId,
        ...(this.snapshot.name ? { name: this.snapshot.name } : {}),
        draftError: errorText(error),
        ...(saveError || this.snapshot.error
          ? { saveError: saveError ? errorText(saveError) : this.snapshot.error }
          : {}),
        conflicts: this.held.length,
      };
    }
  }
}

/** Shared data whose unsaved writes are neither saved nor kept in a draft. */
export interface DatasetCloseProblem {
  projectId: string;
  datasetId: string;
  name?: string;
  /** Why the local draft could not be written. */
  draftError: string;
  /** Why the formal save failed, when it did. */
  saveError?: string;
  /** Held conflicts that are waiting for the person's choice. */
  conflicts: number;
}

export class DatasetClient {
  private sessions = new Map<string, DatasetSession>();
  constructor(
    readonly transport: DatasetTransport,
    readonly clientId: string,
  ) {}

  session(projectId: string, datasetId: string): DatasetSession {
    const key = `${projectId}/${datasetId}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = new DatasetSession(this, projectId, datasetId);
      this.sessions.set(key, session);
      void session.load();
    }
    return session;
  }

  retain(session: DatasetSession) {
    session.references++;
    return () => {
      session.references--;
      // Unused clean sessions are dropped; one with unsaved writes stays until saved.
      setTimeout(() => {
        if (session.references > 0) return;
        void session.flush().then((clean) => {
          if (clean && session.references <= 0)
            this.sessions.delete(`${session.projectId}/${session.datasetId}`);
        });
      }, 30000);
    };
  }

  /** File change events from this or another window, the CLI, MCP or sync. */
  invalidate(change: {
    type: string;
    all?: boolean;
    datasets?: string[];
    projectIds?: string[];
  }) {
    for (const session of this.sessions.values()) {
      const key = `${session.projectId}/${session.datasetId}`;
      if (
        change.type === "home" ||
        change.all ||
        change.datasets?.includes(key) ||
        change.datasets?.includes(`${session.projectId}/*`)
      )
        void session.refresh();
    }
  }

  /** Refreshes every open dataset, e.g. when the window regains focus. */
  refreshAll() {
    for (const session of this.sessions.values()) void session.refresh();
  }

  async flushAll(): Promise<boolean> {
    const results = await Promise.all(
      [...this.sessions.values()].map((session) => session.flush()),
    );
    return results.every(Boolean);
  }

  async prepareClose(): Promise<boolean> {
    return !(await this.closeProblems()).length;
  }

  /** Every open dataset whose unsaved writes would be lost by closing now. */
  async closeProblems(): Promise<DatasetCloseProblem[]> {
    const problems = await Promise.all(
      [...this.sessions.values()].map((session) => session.closeProblem()),
    );
    return problems.filter((problem) => problem !== undefined);
  }

  hasUnsaved() {
    return [...this.sessions.values()].some((session) => session.hasUnsaved());
  }
}
