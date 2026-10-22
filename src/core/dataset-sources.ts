import { randomUUID } from "node:crypto";
import { chmod, open, rm, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { atomicRename } from "./atomic-rename";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { CoreError } from "./model";

// A dataset can keep its value in a file outside the content library. The
// library stores only the dataset's description and `source` (format and file
// name, synchronized with the project); the absolute path is linked per device
// in local/dataset-sources.json, so a shared project never makes another
// device read files it did not choose, and each device links its own copy.

export const SOURCE_FORMATS = ["json", "csv", "tsv"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/** The synchronized part of an external source, stored in the dataset file. */
export interface DatasetSource {
  kind: "file";
  format: SourceFormat;
  /** File name when it was linked; a hint for linking on another device. */
  name?: string;
}

/** What a read of the linked file found, carried by the dataset record. */
export interface ExternalFileState {
  path: string;
  format: SourceFormat;
  bytes: number;
  modifiedAt: string;
}

interface SourceLink {
  path: string;
  linkedAt: string;
}
interface SourceRegistry {
  format: "showai-dataset-sources";
  version: 1;
  links: Record<string, SourceLink>;
}

const key = (projectId: string, datasetId: string) =>
  `${projectId}/${datasetId}`;

function registryPath(home: string) {
  return join(home, "local", "dataset-sources.json");
}

export function isDatasetSource(value: unknown): value is DatasetSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    source.kind === "file" &&
    SOURCE_FORMATS.includes(source.format as SourceFormat) &&
    (source.name === undefined ||
      (typeof source.name === "string" && source.name.length <= 255)) &&
    Object.keys(source).every((name) =>
      ["kind", "format", "name"].includes(name),
    )
  );
}

/** The format a file name implies, or the explicit one. */
export function sourceFormat(path: string, format?: unknown): SourceFormat {
  if (format !== undefined) {
    if (!SOURCE_FORMATS.includes(format as SourceFormat))
      throw new CoreError(
        "INVALID_DATA",
        `An external dataset file is ${SOURCE_FORMATS.join(", ")}.`,
      );
    return format as SourceFormat;
  }
  const extension = extname(path).slice(1).toLowerCase();
  if (SOURCE_FORMATS.includes(extension as SourceFormat))
    return extension as SourceFormat;
  throw new CoreError(
    "INVALID_DATA",
    `Cannot tell the format of ${basename(path)}; name a .json, .csv or .tsv file or pass format.`,
  );
}

function inside(root: string, target: string) {
  const path = relative(root, target);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

/** An absolute file path outside the content library. */
export function externalPath(home: string, path: unknown): string {
  if (typeof path !== "string" || !path.trim() || path.length > 4096)
    throw new CoreError("INVALID_PATH", "Give the external file's path.");
  if (!isAbsolute(path))
    throw new CoreError(
      "INVALID_PATH",
      "An external dataset file needs an absolute path.",
    );
  const resolved = resolve(path);
  if (inside(resolve(home), resolved))
    throw new CoreError(
      "INVALID_PATH",
      "This file is inside the content library. Keep the data in the dataset itself, or choose a file outside the library.",
    );
  return resolved;
}

export class DatasetSourceLinks {
  constructor(readonly home: string) {}

  private async registry(): Promise<SourceRegistry> {
    const bytes = await readLibraryBytes(this.home, registryPath(this.home));
    if (!bytes)
      return { format: "showai-dataset-sources", version: 1, links: {} };
    const value = JSON.parse(bytes.toString()) as SourceRegistry;
    if (
      value?.format !== "showai-dataset-sources" ||
      value.version !== 1 ||
      !value.links ||
      typeof value.links !== "object"
    )
      throw new CoreError("INVALID_DATA", "Invalid dataset source links.");
    return value;
  }

  async get(projectId: string, datasetId: string): Promise<string | undefined> {
    return (await this.registry()).links[key(projectId, datasetId)]?.path;
  }

  /** Every linked file of this device, by dataset key ("project/dataset"). */
  async all(): Promise<Map<string, string>> {
    return new Map(
      Object.entries((await this.registry()).links).map(([name, link]) => [
        name,
        link.path,
      ]),
    );
  }

  async set(projectId: string, datasetId: string, path: string | null) {
    const registry = await this.registry();
    const name = key(projectId, datasetId);
    if (path === null) {
      if (!(name in registry.links)) return;
      delete registry.links[name];
    } else registry.links[name] = { path, linkedAt: new Date().toISOString() };
    await atomicLibraryFile(
      this.home,
      registryPath(this.home),
      Buffer.from(`${JSON.stringify(registry, null, 2)}\n`),
    );
  }
}

// ---------------------------------------------------------------------------
// File formats

/** How the file was written, so a write keeps its layout. */
export interface FileLayout {
  indent: string | number;
  newline: "\n" | "\r\n";
  finalNewline: boolean;
  bom: boolean;
}

const DEFAULT_LAYOUT: FileLayout = {
  indent: 2,
  newline: "\n",
  finalNewline: true,
  bom: false,
};

function layoutOf(text: string): FileLayout {
  const bom = text.startsWith("﻿");
  const body = bom ? text.slice(1) : text;
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const indented = body.match(/^[[{][ \t]*\r?\n([ \t]+)\S/);
  return {
    bom,
    newline,
    finalNewline: /\n$/.test(body),
    indent: indented ? indented[1] : body.trim().includes("\n") ? 2 : 0,
  };
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Cells that read back to the same text become numbers or booleans. */
function cellValue(text: string): string | number | boolean {
  if (text === "true") return true;
  if (text === "false") return false;
  if (NUMBER.test(text) && String(Number(text)) === text) return Number(text);
  return text;
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = false;
      } else cell += character;
      continue;
    }
    if (character === '"' && !cell) {
      quoted = true;
      started = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
      started = true;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      started = false;
    } else {
      cell += character;
      started = true;
    }
  }
  if (quoted)
    throw new CoreError("INVALID_DATA", "The file has an unclosed quote.");
  if (started || cell) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseTable(text: string, delimiter: string) {
  const [header, ...lines] = parseDelimited(text, delimiter);
  if (!header?.length || header.every((name) => !name))
    throw new CoreError(
      "INVALID_DATA",
      "The first row of a table file names its columns.",
    );
  const columns = header.map((name) => name.trim());
  const seen = new Set<string>();
  for (const name of columns) {
    if (!name)
      throw new CoreError("INVALID_DATA", "Every column needs a name.");
    if (seen.has(name))
      throw new CoreError("INVALID_DATA", `Column ${name} appears twice.`);
    if (["__proto__", "constructor", "prototype"].includes(name))
      throw new CoreError("INVALID_DATA", `A column cannot be named ${name}.`);
    seen.add(name);
  }
  const rows = lines
    .filter((line) => !(line.length === 1 && line[0] === ""))
    .map((line, index) => {
      if (line.length > columns.length)
        throw new CoreError(
          "INVALID_DATA",
          `Row ${index + 2} has more cells than the header.`,
        );
      return Object.fromEntries(
        columns.map((name, column) => [name, cellValue(line[column] ?? "")]),
      );
    });
  return { columns, rows };
}

function cellText(value: unknown, column: string, delimiter: string): string {
  if (value === undefined || value === null) return "";
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  )
    throw new CoreError(
      "INVALID_DATA",
      `Column ${column} holds ${Array.isArray(value) ? "a list" : "an object"}; a table file's cells hold text, numbers or true/false.`,
    );
  const text = String(value);
  return text.includes(delimiter) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function serializeTable(
  value: unknown,
  delimiter: string,
  layout: FileLayout,
): string {
  const table = value as { columns?: unknown; rows?: unknown };
  if (
    !table ||
    typeof table !== "object" ||
    Array.isArray(table) ||
    !Array.isArray(table.rows) ||
    (table.columns !== undefined && !Array.isArray(table.columns)) ||
    Object.keys(table).some((name) => !["columns", "rows"].includes(name))
  )
    throw new CoreError(
      "INVALID_DATA",
      "A table file holds { columns, rows }: rows is a list of objects keyed by column.",
    );
  const columns = (table.columns ?? []).map(String);
  for (const row of table.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new CoreError(
        "INVALID_DATA",
        "Each row of a table file is an object keyed by column.",
      );
    for (const name of Object.keys(row))
      if (!columns.includes(name)) columns.push(name);
  }
  if (!columns.length)
    throw new CoreError("INVALID_DATA", "A table file needs a column.");
  const lines = [
    columns.map((name) => cellText(name, name, delimiter)).join(delimiter),
    ...(table.rows as Record<string, unknown>[]).map((row) =>
      columns
        .map((name) => cellText(row[name], name, delimiter))
        .join(delimiter),
    ),
  ];
  return (
    lines.join(layout.newline) + (layout.finalNewline ? layout.newline : "")
  );
}

export function parseSource(
  text: string,
  format: SourceFormat,
): { value: unknown; layout: FileLayout } {
  const layout = layoutOf(text);
  const body = layout.bom ? text.slice(1) : text;
  if (format === "json") {
    try {
      return { value: JSON.parse(body), layout };
    } catch (error) {
      // JSON.parse quotes the file's text; report only the position.
      const position = String(
        error instanceof Error ? error.message : error,
      ).match(/position \d+(?: \(line \d+ column \d+\))?/);
      throw new CoreError(
        "INVALID_DATA",
        `The file is not valid JSON${position ? ` at ${position[0]}` : ""}.`,
      );
    }
  }
  return {
    value: parseTable(body, format === "tsv" ? "\t" : ","),
    layout: { ...layout, indent: 0 },
  };
}

export function serializeSource(
  value: unknown,
  format: SourceFormat,
  layout: FileLayout = DEFAULT_LAYOUT,
): string {
  const text =
    format === "json"
      ? JSON.stringify(value, null, layout.indent).replace(
          /\n/g,
          layout.newline,
        ) + (layout.finalNewline ? layout.newline : "")
      : serializeTable(value, format === "tsv" ? "\t" : ",", layout);
  return layout.bom ? `﻿${text}` : text;
}

// ---------------------------------------------------------------------------
// Reading and writing the linked file

export interface ExternalRead {
  value: unknown;
  layout: FileLayout;
  state: ExternalFileState;
  /** Identity of the version read, checked again before a write replaces it. */
  stamp: string;
}

const stampOf = (info: { size: number; mtimeMs: number; ino: number }) =>
  `${info.ino}:${info.size}:${info.mtimeMs}`;

export async function readExternal(
  path: string,
  format: SourceFormat,
  limit: number,
): Promise<ExternalRead> {
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    if (!before.isFile())
      throw new CoreError("INVALID_PATH", `${path} is not a file.`);
    if (before.size > limit)
      throw new CoreError(
        "INVALID_DATA",
        `${basename(path)} is ${before.size} bytes; a dataset holds at most ${limit} bytes.`,
      );
    const text = await file.readFile("utf8");
    const after = await file.stat();
    if (stampOf(before) !== stampOf(after))
      throw new CoreError(
        "CONFLICT",
        `${basename(path)} is still being written. Retry when it finishes.`,
      );
    const { value, layout } = parseSource(text, format);
    return {
      value,
      layout,
      stamp: stampOf(after),
      state: {
        path,
        format,
        bytes: after.size,
        modifiedAt: after.mtime.toISOString(),
      },
    };
  } finally {
    await file.close();
  }
}

/**
 * Replaces the linked file atomically, keeping its permissions. `expected`
 * is the version the write started from; a file changed since is not
 * overwritten.
 */
export async function writeExternal(
  path: string,
  text: string,
  expected: string | null,
): Promise<void> {
  const current = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (expected === null ? current : !current || stampOf(current) !== expected)
    throw new CoreError(
      "CONFLICT",
      current
        ? `${basename(path)} changed outside ShowAI since it was read. Nothing was written; read the dataset again.`
        : `${basename(path)} was removed since it was read. Nothing was written.`,
    );
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  const file = await open(
    temporary,
    "wx",
    current ? current.mode & 0o777 : 0o644,
  );
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    if (current) await chmod(temporary, current.mode & 0o777);
    await atomicRename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Readable text of a file system error, without the file's contents. */
export function fileProblem(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return "the file does not exist";
  if (code === "EACCES" || code === "EPERM") return "permission denied";
  if (code === "EISDIR") return "it is a directory";
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Watching linked files

/**
 * Reports changes of this device's linked files (and of the links
 * themselves) as dataset keys, so open windows refresh bound blocks.
 */
export function watchDatasetSources(
  home: string,
  onChange: (datasets: string[]) => void,
): { close: () => Promise<void> } {
  const links = new DatasetSourceLinks(home);
  let byPath = new Map<string, Set<string>>();
  let watched = new Map<string, string>();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();
  const flush = () => {
    timer = undefined;
    if (closed || !pending.size) return;
    const keys = [...pending];
    pending.clear();
    onChange(keys);
  };
  const queue = (keys: Iterable<string>) => {
    for (const name of keys) pending.add(name);
    timer ??= setTimeout(flush, 180);
  };
  const watcher: FSWatcher = watch(registryPath(home), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });
  const reload = async () => {
    const next = await links.all();
    const paths = new Map<string, Set<string>>();
    for (const [name, path] of next) {
      const keys = paths.get(path) ?? new Set<string>();
      keys.add(name);
      paths.set(path, keys);
    }
    const changed = new Set<string>();
    for (const [name, path] of next)
      if (watched.get(name) !== path) changed.add(name);
    for (const name of watched.keys()) if (!next.has(name)) changed.add(name);
    const before = new Set(byPath.keys());
    byPath = paths;
    watched = next;
    if (closed) return;
    const added = [...paths.keys()].filter((path) => !before.has(path));
    const removed = [...before].filter((path) => !paths.has(path));
    if (added.length) watcher.add(added);
    if (removed.length) watcher.unwatch(removed);
    if (changed.size) queue(changed);
  };
  watcher.on("all", (_event, path) => {
    if (resolve(path) === registryPath(home)) {
      void reload().catch((error) =>
        console.error("ShowAI dataset sources:", error),
      );
      return;
    }
    const keys = byPath.get(resolve(path));
    if (keys) queue(keys);
  });
  watcher.on("error", (error) =>
    console.error("ShowAI dataset sources:", error),
  );
  void reload()
    .then(() => pending.clear())
    .catch((error) => console.error("ShowAI dataset sources:", error));
  return {
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}
