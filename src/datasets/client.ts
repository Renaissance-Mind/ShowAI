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
import type {
  DatasetReadStatus,
  DatasetWarning,
  Editable,
} from "./warnings.mjs";

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
  source?: { kind: "file" | "url"; format: string; name?: string; url?: string };
  transform?: { inputs: Record<string, unknown>; script: string };
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
  remote?: { url: string; format: string; bytes: number; fetchedAt: string };
  status?: Exclude<DatasetReadStatus, "empty">;
  editable?: Editable;
  warnings?: DatasetWarning[];
  transform?: {
    inputs: Record<string, { datasetId: string; name?: string }>;
  };
}
export interface DatasetSourceState {
  kind?: "file" | "url";
  format: string;
  name?: string;
  path?: string;
  url?: string;
  bytes?: number;
  modifiedAt?: string;
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
  value?: unknown;
  hash?: string;
  readOnly: boolean;
  saving: boolean;
  dirty: boolean;
  conflicts: HeldConflict[];
  recovered: RecoveredDraft[];
  error?: string;
  errorCode?: string;
  source?: DatasetSourceState;
  transform?: { inputs: string[] };
  warnings: DatasetWarning[];
  dataStatus?: DatasetReadStatus;
  editable: Editable;
  names: Record<string, string>;
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
function unavailableWarnings(error: unknown): DatasetWarning[] {
  if (errorCode(error) !== "SOURCE_UNAVAILABLE") return [];
  return (
    (error as { details?: { warnings?: DatasetWarning[] } }).details
      ?.warnings ?? []
  );
}
function failedRead(error: unknown): Partial<DatasetSnapshot> {
  const code = errorCode(error);
  if (code === "NOT_FOUND")
    return { status: "missing", error: errorText(error), errorCode: code };
  return {
    status: "error",
    error: errorText(error),
    errorCode: code,
    ...(code === "SOURCE_UNAVAILABLE"
      ? {
          dataStatus: "empty" as const,
          warnings: unavailableWarnings(error),
          source: unavailableSource(error),
          editable: false,
        }
      : {}),
  };
}
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
  private refreshQueued = false;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private draftWritten = false;
  private sourceEditable: Editable = true;
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
      warnings: [],
      editable: true,
      names: {},
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

  load(options: { refresh?: boolean } = {}): Promise<void> {
    this.loading ??= this.loadNow(options).finally(
      () => (this.loading = undefined),
    );
    return this.loading;
  }

  private async loadNow(options: { refresh?: boolean }) {
    let record: DatasetRecord;
    try {
      record = await this.client.transport.invoke<DatasetRecord>(
        "datasets:get",
        {
          projectId: this.projectId,
          datasetId: this.datasetId,
          ...(options.refresh ? { refresh: true } : {}),
        },
      );
    } catch (error) {
      this.publish({
        ...failedRead(error),
        name:
          (error as { details?: { name?: string } }).details?.name ??
          this.snapshot.name,
      });
      return;
    }
    this.base = { hash: record.hash, value: record.dataset.value };
    this.local = cloneValue(record.dataset.value);
    this.adopt(record);
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
    this.sourceEditable = record.editable ?? true;
    this.snapshot = {
      ...this.snapshot,
      name: record.dataset.name,
      description: record.dataset.description,
      origin: record.dataset.origin,
      readOnly: !!record.readOnly || record.editable === false,
      editable: record.readOnly ? false : (record.editable ?? true),
      dataStatus: record.status ?? "ok",
      warnings: record.warnings ?? [],
      names: Object.fromEntries(
        Object.values(record.transform?.inputs ?? {}).flatMap((input) =>
          input.name ? [[input.datasetId, input.name]] : [],
        ),
      ),
      transform: record.dataset.transform
        ? { inputs: Object.keys(record.dataset.transform.inputs) }
        : undefined,
      source: record.dataset.source
        ? {
            kind: record.dataset.source.kind,
            format: record.dataset.source.format,
            name: record.dataset.source.name,
            ...(record.dataset.source.url
              ? { url: record.dataset.source.url }
              : {}),
            ...(record.external
              ? {
                  path: record.external.path,
                  bytes: record.external.bytes,
                  modifiedAt: record.external.modifiedAt,
                }
              : record.remote
                ? {
                    bytes: record.remote.bytes,
                    modifiedAt: record.remote.fetchedAt,
                  }
                : {}),
            available: record.status !== "stale",
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
    const wait = Math.max(
      0,
      Math.min(delay, this.firstPending + 2000 - Date.now()),
    );
    this.saveTimer = setTimeout(() => void this.flush(), wait);
  }

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
        if (code !== "INVALID_DATA" && code !== "NOT_FOUND") {
          this.retryDelay = Math.min(30000, (this.retryDelay || 1000) * 2);
          this.saveTimer = setTimeout(() => void this.flush(), this.retryDelay);
        }
        await this.persistDraft().catch(() => undefined);
        return;
      }
      this.retryDelay = 0;
      if (result.conflicts.length) {
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

  async refresh(options: { retry?: boolean } = {}): Promise<void> {
    if (this.loading) return this.loading;
    if (!this.base) return this.load({ refresh: options.retry });
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    try {
      if (this.saving) await this.saving;
      const result = await this.client.transport.invoke<
        DatasetRecord | { unchanged: true; readOnly?: boolean }
      >("datasets:get", {
        projectId: this.projectId,
        datasetId: this.datasetId,
        ...(options.retry ? { refresh: true } : {}),
        ...(options.retry ||
        this.snapshot.errorCode === "SOURCE_UNAVAILABLE" ||
        this.snapshot.source?.available === false
          ? {}
          : { ifHash: this.base.hash }),
      });
      if ("unchanged" in result) {
        const readOnly = !!result.readOnly || this.sourceEditable === false;
        if (readOnly !== this.snapshot.readOnly)
          this.publish({
            readOnly,
            editable: result.readOnly ? false : this.sourceEditable,
          });
        return;
      }
      this.rebase(result);
      this.publish({ status: "ready", error: undefined, errorCode: undefined });
      if (this.snapshot.dirty) this.scheduleSave();
      await this.persistDraft();
    } catch (error) {
      const code = errorCode(error);
      this.publish(
        code === "NOT_FOUND" || code === "SOURCE_UNAVAILABLE"
          ? failedRead(error)
          : { error: errorText(error) },
      );
    } finally {
      this.refreshQueued = false;
    }
  }

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

  async prepareClose(): Promise<boolean> {
    return !(await this.closeProblem());
  }

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

export interface DatasetCloseProblem {
  projectId: string;
  datasetId: string;
  name?: string;
  draftError: string;
  saveError?: string;
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
      setTimeout(() => {
        if (session.references > 0) return;
        void session.flush().then((clean) => {
          if (clean && session.references <= 0)
            this.sessions.delete(`${session.projectId}/${session.datasetId}`);
        });
      }, 30000);
    };
  }

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
