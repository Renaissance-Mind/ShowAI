import { DatabaseSync } from "node:sqlite";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { deflateRaw, inflateRawSync } from "node:zlib";
import { promisify } from "node:util";
import {
  readSqlite,
  sqliteResourcePath as resourcePath,
  type SqliteTreeEntry,
} from "./sqlite-reader";
const compress = promisify(deflateRaw);
import { CoreError } from "./model";
import { encodeFile, nodePrefix } from "./history-codec";
import { withLibraryLock } from "./library-lock";
import { libraryMutations } from "./history-context";
import { completePageReaders } from "./archived-reader";
import {
  WorkspaceProtection,
  workspaceHash,
  type WorkspaceConflict,
} from "./workspace-conflicts";
import {
  atomicLibraryFile,
  readLibraryBytes,
  safeLibraryPath,
} from "./library-files";
import {
  describeResponse,
  restoreResponse,
  type ResponseDescriptor,
} from "./history-response";
import {
  resourceForPath,
  type ChangeContext,
  type ChangeRecord,
  type FileChanges,
  type HistoryEntry,
  type LibraryManifest,
} from "./history-model";

const oid = (value: string) => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
const sha = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
interface RevisionRow {
  sequence: number;
  revision: string;
  entry: string;
  checksum: string;
}
interface BlobRow {
  oid: string;
  data: Uint8Array;
  digest: string;
  bytes: number;
  codec: number;
}
interface Journal {
  id: string;
  parent: string | null;
  candidate?: string;
  paths: string[];
  before: Record<string, string | null>;
}
const schema = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=10000;
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(sequence INTEGER PRIMARY KEY AUTOINCREMENT,revision TEXT UNIQUE NOT NULL,entry TEXT NOT NULL,checksum TEXT NOT NULL,operation_id TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS blobs(oid TEXT PRIMARY KEY,data BLOB NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,codec INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS paths(path TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS changes(sequence INTEGER NOT NULL REFERENCES revisions(sequence),path TEXT NOT NULL,oid TEXT REFERENCES blobs(oid),PRIMARY KEY(sequence,path));
CREATE INDEX IF NOT EXISTS changes_path_sequence ON changes(path,sequence DESC);
CREATE TABLE IF NOT EXISTS current_files(path TEXT PRIMARY KEY,oid TEXT NOT NULL REFERENCES blobs(oid));
CREATE TABLE IF NOT EXISTS resource_changes(path TEXT NOT NULL,sequence INTEGER NOT NULL REFERENCES revisions(sequence),PRIMARY KEY(path,sequence));
CREATE INDEX IF NOT EXISTS resource_changes_latest ON resource_changes(path,sequence DESC);
`;
function unpack(row: BlobRow) {
  const bytes =
    row.codec === 1 ? inflateRawSync(row.data) : Buffer.from(row.data);
  if (bytes.length !== row.bytes || sha(bytes) !== row.digest)
    throw new CoreError(
      "INVALID_DATA",
      "Stored content checksum mismatch. The workspace and original history remain retained.",
    );
  return bytes;
}

function assertPath(path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    /[\x00-\x1f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^(projects\/|packages\/|assets\/|publications\/|imports\/|runtimes\/|sidebar\.json$)/.test(
      path,
    )
  )
    throw new CoreError(
      "INVALID_PATH",
      `Invalid library content path: ${path}`,
    );
  return path;
}

function changeMessage(record: ChangeRecord): string {
  return `${record.message?.split(/\r?\n/)[0] || "Save content"}\n\n${JSON.stringify(record)}`;
}
function parseRecord(message: string): ChangeRecord {
  const start = message.indexOf("\n\n");
  if (start < 0)
    throw new CoreError("INVALID_DATA", "History metadata is missing.");
  const value = JSON.parse(message.slice(start + 2).trim()) as ChangeRecord;
  if (
    value.format !== "showai-change" ||
    value.version !== 1 ||
    !value.operationId ||
    !/^[a-f0-9]{64}$/.test(value.requestHash) ||
    !Number.isFinite(Date.parse(value.at)) ||
    !Array.isArray(value.paths) ||
    !Array.isArray(value.resources) ||
    !value.actor ||
    !["desktop", "browser", "cli", "mcp", "external", "system"].includes(
      value.channel,
    ) ||
    !["human", "agent", "system", "external", "unknown"].includes(
      value.actor.kind,
    )
  )
    throw new CoreError("INVALID_DATA", "Invalid history metadata.");
  if (
    value.actor.kind === "agent" &&
    (typeof value.actor.harness !== "string" ||
      !value.actor.harness ||
      typeof value.actor.sessionId !== "string" ||
      !value.actor.sessionId)
  )
    throw new CoreError(
      "INVALID_DATA",
      "Agent history requires a harness and a real session identifier.",
    );
  return value;
}

/** SQLite owns immutable history and the current tree; files are recoverable projections. */
export class SqliteLibrary {
  readonly root: string;
  readonly repository: string;
  readonly workspace: string;
  constructor(root: string) {
    this.root = resolve(root);
    this.repository = join(this.root, "history");
    this.workspace = join(this.root, "workspace");
  }
  private async database() {
    const path = join(this.repository, "content.sqlite");
    await safeLibraryPath(this.root, path);
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
    return db;
  }
  private async query<T>(
    action: (db: DatabaseSync) => T,
    transaction = true,
  ): Promise<T> {
    const db = await this.database();
    try {
      if (transaction) db.exec("BEGIN");
      const result = action(db);
      if (transaction) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (transaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
  }
  async manifest(): Promise<LibraryManifest> {
    const manifest = JSON.parse(
      await readFile(join(this.root, "library.json"), "utf8"),
    ) as LibraryManifest;
    if (
      manifest.format !== "showai-library" ||
      manifest.version !== 2 ||
      manifest.storage !== "sqlite" ||
      !manifest.id
    )
      throw new CoreError(
        "INVALID_DATA",
        "This content library needs a verified SQLite migration.",
      );
    return manifest;
  }
  async initialize(): Promise<LibraryManifest> {
    await mkdir(this.root, { recursive: true });
    return withLibraryLock(this.root, async () => {
      if (await readLibraryBytes(this.root, join(this.root, "library.json"))) {
        const manifest = await this.manifest();
        await this.recoverUnlocked();
        return manifest;
      }
      for (const name of ["projects", "packages", "publications"]) {
        const entries = await readdir(join(this.root, name)).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        );
        if (entries.length)
          throw new CoreError(
            "CONFLICT",
            "Import existing content into a new library before initializing.",
          );
      }
      if (await readLibraryBytes(this.root, join(this.root, "sidebar.json")))
        throw new CoreError(
          "CONFLICT",
          "Import the existing sidebar before activation.",
        );
      const bootstrapPath = join(this.root, "local", "library-bootstrap.json"),
        bootstrap = await readLibraryBytes(this.root, bootstrapPath);
      if (
        !bootstrap &&
        (await access(this.repository).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        ))
      )
        throw new CoreError(
          "CONFLICT",
          "Unmarked history was retained; recover its initialization journal first.",
        );
      const manifest: LibraryManifest = bootstrap
        ? { ...JSON.parse(bootstrap.toString()), storage: "sqlite" }
        : {
            format: "showai-library",
            version: 2,
            storage: "sqlite",
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          };
      if (
        manifest.format !== "showai-library" ||
        manifest.version !== 2 ||
        !/^[a-f0-9-]{36}$/.test(manifest.id) ||
        !Number.isFinite(Date.parse(manifest.createdAt))
      )
        throw new CoreError(
          "INVALID_DATA",
          "Invalid interrupted library initialization.",
        );
      await this.atomicFile(
        bootstrapPath,
        Buffer.from(JSON.stringify(manifest)),
      );
      await safeLibraryPath(this.root, this.repository);
      await mkdir(this.repository, { recursive: true });
      await mkdir(this.workspace, { recursive: true });
      const db = new DatabaseSync(join(this.repository, "content.sqlite"));
      try {
        db.exec(schema);
      } finally {
        db.close();
      }
      await this.atomicFile(
        join(this.root, "library.json"),
        Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
      );
      return manifest;
    });
  }
  async head(): Promise<string | null> {
    return this.query(
      (db) =>
        (db.prepare("SELECT value FROM metadata WHERE key='head'").get()
          ?.value as string | undefined) ?? null,
    );
  }
  private async revision(value?: string): Promise<string> {
    const revision = value ?? (await this.head());
    if (!revision || !oid(revision) || !(await this.hasRevision(revision)))
      throw new CoreError(
        "NOT_FOUND",
        "The requested library revision is missing.",
      );
    return revision;
  }
  private sequence(db: DatabaseSync, revision: string) {
    if (!oid(revision))
      throw new CoreError("INVALID_DATA", "Invalid history revision.");
    const row = db
      .prepare("SELECT sequence FROM revisions WHERE revision=?")
      .get(revision);
    if (!row)
      throw new CoreError(
        "NOT_FOUND",
        "The requested library revision is missing.",
      );
    return Number(row.sequence);
  }
  async tree(revision?: string): Promise<SqliteTreeEntry[]> {
    const selected = revision ?? (await this.head());
    if (!selected) return [];
    return readSqlite(this.root, { kind: "tree", revision: selected });
  }
  async readFiles(
    paths: string[],
    revision?: string,
  ): Promise<Map<string, Buffer>> {
    paths.forEach(assertPath);
    if (!paths.length) return new Map();
    const selected = await this.revision(revision);
    const files = await readSqlite<Map<string, Uint8Array>>(this.root, {
      kind: "files",
      revision: selected,
      paths,
    });
    return new Map(
      [...files].map(([path, bytes]) => [path, Buffer.from(bytes)]),
    );
  }
  async readFile(path: string, revision?: string) {
    return (await this.readFiles([path], revision)).get(path)!;
  }
  async resourceRevisions(
    paths: string[],
    revision?: string,
  ): Promise<Map<string, string | null>> {
    paths.forEach(assertPath);
    if (!paths.length) return new Map();
    const selected = revision ?? (await this.head());
    if (!selected) return new Map(paths.map((path) => [path, null]));
    return readSqlite(this.root, {
      kind: "revisions",
      revision: selected,
      paths,
    });
  }
  async resourceRevision(
    path: string,
    revision?: string,
  ): Promise<string | null> {
    return (await this.resourceRevisions([path], revision)).get(path)!;
  }
  private entry(row: RevisionRow): HistoryEntry {
    if (sha(row.entry) !== row.checksum)
      throw new CoreError(
        "INVALID_DATA",
        "Historical record checksum mismatch.",
      );
    const entry = JSON.parse(row.entry) as HistoryEntry;
    parseRecord(changeMessage(entry));
    if (
      entry.revision !== row.revision ||
      !Array.isArray(entry.parents) ||
      entry.parents.some((parent) => !oid(parent))
    )
      throw new CoreError("INVALID_DATA", "Invalid historical record.");
    return entry;
  }
  async entryAt(revision: string) {
    return this.query((db) => {
      this.sequence(db, revision);
      return this.entry(
        db
          .prepare("SELECT * FROM revisions WHERE revision=?")
          .get(revision) as unknown as RevisionRow,
      );
    });
  }
  async history(
    input: {
      path?: string;
      projectId?: string;
      limit?: number;
      before?: string;
      revision?: string;
    } = {},
  ): Promise<HistoryEntry[]> {
    const selected = input.revision ?? (await this.head());
    if (!selected) return [];
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new CoreError(
        "INVALID_DATA",
        "History limit must be from 1 to 1000.",
      );
    if (input.projectId && !/^[\w-]+$/.test(input.projectId))
      throw new CoreError("INVALID_PATH", "Invalid project identity.");
    const path = input.path
      ? assertPath(input.path)
      : input.projectId
        ? `projects/${input.projectId}/`
        : undefined;
    return this.query((db) => {
      const sequence = this.sequence(db, input.before ?? selected),
        maximum = input.before ? sequence - 1 : sequence;
      const prefix = path?.endsWith("/") ? path : `${path}/`;
      const rows = path
        ? db
            .prepare(
              "SELECT DISTINCT r.* FROM revisions r JOIN resource_changes c ON c.sequence=r.sequence WHERE r.sequence<=? AND (c.path=? OR substr(c.path,1,?)=?) ORDER BY r.sequence DESC LIMIT ?",
            )
            .all(maximum, resourcePath(path), prefix.length, prefix, limit)
        : db
            .prepare(
              "SELECT * FROM revisions WHERE sequence<=? ORDER BY sequence DESC LIMIT ?",
            )
            .all(maximum, limit);
      return (rows as unknown as RevisionRow[]).map((row) => this.entry(row));
    });
  }
  async transaction<T>(
    context: ChangeContext,
    action: () => Promise<T>,
  ): Promise<{ value: T; entry: HistoryEntry | null }> {
    const nested = libraryMutations.getStore();
    if (nested?.root === this.root)
      return { value: await action(), entry: null };
    await this.manifest();
    return withLibraryLock(this.root, async () => {
      await this.recoverUnlocked();
      if (context.operationId && context.requestFingerprint) {
        if (!/^[a-f0-9]{64}$/.test(context.requestFingerprint))
          throw new CoreError("INVALID_DATA", "Invalid request fingerprint.");
        const receipt = await this.receipt(context.operationId);
        if (receipt) {
          if (receipt.requestFingerprint !== context.requestFingerprint)
            throw new CoreError(
              "CONFLICT",
              "This operation ID was already used for a different request.",
            );
          const value = receipt.response
            ? await restoreResponse(
                receipt.response,
                receipt.revision,
                (path) => this.readFile(path, receipt.revision),
                (path) => join(this.workspace, assertPath(path)),
              )
            : undefined;
          const unresolved = (
            await new WorkspaceProtection(this).list()
          ).filter(
            (record) =>
              record.state === "unresolved" &&
              receipt.paths.includes(record.path),
          );
          return {
            value: value as T,
            entry: { ...receipt, workspaceConflicts: unresolved },
          };
        }
      }
      const state = {
        root: this.root,
        head: await this.head(),
        changes: new Map<string, Buffer | null>(),
        expected: new Map<string, string | null>(),
        origins: {} as Pick<
          ChangeContext,
          | "restoredFrom"
          | "mergedFrom"
          | "externalConflictId"
          | "restoredSnapshot"
        >,
      };
      let value: T;
      try {
        value = await libraryMutations.run(state, action);
      } catch (error) {
        if (state.changes.size) {
          const draft = join(
            this.root,
            "local",
            "drafts",
            `failed-${randomUUID()}`,
          );
          try {
            await this.atomicFile(
              join(draft, "draft.json"),
              Buffer.from(
                JSON.stringify({
                  format: "showai-failed-operation",
                  version: 1,
                  baseRevision: state.head,
                  at: new Date().toISOString(),
                  context,
                  paths: [...state.changes.keys()],
                  reason:
                    error instanceof Error ? error.message : String(error),
                }),
              ),
            );
            for (const [path, bytes] of state.changes)
              if (bytes !== null)
                await this.atomicFile(
                  join(draft, "input", assertPath(path)),
                  bytes,
                );
          } catch (persistenceError) {
            throw new AggregateError(
              [error, persistenceError],
              "The operation failed and its draft could not be persisted.",
            );
          }
        }
        throw error;
      }
      const responseFiles = new Map(state.changes);
      if (context.operationId && context.requestFingerprint && state.head) {
        const components = new Map<
          string,
          { id: string; version: string; integrity: string; scope?: string }
        >();
        const inspect = (entry: unknown): void => {
          if (Array.isArray(entry)) {
            entry.forEach(inspect);
            return;
          }
          if (!entry || typeof entry !== "object") return;
          const object = entry as Record<string, unknown>;
          if (
            typeof object.id === "string" &&
            typeof object.version === "string" &&
            typeof object.integrity === "string" &&
            typeof object.html === "string"
          ) {
            components.set(
              `${object.id}@${object.version}:${object.integrity}`,
              object as {
                id: string;
                version: string;
                integrity: string;
                scope?: string;
              },
            );
            return;
          }
          for (const [key, child] of Object.entries(object))
            if (key !== "document") inspect(child);
        };
        inspect(value);
        const tree = components.size ? await this.tree(state.head) : [];
        for (const component of components.values()) {
          const suffix = `/components/${component.id}/${component.version}/compiled.json`;
          for (const entry of tree)
            if (entry.path.endsWith(suffix) && !responseFiles.has(entry.path)) {
              if (
                (component.scope === "project" &&
                  !entry.path.startsWith("projects/")) ||
                (component.scope === "global" &&
                  !entry.path.startsWith("packages/components/")) ||
                (component.scope === "published" &&
                  !entry.path.startsWith("packages/published/"))
              )
                continue;
              const bytes = await this.readFile(entry.path, state.head);
              if (
                JSON.parse(bytes.toString("utf8")).integrity ===
                component.integrity
              ) {
                responseFiles.set(entry.path, bytes);
                break;
              }
            }
        }
      }
      const response =
        context.operationId && context.requestFingerprint
          ? describeResponse(value, responseFiles, (path) => {
              const local = relative(this.workspace, path).split(sep).join("/");
              return local.startsWith("../") || isAbsolute(local)
                ? undefined
                : local;
            })
          : undefined;
      try {
        const entry = await this.writeUnlocked(
          state.changes,
          { ...context, ...state.origins },
          state.expected,
          response,
        );
        return { value, entry };
      } catch (error) {
        await this.preserveFailedOperation(
          state.changes,
          context,
          state.head,
          error,
        );
        throw error;
      }
    });
  }

  async stageFiles(
    changes: FileChanges,
    expected?: Map<string, string | null>,
  ): Promise<void> {
    const state = libraryMutations.getStore();
    if (!state || state.root !== this.root)
      throw new CoreError(
        "INVALID_DATA",
        "Staged content needs an active library transaction.",
      );
    for (const [path, bytes] of changes)
      state.changes.set(assertPath(path), bytes);
    for (const [path, revision] of expected ?? []) {
      if (state.expected.has(path) && state.expected.get(path) !== revision)
        throw new CoreError(
          "CONFLICT",
          "A transaction supplied incompatible resource baselines.",
        );
      state.expected.set(assertPath(path), revision);
    }
  }

  async writeFiles(
    changes: FileChanges,
    context: ChangeContext,
    expected?: Map<string, string | null>,
  ): Promise<HistoryEntry | null> {
    await this.manifest();
    return withLibraryLock(this.root, async () => {
      try {
        return await this.writeUnlocked(changes, context, expected);
      } catch (error) {
        await this.preserveFailedOperation(
          changes,
          context,
          await this.head(),
          error,
        );
        throw error;
      }
    });
  }

  async resolveWorkspaceConflict<T>(
    id: string,
    choice: "discard" | "import" | "merge",
    context: ChangeContext,
    apply?: (bytes: Buffer | null, conflict: WorkspaceConflict) => Promise<T>,
  ): Promise<{
    value?: T;
    entry: HistoryEntry | null;
    conflict: WorkspaceConflict;
  }> {
    await this.manifest();
    return withLibraryLock(this.root, async () => {
      const protection = new WorkspaceProtection(this);
      const { conflict, bytes } = await protection.input(id);
      assertPath(conflict.path);
      if (conflict.state !== "unresolved")
        throw new CoreError(
          "CONFLICT",
          "This external conflict has already been resolved.",
        );
      const head = await this.head();
      const tree = new Set(
        (head ? await this.tree(head) : []).map((entry) => entry.path),
      );
      const current =
        head && tree.has(conflict.path)
          ? await this.readFile(conflict.path, head)
          : null;
      const actual = await readLibraryBytes(
        this.root,
        join(this.workspace, conflict.path),
      );
      const fingerprint = workspaceHash(conflict.path, actual);
      if (
        fingerprint !== conflict.observedHash &&
        fingerprint !== workspaceHash(conflict.path, current)
      ) {
        const newer = await protection.capture(
          conflict.path,
          head,
          actual,
          tree.has(conflict.path),
        );
        throw new CoreError(
          "CONFLICT",
          "外部文件又有新修改，新版本已保留。请查看最新冲突。",
          { conflictId: newer.id },
        );
      }
      const state = {
        root: this.root,
        head,
        changes: new Map<string, Buffer | null>(),
        expected: new Map<string, string | null>(),
      };
      let value: T | undefined;
      if (choice !== "discard") {
        if (!apply)
          throw new CoreError(
            "INVALID_DATA",
            "Import or merge needs a validated resource operation.",
          );
        value = await libraryMutations.run(state, () => apply(bytes, conflict));
        if (!state.changes.has(conflict.path))
          throw new CoreError(
            "INVALID_DATA",
            "The resolution must update its conflicted resource.",
          );
      }
      // The external bytes are safely retained. Restore the canonical projection
      // before recovering interrupted commits or applying the validated resolution.
      const target = join(this.workspace, conflict.path);
      if (current !== null) await this.atomicFile(target, current);
      else {
        await safeLibraryPath(this.root, target);
        await rm(target, { force: true });
      }
      await this.recoverUnlocked();
      const pending = (await protection.list(conflict.path)).filter(
        (item) => item.state === "unresolved",
      );
      const entry =
        choice === "discard"
          ? null
          : await this.writeUnlocked(
              state.changes,
              {
                ...context,
                externalConflictId: id,
                message:
                  context.message ??
                  (choice === "merge"
                    ? "Merge external changes"
                    : "Import external changes"),
              },
              state.expected,
              undefined,
              new Set(pending.map((item) => item.id)),
            );
      let resolved = conflict;
      for (const item of pending) {
        const record = await protection.resolve(
          item.id,
          choice,
          entry?.revision ?? head,
        );
        if (item.id === id) resolved = record;
      }
      await this.recoverUnlocked();
      return { value, entry, conflict: resolved };
    });
  }

  async restore(
    paths: string[],
    revision: string,
    context: ChangeContext,
    expected?: Map<string, string | null>,
  ) {
    const files = await this.readFiles(paths, await this.revision(revision));
    return this.writeFiles(
      files,
      { ...context, restoredFrom: revision },
      expected,
    );
  }

  /** Import under one writer lease. Every input remains recoverable through normal journals. */
  async replayImported(
    entries:
      | Iterable<{ changes: FileChanges; context: ChangeContext }>
      | AsyncIterable<{ changes: FileChanges; context: ChangeContext }>,
    expectedHead: string | null,
  ): Promise<HistoryEntry[]> {
    return withLibraryLock(this.root, async () => {
      await this.recoverUnlocked();
      if ((await this.head()) !== expectedHead)
        throw new CoreError(
          "CONFLICT",
          "Local content changed while downloading project history. Retry synchronization.",
        );
      const result: HistoryEntry[] = [];
      for await (const entry of entries) {
        if (
          !entry.context.syncOrigin ||
          !Number.isFinite(Date.parse(entry.context.syncOrigin.at))
        )
          throw new CoreError(
            "INVALID_DATA",
            "Imported history requires its original timestamp and source identity.",
          );
        const written = await this.writeUnlocked(entry.changes, entry.context);
        if (written) result.push(written);
      }
      return result;
    });
  }

  private async atomicFile(path: string, bytes: Buffer) {
    return atomicLibraryFile(this.root, path, bytes);
  }
  private async preserveFailedOperation(
    changes: FileChanges,
    context: ChangeContext,
    baseRevision: string | null,
    reason: unknown,
  ) {
    if (
      !changes.size ||
      (reason instanceof CoreError && reason.code === "INVALID_PATH")
    )
      return;
    const directory = join(
      this.root,
      "local",
      "drafts",
      `failed-${randomUUID()}`,
    );
    try {
      await this.atomicFile(
        join(directory, "draft.json"),
        Buffer.from(
          JSON.stringify({
            format: "showai-failed-operation",
            version: 1,
            baseRevision,
            at: new Date().toISOString(),
            context,
            paths: [...changes.keys()],
            reason: reason instanceof Error ? reason.message : String(reason),
          }),
        ),
      );
      for (const [path, bytes] of changes)
        if (bytes !== null)
          await this.atomicFile(
            join(directory, "input", assertPath(path)),
            bytes,
          );
    } catch (error) {
      throw new AggregateError(
        [reason, error],
        "The save failed and its draft could not be persisted.",
      );
    }
  }
  private async receipt(operationId: string) {
    return this.query((db) => {
      const row = db
        .prepare("SELECT * FROM revisions WHERE operation_id=?")
        .get(operationId) as unknown as RevisionRow | undefined;
      return row ? this.entry(row) : undefined;
    });
  }
  private async writeUnlocked(
    changes: FileChanges,
    context: ChangeContext,
    expected?: Map<string, string | null>,
    response?: ResponseDescriptor,
    allowedConflicts = new Set<string>(),
  ): Promise<HistoryEntry | null> {
    await this.recoverUnlocked();
    const parent = await this.head(),
      operationId = context.operationId ?? randomUUID();
    if (
      !operationId ||
      operationId.length > 1000 ||
      /[\x00-\x1f]/.test(operationId)
    )
      throw new CoreError("INVALID_DATA", "Invalid operation identifier.");
    const request = createHash("sha256");
    request.update(JSON.stringify({ ...context, operationId: undefined }));
    for (const [path, bytes] of [...changes].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      request
        .update(assertPath(path))
        .update("\0")
        .update(bytes === null ? "delete\0" : "write\0");
      if (bytes !== null) request.update(bytes);
    }
    const requestHash = request.digest("hex"),
      previous = await this.receipt(operationId);
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new CoreError(
          "CONFLICT",
          "This operation ID was already used for different edits.",
        );
      return previous;
    }
    for (const [path, baseline] of expected ?? [])
      if ((await this.resourceRevision(path, parent ?? undefined)) !== baseline)
        throw new CoreError(
          "CONFLICT",
          `The resource has newer changes: ${path}`,
          { currentRevision: parent ?? undefined },
        );
    changes = new Map(changes);
    const existing = await this.tree(parent ?? undefined);
    if (!context.syncOrigin) {
      const config = await readFile(
        join(this.root, "local", "sync", "config.json"),
        "utf8",
      ).then(
        (bytes) =>
          JSON.parse(bytes) as {
            projects: { projectId: string; role: string; status: string }[];
          },
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      for (const path of changes.keys()) {
        const id = path.match(/^projects\/([^/]+)\//)?.[1],
          binding = config?.projects.find((item) => item.projectId === id);
        if (binding?.role === "viewer" || binding?.status === "revoked")
          throw new CoreError(
            "CONFLICT",
            "当前账号没有项目编辑权限，修改已保留为本地草稿。",
          );
      }
    }
    await completePageReaders(changes, async (path) => {
      if (!parent)
        throw new CoreError("NOT_FOUND", `Reader dependency missing: ${path}`);
      return this.readFile(path, parent);
    });
    const existingObjects = new Map(
      existing.map((item) => [item.path, item.oid]),
    );
    for (const [path, bytes] of changes)
      if (
        bytes &&
        (path.startsWith("runtimes/") ||
          /\/pages\/[^/]+\/reader\.json$/.test(path)) &&
        existingObjects.get(path) === sha(encodeFile(path, bytes).get(path)!)
      )
        changes.delete(path);
    if (!changes.size) return null;
    const record: ChangeRecord = {
      ...context,
      format: "showai-change",
      version: 1,
      operationId,
      requestHash,
      ...(response ? { response } : {}),
      at: context.syncOrigin?.at ?? new Date().toISOString(),
      paths: [...changes.keys()].map(assertPath),
      resources: [
        ...new Map(
          [...changes.keys()].map((path) => {
            const resource = resourceForPath(path);
            return [resource.path, resource];
          }),
        ).values(),
      ],
    };
    parseRecord(changeMessage(record));
    const actorLabel =
      context.actor.label ??
      (context.actor.kind === "agent"
        ? `${context.actor.harness ?? "agent"}:${context.actor.sessionId ?? "unknown"}`
        : context.actor.kind);
    if (typeof actorLabel !== "string" || /[<>\r\n\x00]/.test(actorLabel))
      throw new CoreError("INVALID_DATA", "Invalid actor label.");
    const encoded: FileChanges = new Map();
    for (const [path, bytes] of changes) {
      if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path))
        for (const entry of existing)
          if (entry.path.startsWith(nodePrefix(path)))
            encoded.set(entry.path, null);
      if (bytes === null) encoded.set(path, null);
      else
        for (const [name, contents] of encodeFile(path, bytes))
          encoded.set(name, contents);
    }
    const files = Object.fromEntries(
      [...encoded]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, bytes]) => [path, bytes === null ? null : sha(bytes)]),
    );
    const revision = sha(JSON.stringify({ record, parent, files })),
      entry: HistoryEntry = {
        ...record,
        revision,
        parents: parent ? [parent] : [],
      };
    const before = await new WorkspaceProtection(this).baseline(
        record.paths,
        parent,
        allowedConflicts,
      ),
      id = randomUUID(),
      directory = join(this.root, "local", "transactions", id);
    await mkdir(directory, { recursive: true });
    const journal: Journal = { id, parent, paths: record.paths, before };
    await this.atomicFile(
      join(directory, "journal.json"),
      Buffer.from(JSON.stringify(journal)),
    );
    for (const [path, bytes] of changes)
      if (bytes !== null)
        await this.atomicFile(join(directory, "input", path), bytes);
    journal.candidate = revision;
    await this.atomicFile(
      join(directory, "journal.json"),
      Buffer.from(JSON.stringify(journal)),
    );
    await this.commit(entry, encoded, parent);
    const conflicts = await new WorkspaceProtection(this).materialize(
      record.paths,
      revision,
      before,
    );
    if (conflicts.length) entry.workspaceConflicts = conflicts;
    await this.atomicFile(
      join(this.root, "local", "receipts", `${sha(operationId)}.json`),
      Buffer.from(JSON.stringify(entry)),
    );
    if (!conflicts.length) await rm(directory, { recursive: true });
    return entry;
  }
  /** Commit content, history, head and idempotent operation receipt together. */
  async commit(
    entry: HistoryEntry,
    encoded: FileChanges,
    expectedHead: string | null,
  ) {
    // Prepare compression before acquiring the database writer transaction.
    const prepared = new Map<
      string,
      { id: string; bytes: Buffer; data?: Buffer; packed?: boolean }
    >();
    const objects = new Map<
      string,
      { id: string; bytes: Buffer; data?: Buffer; packed?: boolean }
    >();
    for (const [path, bytes] of encoded) {
      assertPath(path);
      if (bytes === null) continue;
      const content = Buffer.from(bytes);
      const id = sha(content),
        object = objects.get(id) ?? { id, bytes: content };
      objects.set(id, object);
      prepared.set(path, object);
    }
    // Immutable objects already retained by history need neither recompression nor reinsertion.
    const stored = await this.query((db) => {
      const ids = [...objects.keys()],
        found = new Set<string>();
      for (let offset = 0; offset < ids.length; offset += 500) {
        const chunk = ids.slice(offset, offset + 500);
        for (const row of db
          .prepare(
            `SELECT oid FROM blobs WHERE oid IN(${chunk.map(() => "?").join(",")})`,
          )
          .all(...chunk))
          found.add(String(row.oid));
      }
      return found;
    });
    for (const object of objects.values()) {
      if (stored.has(object.id)) continue;
      const compressed =
        object.bytes.length > 512 ? await compress(object.bytes) : object.bytes;
      object.packed = compressed.length < object.bytes.length * 0.97;
      object.data = object.packed ? compressed : object.bytes;
    }
    const db = await this.database();
    try {
      db.exec("BEGIN IMMEDIATE");
      const head =
        (db.prepare("SELECT value FROM metadata WHERE key='head'").get()
          ?.value as string | undefined) ?? null;
      if (head !== expectedHead)
        throw new CoreError(
          "CONFLICT",
          "Content changed before the transaction committed.",
        );
      const data = JSON.stringify(entry),
        result = db
          .prepare(
            "INSERT INTO revisions(revision,entry,checksum,operation_id) VALUES(?,?,?,?)",
          )
          .run(entry.revision, data, sha(data), entry.operationId),
        sequence = Number(result.lastInsertRowid);
      for (const [path] of encoded) {
        assertPath(path);
        const object = prepared.get(path),
          id = object?.id ?? null;
        if (object?.data) {
          db.prepare("INSERT OR IGNORE INTO blobs VALUES(?,?,?,?,?)").run(
            id,
            object.data,
            id,
            object.bytes.length,
            object.packed ? 1 : 0,
          );
        }
        db.prepare("INSERT OR IGNORE INTO paths VALUES(?)").run(path);
        db.prepare("INSERT INTO changes VALUES(?,?,?)").run(sequence, path, id);
        if (id)
          db.prepare(
            "INSERT INTO current_files VALUES(?,?) ON CONFLICT(path) DO UPDATE SET oid=excluded.oid",
          ).run(path, id);
        else db.prepare("DELETE FROM current_files WHERE path=?").run(path);
      }
      for (const path of new Set(entry.paths.map(resourcePath)))
        db.prepare("INSERT OR IGNORE INTO resource_changes VALUES(?,?)").run(
          path,
          sequence,
        );
      db.prepare(
        "INSERT INTO metadata VALUES('head',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(entry.revision);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
  }
  private async recoverUnlocked() {
    const root = join(this.root, "local", "transactions"),
      names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    const head = await this.head();
    for (const name of names) {
      const directory = join(root, name),
        bytes = await readLibraryBytes(
          this.root,
          join(directory, "journal.json"),
        );
      if (!bytes) {
        await mkdir(join(this.root, "local", "drafts"), { recursive: true });
        await rename(
          directory,
          join(this.root, "local", "drafts", `interrupted-preparation-${name}`),
        );
        continue;
      }
      const journal = JSON.parse(bytes.toString()) as Journal;
      if (
        journal.id !== name ||
        !Array.isArray(journal.paths) ||
        journal.paths.some((path) => assertPath(path) !== path)
      )
        throw new CoreError("INVALID_DATA", "Invalid interrupted transaction.");
      if (
        head &&
        journal.candidate &&
        (await this.isAncestor(journal.candidate, head))
      ) {
        const conflicts = await new WorkspaceProtection(this).materialize(
            journal.paths,
            head,
            journal.before ?? {},
          ),
          entry = await this.entryAt(journal.candidate);
        await this.atomicFile(
          join(
            this.root,
            "local",
            "receipts",
            `${sha(entry.operationId)}.json`,
          ),
          Buffer.from(
            JSON.stringify({
              ...entry,
              ...(conflicts.length ? { workspaceConflicts: conflicts } : {}),
            }),
          ),
        );
        if (!conflicts.length) await rm(directory, { recursive: true });
      } else {
        await mkdir(join(this.root, "local", "drafts"), { recursive: true });
        await rename(
          directory,
          join(this.root, "local", "drafts", `interrupted-${name}`),
        );
      }
    }
  }
  async recover() {
    await this.manifest();
    await withLibraryLock(this.root, () => this.recoverUnlocked());
  }
  async compact() {
    return withLibraryLock(this.root, async () => {
      await this.recoverUnlocked();
      const before = await stat(join(this.repository, "content.sqlite"));
      await this.query((db) => {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
      }, false);
      const after = await stat(join(this.repository, "content.sqlite"));
      return { before: String(before.size), after: String(after.size) };
    });
  }
  async objectStatistics() {
    return this.query((db) => {
      const count = Number(
          db.prepare("SELECT COUNT(*) AS count FROM blobs").get()!.count,
        ),
        bytes = Number(
          db
            .prepare("SELECT COALESCE(SUM(length(data)),0) AS bytes FROM blobs")
            .get()!.bytes,
        );
      return {
        looseObjects: 0,
        looseBytes: 0,
        packedObjects: count,
        packs: count ? 1 : 0,
        packedBytes: bytes,
        garbageObjects: 0,
        garbageBytes: 0,
      };
    });
  }
  async hasRevision(revision: string) {
    if (!oid(revision)) return false;
    return this.query(
      (db) =>
        !!db.prepare("SELECT 1 FROM revisions WHERE revision=?").get(revision),
    );
  }
  async isAncestor(ancestor: string, revision: string) {
    if (!oid(ancestor) || !oid(revision)) return false;
    return this.query((db) => {
      const a = db
          .prepare("SELECT sequence FROM revisions WHERE revision=?")
          .get(ancestor),
        b = db
          .prepare("SELECT sequence FROM revisions WHERE revision=?")
          .get(revision);
      return !!a && !!b && Number(a.sequence) <= Number(b.sequence);
    });
  }
  async changedPaths(before: string, after: string) {
    const [a, b] = await Promise.all([this.tree(before), this.tree(after)]),
      left = new Map(a.map((item) => [item.path, item.oid])),
      right = new Map(b.map((item) => [item.path, item.oid]));
    return [
      ...new Set(
        [...left.keys(), ...right.keys()]
          .filter((path) => left.get(path) !== right.get(path))
          .map(resourcePath),
      ),
    ];
  }
  async verify() {
    await this.query((db) => {
      const integrity = db.prepare("PRAGMA integrity_check").all();
      if (
        integrity.length !== 1 ||
        Object.values(integrity[0])[0] !== "ok" ||
        db.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new CoreError(
          "INVALID_DATA",
          "Content database integrity check failed.",
        );
      for (const row of db.prepare("SELECT * FROM blobs").iterate())
        unpack(row as unknown as BlobRow);
      let previous: string | undefined;
      for (const row of db
        .prepare("SELECT * FROM revisions ORDER BY sequence")
        .iterate()) {
        const entry = this.entry(row as unknown as RevisionRow);
        if (
          entry.parents.length !== (previous ? 1 : 0) ||
          (previous && entry.parents[0] !== previous)
        )
          throw new CoreError(
            "INVALID_DATA",
            "History ancestry is incomplete.",
          );
        previous = entry.revision;
      }
      if (
        (db.prepare("SELECT value FROM metadata WHERE key='head'").get()
          ?.value ?? undefined) !== previous
      )
        throw new CoreError(
          "INVALID_DATA",
          "The history head does not match its last durable operation.",
        );
    });
  }
}
