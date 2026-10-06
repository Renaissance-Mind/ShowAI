import { createRequire } from "node:module";
import { access, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { CoreError } from "./model";
import { encodeFile, decodeFile, nodePrefix } from "./history-codec";
import { withLibraryLock } from "./library-lock";
import { libraryMutations } from "./history-context";
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

const CURRENT = "refs/heads/content";
const runtimeRequire = createRequire(
  process.env.SHOWAI_DEV_RUNTIME
    ? join(process.env.SHOWAI_DEV_RUNTIME, "package.json")
    : import.meta.url,
);
function gitPackage(): string {
  try {
    return runtimeRequire.resolve("dugite");
  } catch (error) {
    const resources = (process as NodeJS.Process & { resourcesPath?: string })
      .resourcesPath;
    if (
      (error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND" ||
      !resources
    )
      throw error;
    return createRequire(join(resources, "runtime/package.json")).resolve(
      "dugite",
    );
  }
}
const { exec: gitExec, resolveEmbeddedGitDir } = runtimeRequire(
  gitPackage(),
) as typeof import("dugite");
const oid = (value: string) => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
interface TreeEntry {
  path: string;
  oid: string;
  bytes?: number;
}
interface Journal {
  id: string;
  parent: string | null;
  candidate?: string;
  paths: string[];
  before: Record<string, string | null>;
}

function assertPath(path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    /[\x00-\x1f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^(projects\/|packages\/|assets\/|publications\/|imports\/|sidebar\.json$)/.test(
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

/** Git is authoritative. Working files and indexes are recoverable projections. */
export class GitLibrary {
  readonly root: string;
  readonly repository: string;
  readonly workspace: string;
  constructor(root: string) {
    this.root = resolve(root);
    this.repository = join(this.root, "repository.git");
    this.workspace = join(this.root, "workspace");
  }

  private environment(extra: Record<string, string | undefined> = {}) {
    return {
      ...Object.fromEntries(
        Object.keys(process.env)
          .filter(
            (key) => key.startsWith("GIT_") || key === "LOCAL_GIT_DIRECTORY",
          )
          .map((key) => [key, undefined]),
      ),
      LOCAL_GIT_DIRECTORY: resolveEmbeddedGitDir(),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "ShowAI",
      GIT_AUTHOR_EMAIL: "showai@localhost",
      GIT_COMMITTER_NAME: "ShowAI",
      GIT_COMMITTER_EMAIL: "showai@localhost",
      ...extra,
    };
  }

  private async command(args: string[], stdin?: Buffer | string) {
    const result = await gitExec(
      [
        "--git-dir",
        this.repository,
        "-c",
        "core.hooksPath=",
        "-c",
        "gc.auto=0",
        ...args,
      ],
      this.root,
      {
        env: this.environment(),
        stdin,
        encoding: "buffer",
        maxBuffer: 512 * 1024 * 1024,
      },
    );
    if (result.exitCode !== 0)
      throw new CoreError(
        "INVALID_DATA",
        `Library Git ${args[0]} failed: ${result.stderr.toString("utf8").trim()}`,
      );
    return result.stdout;
  }

  async manifest(): Promise<LibraryManifest> {
    const value = JSON.parse(
      await readFile(join(this.root, "library.json"), "utf8"),
    ) as LibraryManifest;
    if (value.format !== "showai-library" || value.version !== 2 || !value.id)
      throw new CoreError("INVALID_DATA", "Invalid content library manifest.");
    return value;
  }

  async initialize(): Promise<LibraryManifest> {
    await mkdir(this.root, { recursive: true });
    return withLibraryLock(this.root, async () => {
      const existing = await access(join(this.root, "library.json")).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (existing) {
        await this.manifest();
        await this.recoverUnlocked();
        return this.manifest();
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
            "This directory contains an existing file library. Import it into a new versioned library instead of initializing over it.",
          );
      }
      if (await readLibraryBytes(this.root, join(this.root, "sidebar.json")))
        throw new CoreError(
          "CONFLICT",
          "Import the existing sidebar into a versioned library before activation.",
        );
      const result = await gitExec(
        ["init", "--bare", "--quiet", this.repository],
        this.root,
        { env: this.environment() },
      );
      if (result.exitCode !== 0)
        throw new CoreError(
          "INVALID_DATA",
          `Could not create the library repository: ${result.stderr}`,
        );
      await mkdir(this.workspace, { recursive: true });
      const manifest: LibraryManifest = {
        format: "showai-library",
        version: 2,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      await this.atomicFile(
        join(this.root, "library.json"),
        Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
      );
      return manifest;
    });
  }

  async head(): Promise<string | null> {
    const result = await gitExec(
      [
        "--git-dir",
        this.repository,
        "rev-parse",
        "--verify",
        "--quiet",
        CURRENT,
      ],
      this.root,
      { env: this.environment() },
    );
    if (result.exitCode === 1) return null;
    if (result.exitCode !== 0)
      throw new CoreError(
        "INVALID_DATA",
        `Cannot read the library revision: ${result.stderr}`,
      );
    const value = result.stdout.trim();
    if (!oid(value))
      throw new CoreError("INVALID_DATA", "Invalid library revision.");
    return value;
  }

  private async revision(value?: string): Promise<string> {
    const selected = value ?? (await this.head());
    if (!selected || !oid(selected))
      throw new CoreError(
        "NOT_FOUND",
        "The requested library revision is missing.",
      );
    return selected;
  }

  async tree(revision?: string): Promise<TreeEntry[]> {
    const selected = revision ?? (await this.head());
    if (!selected) return [];
    if (!oid(selected))
      throw new CoreError("INVALID_DATA", "Invalid revision identifier.");
    const output = await this.command([
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      selected,
    ]);
    return output
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const [header, path] = [
          line.slice(0, line.indexOf("\t")),
          line.slice(line.indexOf("\t") + 1),
        ];
        const [mode, type, id] = header.split(" ");
        if (mode !== "100644" || type !== "blob" || !oid(id))
          throw new CoreError(
            "INVALID_DATA",
            "Library trees may contain only regular content files.",
          );
        return { path: assertPath(path), oid: id };
      });
  }

  private async blobs(ids: string[]): Promise<Map<string, Buffer>> {
    if (ids.some((id) => !oid(id)))
      throw new CoreError("INVALID_DATA", "Invalid content object identifier.");
    if (!ids.length) return new Map();
    const output = await this.command(
      ["cat-file", "--batch"],
      ids.join("\n") + "\n",
    );
    const result = new Map<string, Buffer>();
    let offset = 0;
    for (const requested of ids) {
      const end = output.indexOf(10, offset);
      if (end < 0)
        throw new CoreError("INVALID_DATA", "Truncated object response.");
      const [id, kind, size] = output
        .subarray(offset, end)
        .toString("utf8")
        .split(" ");
      const bytes = Number(size);
      if (
        id !== requested ||
        kind !== "blob" ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        end + 1 + bytes >= output.length
      )
        throw new CoreError(
          "INVALID_DATA",
          `Invalid or missing content object: ${requested}`,
        );
      result.set(id, output.subarray(end + 1, end + 1 + bytes));
      offset = end + bytes + 2;
    }
    if (offset !== output.length)
      throw new CoreError("INVALID_DATA", "Unexpected trailing object data.");
    return result;
  }

  async readFiles(
    paths: string[],
    revision?: string,
  ): Promise<Map<string, Buffer>> {
    const selected = await this.revision(revision);
    const entries = new Map(
      (await this.tree(selected)).map((entry) => [entry.path, entry.oid]),
    );
    const needed = new Set<string>();
    for (const path of paths) {
      assertPath(path);
      const id = entries.get(path);
      if (!id)
        throw new CoreError(
          "NOT_FOUND",
          `File not found in revision ${selected}: ${path}`,
        );
      needed.add(id);
      if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path))
        for (const [name, node] of entries)
          if (name.startsWith(nodePrefix(path))) needed.add(node);
    }
    const objects = await this.blobs([...needed]);
    const pending = new Map<string, Promise<Buffer>>();
    const read = async (path: string): Promise<Buffer> => {
      const id = entries.get(assertPath(path));
      if (!id)
        throw new CoreError(
          "NOT_FOUND",
          `Missing historical dependency: ${path}`,
        );
      const loaded = objects.get(id);
      if (loaded) return loaded;
      let promise = pending.get(id);
      if (!promise) {
        promise = this.blobs([id]).then((values) => values.get(id)!);
        pending.set(id, promise);
      }
      return promise;
    };
    return new Map(
      await Promise.all(
        paths.map(
          async (path) => [path, await decodeFile(path, read)] as const,
        ),
      ),
    );
  }

  async readFile(path: string, revision?: string): Promise<Buffer> {
    return (await this.readFiles([path], revision)).get(path)!;
  }

  async resourceRevision(
    path: string,
    revision?: string,
  ): Promise<string | null> {
    assertPath(path);
    const selected = revision ?? (await this.head());
    if (!selected) return null;
    if (!oid(selected))
      throw new CoreError("INVALID_DATA", "Invalid revision.");
    const output = await this.command([
      "log",
      "-1",
      "--format=%H",
      selected,
      "--",
      path,
      nodePrefix(path),
    ]);
    return output.toString("utf8").trim() || null;
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
    const head = input.revision
      ? await this.revision(input.revision)
      : await this.head();
    if (!head) return [];
    if (input.before && !oid(input.before))
      throw new CoreError("INVALID_DATA", "Invalid history cursor.");
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new CoreError(
        "INVALID_DATA",
        "History limit must be from 1 to 1000.",
      );
    const args = [
      "log",
      `--max-count=${limit}`,
      "--format=%H%x00%P%x00%B%x00",
      input.before ?? head,
    ];
    if (input.before) args.push("--skip=1");
    if (input.path)
      args.push("--", assertPath(input.path), nodePrefix(input.path));
    else if (input.projectId) {
      if (!/^[\w-]+$/.test(input.projectId))
        throw new CoreError("INVALID_PATH", "Invalid project identity.");
      args.push("--", `projects/${input.projectId}/`);
    }
    const output = await this.command(args);
    const fields = output.toString("utf8").split("\0");
    const result: HistoryEntry[] = [];
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const revision = fields[index].trim();
      if (!revision) continue;
      if (!oid(revision))
        throw new CoreError("INVALID_DATA", "Invalid history revision.");
      result.push({
        ...parseRecord(fields[index + 2]),
        revision,
        parents: fields[index + 1].trim().split(" ").filter(Boolean),
      });
    }
    return result;
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
          "restoredFrom" | "mergedFrom" | "externalConflictId" | "restoredSnapshot"
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
      const entry = await this.writeUnlocked(
        state.changes,
        { ...context, ...state.origins },
        state.expected,
        response,
      );
      return { value, entry };
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
    return withLibraryLock(this.root, () =>
      this.writeUnlocked(changes, context, expected),
    );
  }

  private async writeUnlocked(
    changes: FileChanges,
    context: ChangeContext,
    expected?: Map<string, string | null>,
    response?: ResponseDescriptor,
    allowedConflicts = new Set<string>(),
  ): Promise<HistoryEntry | null> {
    await this.recoverUnlocked();
    const parent = await this.head();
    const operationId = context.operationId ?? randomUUID();
    if (
      !operationId ||
      operationId.length > 1000 ||
      /[\x00-\x1f]/.test(operationId)
    )
      throw new CoreError("INVALID_DATA", "Invalid operation identifier.");
    const receiptPath = join(
      this.root,
      "local",
      "receipts",
      `${sha(operationId)}.json`,
    );
    const receipt = await readFile(receiptPath, "utf8").then(
      (value) => JSON.parse(value) as HistoryEntry,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
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
    const requestHash = request.digest("hex");
    if (receipt) {
      if (receipt.requestHash !== requestHash)
        throw new CoreError(
          "CONFLICT",
          "This operation ID was already used for different edits.",
        );
      return receipt;
    }
    for (const [path, revision] of expected ?? []) {
      if ((await this.resourceRevision(path, parent ?? undefined)) !== revision)
        throw new CoreError(
          "CONFLICT",
          `The resource has newer changes: ${path}`,
          { currentRevision: parent ?? undefined },
        );
    }
    const record: ChangeRecord = {
      ...context,
      format: "showai-change",
      version: 1,
      operationId,
      requestHash,
      ...(response ? { response } : {}),
      at: new Date().toISOString(),
      paths: [...changes.keys()].map(assertPath),
      resources: [
        ...new Map(
          [...changes.keys()].map((path) => {
            const resource = resourceForPath(assertPath(path));
            return [resource.path, resource];
          }),
        ).values(),
      ],
    };
    // Validate the same metadata shape we accept when reading historical commits.
    parseRecord(changeMessage(record));
    if (!changes.size) return null;
    const existing = await this.tree(parent ?? undefined);
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
    const transaction = join(this.root, "local", "transactions", randomUUID());
    const id = transaction.split(sep).at(-1)!;
    const before = await new WorkspaceProtection(this).baseline(
      record.paths,
      parent,
      allowedConflicts,
    );
    const journal: Journal = { id, parent, paths: record.paths, before };
    await mkdir(transaction, { recursive: true });
    await this.atomicFile(
      join(transaction, "journal.json"),
      Buffer.from(JSON.stringify(journal)),
    );
    // Persist incoming edits as recoverable drafts before touching the committed head.
    for (const [path, bytes] of changes)
      if (bytes !== null)
        await this.atomicFile(join(transaction, "input", path), bytes);
    const temporaryRef = `refs/showai/transactions/${id}`;
    const chunks: Buffer[] = [];
    let mark = 0;
    const marks = new Map<string, number>();
    for (const [path, bytes] of encoded)
      if (bytes !== null) {
        marks.set(path, ++mark);
        chunks.push(
          Buffer.from(`blob\nmark :${mark}\ndata ${bytes.length}\n`),
          bytes,
          Buffer.from("\n"),
        );
      }
    const message = Buffer.from(changeMessage(record));
    const actorLabel =
      context.actor.label ??
      (context.actor.kind === "agent"
        ? `${context.actor.harness ?? "agent"}:${context.actor.sessionId ?? "unknown"}`
        : context.actor.kind);
    if (/[<>\r\n\x00]/.test(actorLabel))
      throw new CoreError("INVALID_DATA", "Invalid actor label.");
    chunks.push(
      Buffer.from(
        `commit ${temporaryRef}\nauthor ${actorLabel} <showai@localhost> ${Math.floor(Date.parse(record.at) / 1000)} +0000\ncommitter ShowAI <showai@localhost> ${Math.floor(Date.parse(record.at) / 1000)} +0000\ndata ${message.length}\n`,
      ),
      message,
      Buffer.from(`\n${parent ? `from ${parent}\n` : ""}`),
    );
    for (const [path, bytes] of encoded)
      chunks.push(
        Buffer.from(
          bytes === null
            ? `D ${JSON.stringify(path)}\n`
            : `M 100644 :${marks.get(path)} ${JSON.stringify(path)}\n`,
        ),
      );
    chunks.push(Buffer.from("\ndone\n"));
    await this.command(
      ["fast-import", "--quiet", "--done"],
      Buffer.concat(chunks),
    );
    const revision = (await this.command(["rev-parse", temporaryRef]))
      .toString("utf8")
      .trim();
    if (!oid(revision))
      throw new CoreError("INVALID_DATA", "Git returned an invalid commit.");
    journal.candidate = revision;
    await this.atomicFile(
      join(transaction, "journal.json"),
      Buffer.from(JSON.stringify(journal)),
    );
    await this.command([
      "update-ref",
      CURRENT,
      revision,
      parent ?? "0".repeat(revision.length),
    ]);
    const entry: HistoryEntry = {
      ...record,
      revision,
      parents: parent ? [parent] : [],
    };
    const workspaceConflicts = await new WorkspaceProtection(this).materialize(
      record.paths,
      revision,
      before,
    );
    if (workspaceConflicts.length)
      entry.workspaceConflicts = workspaceConflicts;
    await this.atomicFile(receiptPath, Buffer.from(JSON.stringify(entry)));
    await this.command(["update-ref", "-d", temporaryRef]);
    if (!workspaceConflicts.length) await rm(transaction, { recursive: true });
    return entry;
  }

  private async receipt(
    operationId: string,
  ): Promise<HistoryEntry | undefined> {
    return readFile(
      join(this.root, "local", "receipts", `${sha(operationId)}.json`),
      "utf8",
    ).then(
      (value) => JSON.parse(value) as HistoryEntry,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
  }

  private async atomicFile(path: string, bytes: Buffer): Promise<void> {
    return atomicLibraryFile(this.root, path, bytes);
  }

  private async recoverUnlocked(): Promise<void> {
    const root = join(this.root, "local", "transactions");
    const transactions = await readdir(root).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const head = await this.head();
    for (const name of transactions) {
      const directory = join(root, name);
      const journal = JSON.parse(
        await readFile(join(directory, "journal.json"), "utf8"),
      ) as Journal;
      if (
        journal.id !== name ||
        !Array.isArray(journal.paths) ||
        journal.paths.some((path) => assertPath(path) !== path)
      )
        throw new CoreError("INVALID_DATA", "Invalid interrupted transaction.");
      let committed = false;
      if (head && journal.candidate && oid(journal.candidate)) {
        const ancestry = await gitExec(
          [
            "--git-dir",
            this.repository,
            "merge-base",
            "--is-ancestor",
            journal.candidate,
            head,
          ],
          this.root,
          { env: this.environment() },
        );
        if (ancestry.exitCode !== 0 && ancestry.exitCode !== 1)
          throw new CoreError(
            "INVALID_DATA",
            `Could not recover history: ${ancestry.stderr}`,
          );
        committed = ancestry.exitCode === 0;
      }
      if (committed) {
        const conflicts = await new WorkspaceProtection(this).materialize(
          journal.paths,
          head!,
          journal.before ?? {},
        );
        const message = (
          await this.command(["show", "-s", "--format=%B", journal.candidate!])
        ).toString("utf8");
        const record = parseRecord(message);
        const receipt: HistoryEntry = {
          ...record,
          revision: journal.candidate!,
          parents: journal.parent ? [journal.parent] : [],
          ...(conflicts.length ? { workspaceConflicts: conflicts } : {}),
        };
        await this.atomicFile(
          join(
            this.root,
            "local",
            "receipts",
            `${sha(record.operationId)}.json`,
          ),
          Buffer.from(JSON.stringify(receipt)),
        );
        if (!conflicts.length) await rm(directory, { recursive: true });
      } else {
        const drafts = join(this.root, "local", "drafts");
        await mkdir(drafts, { recursive: true });
        await rename(directory, join(drafts, `interrupted-${name}`));
      }
      await this.command([
        "update-ref",
        "-d",
        `refs/showai/transactions/${name}`,
      ]);
    }
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

  async recover(): Promise<void> {
    await withLibraryLock(this.root, () => this.recoverUnlocked());
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

  async compact(): Promise<{ before: string; after: string }> {
    return withLibraryLock(this.root, async () => {
      await this.recoverUnlocked();
      const before = (await this.command(["count-objects", "-v"])).toString(
        "utf8",
      );
      await this.command(["repack", "-a", "-d"]);
      const after = (await this.command(["count-objects", "-v"])).toString(
        "utf8",
      );
      return { before, after };
    });
  }

  async isAncestor(ancestor: string, revision: string): Promise<boolean> {
    if (!oid(ancestor) || !oid(revision))
      throw new CoreError("INVALID_DATA", "Invalid history ancestry query.");
    const result = await gitExec(
      [
        "--git-dir",
        this.repository,
        "merge-base",
        "--is-ancestor",
        ancestor,
        revision,
      ],
      this.root,
      { env: this.environment() },
    );
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    throw new CoreError(
      "INVALID_DATA",
      `History ancestry query failed: ${result.stderr}`,
    );
  }

  async changedPaths(before: string, after: string): Promise<string[]> {
    if (!oid(before) || !oid(after))
      throw new CoreError("INVALID_DATA", "Invalid history comparison.");
    const output = await this.command([
      "diff",
      "--name-only",
      "-z",
      before,
      after,
    ]);
    return [
      ...new Set(
        output
          .toString("utf8")
          .split("\0")
          .filter(Boolean)
          .map((path) =>
            path.replace(
              /^(projects\/[^/]+\/pages\/[^/]+)\/nodes\/[^/]+\.json$/,
              "$1.json",
            ),
          ),
      ),
    ];
  }

  async verify(): Promise<void> {
    await this.command(["fsck", "--full", "--strict"]);
  }
}
