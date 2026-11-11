import { open, type FileHandle } from "node:fs/promises";
import { inflateSync } from "fflate";

// A zip reader that seeks: it reads the central directory once and then each
// entry on demand, so a large export is never held in memory as a whole.
// Stored (0) and deflated (8) entries are supported, including Zip64.

export interface ZipEntry {
  path: string;
  size: number;
  compressedSize: number;
  method: number;
  offset: number;
  directory: boolean;
}

/** Bytes at a position of a file on disk or of a buffer in memory. */
export interface RandomAccess {
  size: number;
  read(position: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export async function fileAccess(path: string): Promise<RandomAccess> {
  const handle: FileHandle = await open(path, "r");
  const { size } = await handle.stat();
  return {
    size,
    async read(position, length) {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead !== length)
        throw new Error(`The zip file ended before byte ${position + length}.`);
      return buffer;
    },
    close: () => handle.close(),
  };
}

export function bufferAccess(bytes: Uint8Array): RandomAccess {
  return {
    size: bytes.length,
    async read(position, length) {
      if (position + length > bytes.length)
        throw new Error(`The zip data ended before byte ${position + length}.`);
      return bytes.subarray(position, position + length);
    },
    close: async () => {},
  };
}

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u64 = (data: DataView, at: number) => Number(data.getBigUint64(at, true));

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  // Without the UTF-8 flag most archivers still write UTF-8; fall back to
  // Latin-1 only when the bytes are not valid UTF-8.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

/** The entries of a zip archive, from its central directory. */
export async function zipEntries(access: RandomAccess): Promise<ZipEntry[]> {
  const tail = Math.min(access.size, 65557);
  const end = await access.read(access.size - tail, tail);
  let eocd = -1;
  for (let index = end.length - 22; index >= 0; index--)
    if (view(end).getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  if (eocd < 0)
    throw new Error("Not a zip archive (no end of central directory).");
  const record = view(end);
  let count = record.getUint16(eocd + 10, true);
  let directorySize = record.getUint32(eocd + 12, true);
  let directoryOffset = record.getUint32(eocd + 16, true);
  if (
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    const locatorAt = access.size - tail + eocd - 20;
    const locator = view(await access.read(locatorAt, 20));
    if (locator.getUint32(0, true) !== 0x07064b50)
      throw new Error("The Zip64 end of central directory locator is missing.");
    const zip64 = view(await access.read(u64(locator, 8), 56));
    if (zip64.getUint32(0, true) !== 0x06064b50)
      throw new Error("The Zip64 end of central directory is missing.");
    count = u64(zip64, 32);
    directorySize = u64(zip64, 40);
    directoryOffset = u64(zip64, 48);
  }
  const directory = view(await access.read(directoryOffset, directorySize));
  const bytes = new Uint8Array(
    directory.buffer,
    directory.byteOffset,
    directory.byteLength,
  );
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (directory.getUint32(at, true) !== 0x02014b50)
      throw new Error(`Zip central directory entry ${index + 1} is damaged.`);
    const flags = directory.getUint16(at + 8, true);
    const method = directory.getUint16(at + 10, true);
    let compressedSize = directory.getUint32(at + 20, true);
    let size = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let offset = directory.getUint32(at + 42, true);
    const name = decodeName(
      bytes.subarray(at + 46, at + 46 + nameLength),
      (flags & 0x800) !== 0,
    );
    // Zip64 extra field: the 0xffffffff values follow in this order.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = u64(directory, field);
          field += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(directory, field);
          field += 8;
        }
        if (offset === 0xffffffff) offset = u64(directory, field);
      }
      extra += 4 + length;
    }
    if (flags & 1)
      throw new Error(`${name} is encrypted; export it without a password.`);
    const path = name.replaceAll("\\", "/");
    entries.push({
      path,
      size,
      compressedSize,
      method,
      offset,
      directory: path.endsWith("/"),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The uncompressed bytes of one entry. */
export async function readZipEntry(
  access: RandomAccess,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const header = view(await access.read(entry.offset, 30));
  if (header.getUint32(0, true) !== 0x04034b50)
    throw new Error(`The local header of ${entry.path} is damaged.`);
  const start =
    entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = await access.read(start, entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8)
    throw new Error(
      `${entry.path} uses compression method ${entry.method}; only stored and deflated entries can be read.`,
    );
  const inflated = inflateSync(data, { out: new Uint8Array(entry.size) });
  if (inflated.length !== entry.size)
    throw new Error(`${entry.path} did not decompress to its recorded size.`);
  return inflated;
}
