import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  rename,
  stat,
  mkdtemp,
  rm,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync, backup } from "node:sqlite";

const chunkSize = 8 * 1024 * 1024;
interface FileEntry {
  path: string;
  size: number;
  chunks: string[];
}
interface Manifest {
  version: 1;
  files: FileEntry[];
}
export interface ObjectStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function batches<T>(items: T[], action: (item: T) => Promise<void>) {
  for (let offset = 0; offset < items.length; offset += 8) {
    const results = await Promise.allSettled(
      items.slice(offset, offset + 8).map(action),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
function validPath(path: string) {
  return (
    !!path &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}
/** Private encrypted checkpoints. A head is committed only after every referenced chunk exists. */
export class CloudState {
  private previous = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private dirty = false;
  private key: Buffer;
  constructor(
    readonly root: string,
    readonly objects: ObjectStore,
    key: string,
    readonly options: {
      ignore?: (path: string) => boolean;
      snapshotSqlite?: boolean;
      onRestoreProgress?: (completed: number, total: number) => void;
    } = {},
  ) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error(
        "SHOWAI_MCP_STATE_KEY must be 32 random bytes encoded as lowercase hex.",
      );
    this.key = Buffer.from(key, "hex");
  }
  private seal(bytes: Uint8Array, context: string) {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    return Buffer.concat([
      nonce,
      cipher.update(bytes),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  }
  private unseal(bytes: Uint8Array, context: string) {
    if (bytes.length < 28) throw new Error("Invalid encrypted state object.");
    const value = Buffer.from(bytes),
      decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        value.subarray(0, 12),
      );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(value.subarray(-16));
    return Buffer.concat([
      decipher.update(value.subarray(12, -16)),
      decipher.final(),
    ]);
  }
  async restore() {
    this.options.onRestoreProgress?.(0, 0);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await readdir(this.root)).length)
      throw new Error(
        "Cloud state restoration requires an empty directory; existing recovery data is preserved.",
      );
    const stored = await this.objects.get("head");
    if (!stored) return;
    const manifest = JSON.parse(
      this.unseal(stored, "head").toString(),
    ) as Manifest;
    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.length > 100000
    )
      throw new Error("Invalid cloud state manifest.");
    const paths = new Set<string>();
    let completed = 0;
    this.options.onRestoreProgress?.(0, manifest.files.length);
    await batches(manifest.files, async (file) => {
      if (
        !validPath(file.path) ||
        paths.has(file.path) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !Array.isArray(file.chunks) ||
        file.chunks.length !== Math.ceil(file.size / chunkSize)
      )
        throw new Error("Invalid cloud state file.");
      paths.add(file.path);
      // Process leases and other ephemeral files from older checkpoints must
      // also be excluded on restore, even if a container reuses the same PID.
      if (this.options.ignore?.(file.path)) {
        this.options.onRestoreProgress?.(++completed, manifest.files.length);
        return;
      }
      const path = join(this.root, file.path);
      await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
      const handle = await open(path + ".restore", "wx", 0o600);
      let length = 0;
      try {
        for (const hash of file.chunks) {
          if (!/^[a-f0-9]{64}$/.test(hash))
            throw new Error("Invalid cloud state chunk.");
          const storedChunk = await this.objects.get(hash);
          if (!storedChunk)
            throw new Error("Cloud state is incomplete; refusing to start.");
          const chunk = this.unseal(storedChunk, hash);
          if (chunk.length > chunkSize || digest(chunk) !== hash)
            throw new Error("Cloud state checksum mismatch.");
          await handle.writeFile(chunk);
          length += chunk.length;
          this.previous.add(hash);
        }
        if (length !== file.size) throw new Error("Cloud state size mismatch.");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(path + ".restore", path);
      this.options.onRestoreProgress?.(++completed, manifest.files.length);
    });
  }
  async save(capture?: (read: () => Promise<void>) => Promise<void>) {
    const files: FileEntry[] = [],
      referenced = new Set<string>();
    const staging = await mkdtemp(join(tmpdir(), "showai-state-checkpoint-"));
    const uploads = new Set<string>();
    const visit = async (directory: string, prefix = "") => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = prefix + entry.name;
        if (this.options.ignore?.(path)) continue;
        if (!validPath(path)) throw new Error("Invalid state path.");
        if (entry.isSymbolicLink())
          throw new Error("Cloud state cannot contain symbolic links.");
        if (entry.isDirectory()) {
          await visit(join(directory, entry.name), path + "/");
          continue;
        }
        if (!entry.isFile())
          throw new Error("Cloud state cannot contain special files.");
        // SQLite reconstructs shared-memory coordination from its database and WAL.
        if (entry.name.endsWith(".sqlite-shm")) continue;
        if (this.options.snapshotSqlite && entry.name.endsWith(".sqlite-wal"))
          continue;
        let sourcePath = join(directory, entry.name),
          temporary: string | undefined;
        if (this.options.snapshotSqlite && entry.name.endsWith(".sqlite")) {
          temporary = await mkdtemp(
            join(tmpdir(), "showai-sqlite-checkpoint-"),
          );
          const database = new DatabaseSync(sourcePath, { readOnly: true });
          try {
            sourcePath = join(temporary, "snapshot.sqlite");
            await backup(database, sourcePath);
          } finally {
            database.close();
          }
        }
        const handle = await open(sourcePath, "r"),
          chunks: string[] = [];
        let size = 0;
        try {
          const buffer = Buffer.alloc(chunkSize);
          while (true) {
            const { bytesRead } = await handle.read(
              buffer,
              0,
              buffer.length,
              null,
            );
            if (!bytesRead) break;
            const bytes = buffer.subarray(0, bytesRead),
              hash = digest(bytes);
            if (!this.previous.has(hash) && !referenced.has(hash)) {
              await writeFile(join(staging, hash), this.seal(bytes, hash), {
                mode: 0o600,
              });
              uploads.add(hash);
            }
            referenced.add(hash);
            chunks.push(hash);
            size += bytesRead;
          }
          if ((await stat(sourcePath)).size !== size)
            throw new Error("State changed during checkpoint.");
        } finally {
          await handle.close();
          if (temporary) await rm(temporary, { recursive: true, force: true });
        }
        files.push({ path, size, chunks });
        if (files.length > 100000)
          throw new Error("Cloud state file limit exceeded.");
      }
    };
    try {
      // Capture immutable encrypted bytes while the caller holds its write lock.
      // Object storage latency must not block edits or project synchronization.
      if (capture) await capture(() => visit(this.root));
      else await visit(this.root);
      await batches([...uploads], async (hash) => {
        await this.objects.put(hash, await readFile(join(staging, hash)));
      });
      await this.objects.put(
        "head",
        this.seal(
          Buffer.from(JSON.stringify({ version: 1, files } satisfies Manifest)),
          "head",
        ),
      );
      this.previous = referenced;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  run(operation: () => Promise<Response>, checkpoint: () => void) {
    const next = this.tail.then(async () => {
      // Retry a failed checkpoint before accepting another mutation.
      if (this.dirty) {
        checkpoint();
        await this.save();
        this.dirty = false;
      }
      this.dirty = true;
      try {
        return await operation();
      } finally {
        checkpoint();
        await this.save();
        this.dirty = false;
      }
    });
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
export function httpObjectStore(origin: string, secret: string): ObjectStore {
  const request = async (key: string, bytes?: Uint8Array) => {
    const response = await fetch(`${origin}/__state/${key}`, {
      method: bytes ? "PUT" : "GET",
      headers: { authorization: `Bearer ${secret}` },
      ...(bytes ? { body: Buffer.from(bytes) } : {}),
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
    if (!bytes && response.status === 404) return null;
    if (!response.ok)
      throw new Error(`State storage request failed (${response.status}).`);
    return bytes ? null : new Uint8Array(await response.arrayBuffer());
  };
  return {
    get: (key) => request(key),
    put: async (key, bytes) => {
      await request(key, bytes);
    },
  };
}
