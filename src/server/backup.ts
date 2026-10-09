import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  lstat,
  utimes,
} from "node:fs/promises";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { SQLiteMetadata, DiskObjects } from "./node-storage";
import { prepareMetadata, schemaVersion } from "./migrations";
import { backupTables, type SqlValue, type SqlStatement } from "./storage";
import {
  ServerMaintenance,
  operationObjectKey,
  type MaintenanceState,
} from "./maintenance";
import { Revisions } from "./revisions";
import { serverBaseUrl, serverEndpoint } from "../sync/server-url";
import { validateSnapshot, syncProtocol, identifier } from "../sync/protocol";
import {
  validateReaderClosure,
  validatePackageClosure,
} from "../sync/dependency-validation";

interface FileReceipt {
  file: string;
  bytes: number;
  sha256: string;
  rows: number;
}
interface ObjectReceipt {
  key: string;
  bytes: number;
  sha256: string;
  uploadedAt: string;
}
interface BackupDescriptor {
  format: "showai-server-backup-v1";
  schemaVersion: number;
  serverId: string;
  frozen: MaintenanceState;
  tables: Record<string, FileReceipt>;
  inventory: FileReceipt;
  completedAt: string;
}
const hexadecimal = /^[a-f0-9]{64}$/;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function fileHash(path: string) {
  if (!(await lstat(path)).isFile())
    throw new Error("Backup content must be regular files.");
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const block of createReadStream(path, {
    highWaterMark: 64 * 1024,
  })) {
    bytes += block.length;
    digest.update(block);
  }
  return { bytes, sha256: digest.digest("hex") };
}
async function atomicJson(path: string, value: unknown) {
  const temporary = path + "." + crypto.randomUUID() + ".tmp";
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}
async function* jsonLines(
  path: string,
): AsyncGenerator<Record<string, unknown>> {
  if (!(await lstat(path)).isFile())
    throw new Error("Invalid backup metadata file.");
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (Buffer.byteLength(line) > 34 * 1024 * 1024)
      throw new Error("Backup metadata row exceeds its size bound.");
    const row = JSON.parse(line);
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("Invalid backup row.");
    yield row;
  }
}
function operatorUrl(base: string) {
  const normalized = serverBaseUrl(base),
    url = new URL(normalized);
  if (
    url.protocol !== "https:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("Operations credentials require HTTPS outside loopback.");
  return normalized;
}
export async function operationsRequest(
  base: string,
  credential: string,
  path: string,
  method = "GET",
) {
  if (!hexadecimal.test(credential))
    throw new Error("Invalid operations key file.");
  const url = serverEndpoint(operatorUrl(base), path);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
    if (response.ok) return response;
    if (attempt < 4 && [429, 502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      await pause(1000 * (attempt + 1));
      continue;
    }
    const result = await response.json();
    throw new Error(
      `Operations request failed (${response.status}): ${result.error?.code ?? "SERVER_ERROR"}`,
    );
  }
}
export async function exportServerBackup(input: {
  url: string;
  credential: string;
  destination: string;
  resume?: boolean;
  onProgress?: (message: string) => void;
}) {
  const destination = resolve(input.destination);
  if (!isAbsolute(input.destination))
    throw new Error("Backup destination must be absolute.");
  const request = (path: string, method = "GET") =>
    operationsRequest(input.url, input.credential, path, method);
  if (!input.resume) await mkdir(destination, { mode: 0o700 });
  else if (!(await lstat(destination)).isDirectory())
    throw new Error("Resume requires the original private backup directory.");
  await mkdir(join(destination, "progress", "objects"), {
    recursive: true,
    mode: 0o700,
  });
  let progress: {
    serverId: string;
    frozen: MaintenanceState;
    tables: Record<string, FileReceipt>;
  };
  if (input.resume)
    progress = JSON.parse(
      await readFile(join(destination, "progress", "state.json"), "utf8"),
    );
  else {
    const response = await fetch(
      serverEndpoint(operatorUrl(input.url), "/api/info"),
      { signal: AbortSignal.timeout(30_000), redirect: "error" },
    );
    if (!response.ok) throw new Error("The source server info request failed.");
    const info = await response.json();
    if (info.protocol !== syncProtocol)
      throw new Error("Incompatible backup source protocol.");
    identifier(info.serverId);
    const frozen = (await (
      await request("/api/ops/freeze", "POST")
    ).json()) as MaintenanceState;
    progress = { serverId: info.serverId, frozen, tables: {} };
    await atomicJson(join(destination, "progress", "state.json"), progress);
  }
  const deadline = Date.now() + 180_000;
  while (true) {
    const state = (await (
      await request("/api/ops/state")
    ).json()) as MaintenanceState;
    if (state.state !== "frozen" || state.epoch !== progress.frozen.epoch)
      throw new Error("The frozen backup generation changed.");
    if (!state.activeWrites) {
      progress.frozen = state;
      break;
    }
    if (Date.now() > deadline)
      throw new Error(
        "Admitted writes have not drained. Keep the source frozen and investigate the retained leases.",
      );
    input.onProgress?.(`Waiting for ${state.activeWrites} admitted writes.`);
    await pause(1000);
  }
  const epoch = encodeURIComponent(progress.frozen.epoch);
  for (const table of backupTables) {
    const saved = progress.tables[table];
    if (saved) {
      const actual = await fileHash(join(destination, saved.file));
      if (actual.bytes !== saved.bytes || actual.sha256 !== saved.sha256)
        throw new Error("A retained backup table differs from its receipt.");
      continue;
    }
    const filename = `${table}.ndjson`,
      temporary = join(destination, filename + ".tmp");
    const file = await open(temporary, "w", 0o600),
      digest = createHash("sha256");
    let after = 0,
      bytes = 0,
      rows = 0;
    try {
      while (true) {
        const page = (await (
          await request(
            `/api/ops/export/metadata?table=${table}&epoch=${epoch}&after=${after}`,
          )
        ).json()) as { rows: Record<string, unknown>[]; next: number | null };
        if (!page.rows.length) break;
        if (!Number.isSafeInteger(page.next) || page.next! <= after)
          throw new Error("Invalid metadata export cursor.");
        for (const entry of page.rows) {
          const { __cursor__: _cursor, ...row } = entry;
          const line = JSON.stringify(row) + "\n";
          digest.update(line);
          bytes += Buffer.byteLength(line);
          rows++;
          await file.writeFile(line);
        }
        after = page.next!;
      }
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(destination, filename));
    progress.tables[table] = {
      file: filename,
      bytes,
      rows,
      sha256: digest.digest("hex"),
    };
    await atomicJson(join(destination, "progress", "state.json"), progress);
    input.onProgress?.(`Exported ${table}: ${rows} rows.`);
  }
  const inventoryFile = "inventory.ndjson",
    inventoryTemporary = join(destination, inventoryFile + ".tmp");
  const inventory = await open(inventoryTemporary, "w", 0o600),
    inventoryDigest = createHash("sha256");
  let cursor: string | undefined,
    count = 0,
    inventoryBytes = 0;
  try {
    do {
      const page = (await (
        await request(
          `/api/ops/export/inventory?epoch=${epoch}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
        )
      ).json()) as { objects: Omit<ObjectReceipt, "sha256">[]; next?: string };
      for (const item of page.objects) {
        if (
          !operationObjectKey(item.key) ||
          !Number.isSafeInteger(item.bytes) ||
          item.bytes < 0 ||
          item.bytes > 64 * 1024 * 1024
        )
          throw new Error("Invalid backup object inventory.");
        const path = join(destination, "objects", item.key),
          receiptPath = join(
            destination,
            "progress",
            "objects",
            hash(item.key) + ".json",
          );
        let receipt: ObjectReceipt;
        const retained = await readFile(receiptPath, "utf8").catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (retained) {
          receipt = JSON.parse(retained);
          const verified = await fileHash(path);
          if (
            receipt.key !== item.key ||
            receipt.bytes !== item.bytes ||
            receipt.uploadedAt !== item.uploadedAt ||
            verified.bytes !== receipt.bytes ||
            verified.sha256 !== receipt.sha256
          )
            throw new Error("Retained object backup failed verification.");
        } else {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          const response = await request(
            `/api/ops/export/object?epoch=${epoch}&key=${encodeURIComponent(item.key)}`,
          );
          if (!response.body) throw new Error("Missing object export stream.");
          const file = await open(path + ".partial", "w", 0o600),
            digest = createHash("sha256");
          let bytes = 0;
          try {
            for await (const block of response.body as unknown as AsyncIterable<Uint8Array>) {
              bytes += block.byteLength;
              if (bytes > item.bytes)
                throw new Error(
                  "Exported object exceeds its advertised length.",
                );
              digest.update(block);
              await file.writeFile(block);
            }
            if (bytes !== item.bytes)
              throw new Error("Incomplete object export.");
            await file.sync();
          } finally {
            await file.close();
          }
          await rename(path + ".partial", path);
          receipt = { ...item, sha256: digest.digest("hex") };
          await atomicJson(receiptPath, receipt);
        }
        const line = JSON.stringify(receipt) + "\n";
        inventoryDigest.update(line);
        inventoryBytes += Buffer.byteLength(line);
        count++;
        await inventory.writeFile(line);
        if (count > 1_000_000)
          throw new Error(
            "Backup exceeds the explicit one-million-object bound.",
          );
      }
      if (page.next && page.next === cursor)
        throw new Error("Object inventory cursor did not advance.");
      cursor = page.next;
    } while (cursor);
    await inventory.sync();
  } finally {
    await inventory.close();
  }
  await rename(inventoryTemporary, join(destination, inventoryFile));
  const final = (await (
    await request("/api/ops/state")
  ).json()) as MaintenanceState;
  if (
    final.state !== "frozen" ||
    final.epoch !== progress.frozen.epoch ||
    final.activeWrites
  )
    throw new Error("The source changed during backup.");
  const descriptor: BackupDescriptor = {
    format: "showai-server-backup-v1",
    schemaVersion,
    serverId: progress.serverId,
    frozen: final,
    tables: progress.tables,
    inventory: {
      file: inventoryFile,
      bytes: inventoryBytes,
      rows: count,
      sha256: inventoryDigest.digest("hex"),
    },
    completedAt: new Date().toISOString(),
  };
  await atomicJson(join(destination, "backup.json"), descriptor);
  return verifyServerBackup(destination);
}
export async function readBackupDescriptor(
  root: string,
): Promise<BackupDescriptor> {
  const descriptor = JSON.parse(
    await readFile(join(root, "backup.json"), "utf8"),
  ) as BackupDescriptor;
  if (
    descriptor.format !== "showai-server-backup-v1" ||
    descriptor.schemaVersion !== schemaVersion ||
    descriptor.frozen?.state !== "frozen" ||
    descriptor.frozen.activeWrites !== 0
  )
    throw new Error("Unsupported or incomplete server backup.");
  for (const table of backupTables) {
    const receipt = descriptor.tables[table];
    if (
      receipt?.file !== `${table}.ndjson` ||
      !hexadecimal.test(receipt.sha256)
    )
      throw new Error("Invalid table receipt.");
    const actual = await fileHash(join(root, receipt.file));
    if (actual.bytes !== receipt.bytes || actual.sha256 !== receipt.sha256)
      throw new Error("Backup metadata digest mismatch.");
  }
  if (
    descriptor.inventory.file !== "inventory.ndjson" ||
    !hexadecimal.test(descriptor.inventory.sha256)
  )
    throw new Error("Invalid inventory receipt.");
  const actual = await fileHash(join(root, "inventory.ndjson"));
  if (
    actual.bytes !== descriptor.inventory.bytes ||
    actual.sha256 !== descriptor.inventory.sha256
  )
    throw new Error("Backup inventory digest mismatch.");
  return descriptor;
}
export async function loadBackupMetadata(
  root: string,
  db: SQLiteMetadata,
  descriptor: BackupDescriptor,
) {
  await prepareMetadata(db, true);
  await db.batch(
    [...backupTables]
      .reverse()
      .map((table) => ({ sql: `DELETE FROM ${table}` })),
  );
  for (const table of backupTables) {
    const columns = (
      await db.all<{ name: string }>(`PRAGMA table_info(${table})`)
    ).map((item) => item.name);
    let pending: SqlStatement[] = [],
      rows = 0;
    for await (const row of jsonLines(join(root, `${table}.ndjson`))) {
      if (
        Object.keys(row).length !== columns.length ||
        columns.some(
          (key) =>
            !(key in row) ||
            (row[key] !== null &&
              !["string", "number"].includes(typeof row[key])),
        )
      )
        throw new Error(
          "Backup row does not match the current metadata schema.",
        );
      pending.push({
        sql: `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        values: columns.map((key) => row[key] as SqlValue),
      });
      rows++;
      if (pending.length === 100) {
        await db.batch(pending);
        pending = [];
      }
    }
    if (pending.length) await db.batch(pending);
    if (rows !== descriptor.tables[table].rows)
      throw new Error("Backup table count mismatch.");
  }
  if ((await db.all("PRAGMA foreign_key_check")).length)
    throw new Error("Backup foreign key verification failed.");
  const id = (
    await db.all<{ value: string }>(
      "SELECT value FROM settings WHERE key='server_id'",
    )
  )[0]?.value;
  if (id !== descriptor.serverId)
    throw new Error("Backup server identity mismatch.");
  const maintenance = await new ServerMaintenance(
    db,
    new DiskObjects(join(root, "objects")),
  ).frozen(descriptor.frozen.epoch);
  if (maintenance.activeWrites)
    throw new Error("Backup contains admitted writes.");
}
async function verifyContent(
  root: string,
  db: SQLiteMetadata,
  descriptor: BackupDescriptor,
  objectsRoot = join(root, "objects"),
) {
  await db.run(
    "CREATE TEMP TABLE backup_inventory(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL,digest TEXT NOT NULL)",
  );
  let objects = 0,
    bytes = 0;
  for await (const entry of jsonLines(join(root, "inventory.ndjson"))) {
    const item = entry as unknown as ObjectReceipt;
    if (
      !operationObjectKey(item.key) ||
      !hexadecimal.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0
    )
      throw new Error("Invalid object receipt.");
    const actual = await fileHash(join(objectsRoot, item.key));
    if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256)
      throw new Error("Backup object digest mismatch.");
    await db.run("INSERT INTO backup_inventory VALUES(?,?,?)", [
      item.key,
      item.bytes,
      item.sha256,
    ]);
    objects++;
    bytes += item.bytes;
  }
  if (objects !== descriptor.inventory.rows)
    throw new Error("Backup object count mismatch.");
  if (
    (
      await db.all(
        "SELECT o.project_id,o.digest FROM objects o LEFT JOIN backup_inventory b ON b.key='projects/'||o.project_id||'/objects/'||o.digest WHERE b.key IS NULL OR b.bytes!=o.bytes OR b.digest!=o.digest LIMIT 1",
      )
    ).length
  )
    throw new Error("A ready object is absent or corrupt in the backup.");
  if (
    (
      await db.all(
        "SELECT p.id FROM projects p LEFT JOIN revisions r ON r.project_id=p.id AND r.revision=p.head WHERE p.head IS NOT NULL AND r.revision IS NULL LIMIT 1",
      )
    ).length
  )
    throw new Error("A project head is absent from its history.");
  if (
    (
      await db.all(
        "SELECT u.id FROM object_uploads u JOIN object_upload_parts p ON p.upload_id=u.id LEFT JOIN backup_inventory b ON b.key='projects/'||u.project_id||'/uploads/'||u.id||'/parts/'||p.digest WHERE u.completed=0 AND (b.key IS NULL OR b.digest!=p.digest OR b.bytes!=p.bytes) LIMIT 1",
      )
    ).length
  )
    throw new Error("A retained upload part is absent or corrupt.");
  if (
    (
      await db.all(
        "SELECT p.upload_id FROM object_upload_parts p LEFT JOIN object_uploads u ON u.id=p.upload_id WHERE u.id IS NULL LIMIT 1",
      )
    ).length
  )
    throw new Error("An upload part has no retained task.");
  if (
    (
      await db.all(
        "SELECT u.id FROM object_uploads u LEFT JOIN storage_reservations s ON s.id=u.reservation_id WHERE u.completed=0 AND (s.id IS NULL OR s.project_id!=u.project_id OR s.user_id!=u.user_id OR s.kind!='object' OR s.digest!=u.digest OR s.bytes!=u.bytes) LIMIT 1",
      )
    ).length
  )
    throw new Error(
      "An unfinished upload lost its matching quota reservation.",
    );
  if (
    (
      await db.all(
        "SELECT s.id FROM storage_reservations s LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN users u ON u.id=s.user_id WHERE p.id IS NULL OR u.id IS NULL OR s.kind NOT IN('object','manifest') LIMIT 1",
      )
    ).length
  )
    throw new Error(
      "A quota reservation lost its project or account identity.",
    );
  const store = new DiskObjects(objectsRoot),
    revisions = new Revisions(db, store);
  let cursor = 0,
    history = 0;
  while (true) {
    const rows = await db.all<{
      cursor: number;
      project_id: string;
      revision: string;
      sequence: number;
    }>(
      "SELECT rowid AS cursor,project_id,revision,sequence FROM revisions WHERE rowid>? ORDER BY rowid LIMIT 100",
      [cursor],
    );
    if (!rows.length) break;
    for (const row of rows) {
      const source = await revisions.row(row.project_id, row.revision);
      if (!source) throw new Error("Revision source account is absent.");
      const snapshot = await revisions.snapshot(row.project_id, source);
      validateSnapshot(snapshot, row.project_id);
      for (const parent of snapshot.parents) {
        const older = await db.all<{ sequence: number }>(
          "SELECT sequence FROM revisions WHERE project_id=? AND revision=?",
          [row.project_id, parent],
        );
        if (!older[0] || older[0].sequence >= row.sequence)
          throw new Error(
            "Backup history parent graph is incomplete or out of order.",
          );
      }
      const digests = [...new Set(Object.values(snapshot.files))];
      for (let offset = 0; offset < digests.length; offset += 500) {
        const page = digests.slice(offset, offset + 500);
        if (
          (
            await db.all(
              `SELECT digest FROM objects WHERE project_id=? AND digest IN(${page.map(() => "?").join(",")})`,
              [row.project_id, ...page],
            )
          ).length !== page.length
        )
          throw new Error(
            "A historical file reference is absent from its project object set.",
          );
      }
      const read = async (path: string) => {
        const data = await store.get(
          `projects/${row.project_id}/objects/${snapshot.files[path]}`,
        );
        if (!data) throw new Error("Missing backup dependency.");
        return data;
      };
      await validateReaderClosure(
        Object.keys(snapshot.files),
        row.project_id,
        read,
      );
      await validatePackageClosure(
        Object.keys(snapshot.files),
        row.project_id,
        read,
      );
      cursor = row.cursor;
      history++;
    }
  }
  await db.run("DROP TABLE backup_inventory");
  return {
    serverId: descriptor.serverId,
    schemaVersion,
    objects,
    bytes,
    revisions: history,
    users: descriptor.tables.users.rows,
    sessions: descriptor.tables.sessions.rows,
    projects: descriptor.tables.projects.rows,
    frozen: true,
  };
}
export async function verifyServerBackup(root: string) {
  const descriptor = await readBackupDescriptor(root),
    temporary = join(tmpdir(), `showai-backup-verify-${crypto.randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  const db = new SQLiteMetadata(join(temporary, "metadata.sqlite"));
  try {
    await loadBackupMetadata(root, db, descriptor);
    return await verifyContent(root, db, descriptor);
  } finally {
    db.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function restoreServerBackup(input: {
  backup: string;
  home: string;
}) {
  if (!isAbsolute(input.home) || !isAbsolute(input.backup))
    throw new Error("Restore paths must be absolute.");
  const existing = await lstat(input.home).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (existing)
    throw new Error(
      "Restore requires a new destination; existing server data will not be overwritten.",
    );
  const descriptor = await readBackupDescriptor(input.backup);
  await verifyServerBackup(input.backup);
  const staging = input.home + ".restore-" + crypto.randomUUID();
  await mkdir(staging, { mode: 0o700 });
  const db = new SQLiteMetadata(join(staging, "metadata.sqlite")),
    store = new DiskObjects(join(staging, "objects"));
  try {
    await loadBackupMetadata(input.backup, db, descriptor);
    for await (const entry of jsonLines(
      join(input.backup, "inventory.ndjson"),
    )) {
      const item = entry as unknown as ObjectReceipt;
      await store.putVerified(
        item.key,
        Readable.toWeb(
          createReadStream(join(input.backup, "objects", item.key), {
            highWaterMark: 64 * 1024,
          }),
        ) as ReadableStream<Uint8Array>,
        item.sha256,
        item.bytes,
      );
      await utimes(
        join(staging, "objects", item.key),
        new Date(item.uploadedAt),
        new Date(item.uploadedAt),
      );
    }
    await db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  const verifyDb = new SQLiteMetadata(join(staging, "metadata.sqlite"));
  try {
    // Reuse the original receipts against the copied tree, without altering its tables.
    await verifyContent(
      input.backup,
      verifyDb,
      descriptor,
      join(staging, "objects"),
    );
  } finally {
    verifyDb.close();
  }
  await rename(staging, input.home);
  return {
    serverId: descriptor.serverId,
    home: input.home,
    frozen: true,
    epoch: descriptor.frozen.epoch,
  };
}
