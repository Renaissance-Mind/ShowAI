import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ImportFile, ImportInput, ImportWarning } from "./types";
import {
  bufferAccess,
  fileAccess,
  readZipEntry,
  zipEntries,
  type RandomAccess,
} from "./zip";

/** Most files one input may list, and the largest single file read. */
export const INPUT_LIMITS = {
  files: 100_000,
  fileBytes: 512 * 1024 * 1024,
  nestedZipBytes: 2 * 1024 * 1024 * 1024 - 1,
  nestedDepth: 3,
};

const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

function cleanPath(path: string): string | undefined {
  const parts = path.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === "..")) return undefined;
  return parts.join("/");
}

function file(
  path: string,
  size: number,
  read: () => Promise<Uint8Array>,
): ImportFile {
  return {
    path,
    size,
    bytes: read,
    text: async () => {
      const text = new TextDecoder("utf-8").decode(await read());
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    },
  };
}

function tooLarge(path: string, size: number) {
  if (size > INPUT_LIMITS.fileBytes)
    throw new Error(
      `${path} has ${size} bytes; one imported file holds at most ${INPUT_LIMITS.fileBytes} bytes.`,
    );
}

/** The files of a zip, with nested zips (e.g. Notion's Part-1.zip) expanded in place. */
async function zipFiles(
  access: RandomAccess,
  prefix: string,
  depth: number,
  files: ImportFile[],
  problems: ImportWarning[],
  opened: RandomAccess[],
): Promise<void> {
  for (const entry of await zipEntries(access)) {
    if (entry.directory || IGNORED.test(entry.path)) continue;
    const path = cleanPath(`${prefix}${entry.path}`);
    if (!path) {
      problems.push({
        source: entry.path,
        message: "Skipped: the path leaves the archive.",
      });
      continue;
    }
    if (/\.zip$/i.test(path) && depth < INPUT_LIMITS.nestedDepth) {
      if (entry.size > INPUT_LIMITS.nestedZipBytes) {
        problems.push({
          source: path,
          message: `Skipped: the nested archive has ${entry.size} bytes; unpack it and import the folder.`,
        });
        continue;
      }
      const inner = bufferAccess(await readZipEntry(access, entry));
      const folder = path.includes("/") ? path.replace(/[^/]+$/, "") : "";
      try {
        await zipFiles(inner, folder, depth + 1, files, problems, opened);
      } catch (error) {
        problems.push({
          source: path,
          message: `Kept as a file: ${error instanceof Error ? error.message : String(error)}`,
        });
        files.push(file(path, entry.size, () => readZipEntry(access, entry)));
      }
      continue;
    }
    if (files.length >= INPUT_LIMITS.files)
      throw new Error(
        `The input lists more than ${INPUT_LIMITS.files} files; import it in parts.`,
      );
    files.push(
      file(path, entry.size, () => {
        tooLarge(path, entry.size);
        return readZipEntry(access, entry);
      }),
    );
  }
}

async function folderFiles(
  root: string,
  relative: string,
  files: ImportFile[],
): Promise<void> {
  const names = await readdir(join(root, relative));
  names.sort();
  for (const name of names) {
    const path = relative ? `${relative}/${name}` : name;
    if (IGNORED.test(path) || name.startsWith(".")) continue;
    const absolute = join(root, path);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) await folderFiles(root, path, files);
    else if (info.isFile()) {
      if (files.length >= INPUT_LIMITS.files)
        throw new Error(
          `The folder holds more than ${INPUT_LIMITS.files} files; import it in parts.`,
        );
      files.push(
        file(path, info.size, async () => {
          tooLarge(path, info.size);
          return new Uint8Array(await readFile(absolute));
        }),
      );
    }
  }
}

export interface OpenedInput extends ImportInput {
  close(): Promise<void>;
}

/** Opens a file, a folder or a zip on this device as an import input. */
export async function openImportPath(path: string): Promise<OpenedInput> {
  const info = await lstat(path);
  const name = basename(path);
  const problems: ImportWarning[] = [];
  const files: ImportFile[] = [];
  if (info.isDirectory()) {
    await folderFiles(path, "", files);
    return { name, kind: "folder", files, problems, close: async () => {} };
  }
  if (!info.isFile()) throw new Error(`${path} is not a file or a folder.`);
  if (/\.zip$/i.test(name)) {
    const access = await fileAccess(path);
    const opened = [access];
    try {
      await zipFiles(access, "", 0, files, problems, opened);
    } catch (error) {
      await access.close();
      throw error;
    }
    return {
      name,
      kind: "zip",
      files,
      problems,
      close: async () => {
        for (const item of opened) await item.close();
      },
    };
  }
  files.push(
    file(name, info.size, async () => {
      tooLarge(name, info.size);
      return new Uint8Array(await readFile(path));
    }),
  );
  return { name, kind: "file", files, problems, close: async () => {} };
}

/** Files handed over without a device path (e.g. dropped in a browser). */
export async function openImportFiles(
  items: { name: string; bytes: Uint8Array }[],
): Promise<OpenedInput> {
  if (items.length === 1 && /\.zip$/i.test(items[0].name)) {
    const files: ImportFile[] = [];
    const problems: ImportWarning[] = [];
    await zipFiles(bufferAccess(items[0].bytes), "", 0, files, problems, []);
    return {
      name: items[0].name,
      kind: "zip",
      files,
      problems,
      close: async () => {},
    };
  }
  return {
    name: items[0]?.name ?? "",
    kind: items.length === 1 ? "file" : "files",
    files: items.map((item) => {
      const path = cleanPath(item.name.replaceAll("\\", "/")) ?? "file";
      return file(path, item.bytes.length, async () => item.bytes);
    }),
    problems: [],
    close: async () => {},
  };
}
