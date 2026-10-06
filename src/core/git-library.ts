import { createRequire } from "node:module";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CoreError } from "./model";
import { encodeFile, decodeFile, nodePrefix } from "./history-codec";
import { withLibraryLock } from "./library-lock";
import { libraryMutations } from "./history-context";
import {
  resourceForPath,
  type ChangeContext,
  type ChangeRecord,
  type FileChanges,
  type HistoryEntry,
  type LibraryManifest,
} from "./history-model";

const CURRENT = "refs/heads/content";
const runtimeRoot =
  process.env.SHOWAI_DEV_RUNTIME ??
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const runtimeRequire = createRequire(
  runtimeRoot
    ? join(
        runtimeRoot,
        process.env.SHOWAI_DEV_RUNTIME
          ? "package.json"
          : "runtime/package.json",
      )
    : import.meta.url,
);
const { exec: gitExec, resolveEmbeddedGitDir } = runtimeRequire(
  "dugite",
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
}

function assertPath(path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    /[\x00-\x1f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^(projects\/|packages\/|assets\/|publications\/|sidebar\.json$)/.test(
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
      const state = {
        root: this.root,
        head: await this.head(),
        changes: new Map<string, Buffer | null>(),
        expected: new Map<string, string | null>(),
      };
      const value = await libraryMutations.run(state, action);
      const entry = await this.writeUnlocked(
        state.changes,
        context,
        state.expected,
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
    const journal: Journal = { id, parent, paths: record.paths };
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
    await this.materialize(record.paths, revision);
    await this.atomicFile(receiptPath, Buffer.from(JSON.stringify(entry)));
    await this.command(["update-ref", "-d", temporaryRef]);
    await rm(transaction, { recursive: true });
    return entry;
  }

  private async atomicFile(path: string, bytes: Buffer): Promise<void> {
    const local = relative(this.root, path);
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
      throw new CoreError("INVALID_PATH", "Library write leaves its root.");
    await mkdir(dirname(path), { recursive: true });
    let ancestor = dirname(path);
    while (true) {
      if ((await lstat(ancestor)).isSymbolicLink())
        throw new CoreError(
          "INVALID_PATH",
          "Library paths must not contain symbolic links.",
        );
      if (ancestor === this.root) break;
      ancestor = dirname(ancestor);
    }
    const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }

  private async materialize(paths: string[], revision: string): Promise<void> {
    const entries = new Set(
      (await this.tree(revision)).map((entry) => entry.path),
    );
    const present = paths.filter((path) => entries.has(path));
    const files = await this.readFiles(present, revision);
    for (const path of paths) {
      const target = join(this.workspace, assertPath(path));
      const bytes = files.get(path);
      if (bytes) await this.atomicFile(target, bytes);
      else await rm(target, { force: true });
    }
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
        await this.materialize(journal.paths, head!);
        const message = (
          await this.command(["show", "-s", "--format=%B", journal.candidate!])
        ).toString("utf8");
        const record = parseRecord(message);
        const receipt: HistoryEntry = {
          ...record,
          revision: journal.candidate!,
          parents: journal.parent ? [journal.parent] : [],
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
        await rm(directory, { recursive: true });
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
