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
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { watch, type FSWatcher } from "chokidar";
import type { Agent } from "undici";
import type { WarningCode } from "../datasets/warnings.mjs";
import { atomicRename } from "./atomic-rename";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { CoreError } from "./model";

// A dataset can keep its value outside the content library: in a local file
// or at an http(s) address. The library stores only the dataset's description
// and `source` (format, file name, and for online data the address, all
// synchronized with the project). A file's absolute path is linked per device
// in local/dataset-sources.json, so a shared project never makes another
// device read files it did not choose, and each device links its own copy.
// JSON, CSV and TSV files are read and written; spreadsheets (.xlsx) and
// online data are read-only.

export const SOURCE_FORMATS = ["json", "csv", "tsv", "xlsx"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
/** Formats ShowAI writes back into a linked file. */
export const WRITABLE_FORMATS: readonly SourceFormat[] = ["json", "csv", "tsv"];
export const SOURCE_KINDS = ["file", "url"] as const;
/** Online data is fetched again when the last fetch is older than this. */
export const DEFAULT_REFRESH_SECONDS = 300;
export const MAX_REFRESH_SECONDS = 86_400;
/**
 * Limits of one fetch of online data; hosts and tests may adjust them. A
 * hosted server sets publicAddressesOnly so that addresses of its own
 * network (loopback, private ranges, link-local) are never fetched.
 */
export const REMOTE_FETCH = {
  timeoutMs: 15_000,
  maxRedirects: 5,
  publicAddressesOnly: false,
};

/** The synchronized part of a linked file, stored in the dataset file. */
export interface FileSource {
  kind: "file";
  format: SourceFormat;
  /** File name when it was linked; a hint for linking on another device. */
  name?: string;
}
/** Online data, read-only; the address is synchronized with the project. */
export interface UrlSource {
  kind: "url";
  format: SourceFormat;
  /** http(s) address without credentials. */
  url: string;
  name?: string;
  /**
   * Seconds after which a read fetches the data again (default 300); 0
   * fetches only on an explicit refresh.
   */
  refreshSeconds?: number;
}
export type DatasetSource = FileSource | UrlSource;

/** What a read of the linked file found, carried by the dataset record. */
export interface ExternalFileState {
  path: string;
  format: SourceFormat;
  bytes: number;
  modifiedAt: string;
}
/** What the last fetch of online data found. */
export interface RemoteSourceState {
  url: string;
  format: SourceFormat;
  bytes: number;
  /** When the data was last fetched or confirmed unchanged. */
  fetchedAt: string;
  /** Last-Modified of the response, when the server sent one. */
  modifiedAt?: string;
}

/** Whether ShowAI writes changes back into the source. */
export function sourceWritable(source: DatasetSource): boolean {
  return source.kind === "file" && WRITABLE_FORMATS.includes(source.format);
}

/** A CoreError of a source read, with the warning code that explains it. */
export function sourceFailure(
  code: "INVALID_DATA" | "INVALID_PATH" | "SOURCE_UNAVAILABLE",
  message: string,
  reason: WarningCode,
): CoreError {
  const error = new CoreError(code, message);
  error.details = { reason };
  return error;
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

const validUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 2048 || !URL.canParse(value))
    return false;
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
  );
};

export function isDatasetSource(value: unknown): value is DatasetSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  const common =
    SOURCE_FORMATS.includes(source.format as SourceFormat) &&
    (source.name === undefined ||
      (typeof source.name === "string" && source.name.length <= 255));
  if (source.kind === "file")
    return (
      common &&
      Object.keys(source).every((name) =>
        ["kind", "format", "name"].includes(name),
      )
    );
  return (
    source.kind === "url" &&
    common &&
    validUrl(source.url) &&
    (source.refreshSeconds === undefined ||
      (Number.isInteger(source.refreshSeconds) &&
        (source.refreshSeconds as number) >= 0 &&
        (source.refreshSeconds as number) <= MAX_REFRESH_SECONDS)) &&
    Object.keys(source).every((name) =>
      ["kind", "format", "url", "name", "refreshSeconds"].includes(name),
    )
  );
}

/** The format a file name or address implies, or the explicit one. */
export function sourceFormat(path: string, format?: unknown): SourceFormat {
  if (format !== undefined) {
    if (!SOURCE_FORMATS.includes(format as SourceFormat))
      throw new CoreError(
        "INVALID_DATA",
        `External data is ${SOURCE_FORMATS.join(", ")}.`,
      );
    return format as SourceFormat;
  }
  const extension = extname(path).slice(1).toLowerCase();
  if (SOURCE_FORMATS.includes(extension as SourceFormat))
    return extension as SourceFormat;
  throw new CoreError(
    "INVALID_DATA",
    `Cannot tell the format of ${basename(path) || path}; name a .json, .csv, .tsv or .xlsx file or pass format.`,
  );
}

/** An http(s) address for online data; credentials are never stored. */
export function sourceUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048)
    throw new CoreError(
      "INVALID_DATA",
      "Give the http(s) address of the data (at most 2048 characters).",
    );
  if (!URL.canParse(value.trim()))
    throw new CoreError("INVALID_DATA", `${value} is not a valid address.`);
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol))
    throw new CoreError(
      "INVALID_DATA",
      "Online data is read over http or https.",
    );
  if (url.username || url.password)
    throw new CoreError(
      "INVALID_DATA",
      "Remove the user name and password from the address. The address is stored and synchronized with the project, and ShowAI sends no credentials.",
    );
  return url.href;
}

/** The refresh interval of online data, in seconds. */
export function refreshSeconds(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_REFRESH_SECONDS
  )
    throw new CoreError(
      "INVALID_DATA",
      `refreshSeconds is a whole number from 0 (only on explicit refresh) to ${MAX_REFRESH_SECONDS}.`,
    );
  return value as number;
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
    throw sourceFailure(
      "INVALID_DATA",
      "The file has an unclosed quote.",
      "PARSE_FAILED",
    );
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
      throw sourceFailure(
        "INVALID_DATA",
        `The file is not valid JSON${position ? ` at ${position[0]}` : ""}.`,
        "PARSE_FAILED",
      );
    }
  }
  if (format === "xlsx")
    throw new CoreError("INVALID_DATA", "A spreadsheet is read as bytes.");
  return {
    value: parseTable(body, format === "tsv" ? "\t" : ","),
    layout: { ...layout, indent: 0 },
  };
}

function readOnlyFormat(format: SourceFormat): CoreError {
  const error = new CoreError(
    "READ_ONLY",
    `ShowAI reads .${format} files but does not write them. Change the data in the file itself, or copy it into the library (dataset_write link path:null) to edit it in ShowAI.`,
  );
  error.details = { reason: "READ_ONLY" };
  return error;
}

/** A cell of a spreadsheet as JSON: dates become ISO strings. */
type SheetCell = string | number | boolean | null;
function sheetCell(cell: unknown): SheetCell {
  if (cell instanceof Date)
    return Number.isNaN(cell.getTime()) ? null : cell.toISOString();
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell === "string" || typeof cell === "boolean") return cell;
  return cell === null || cell === undefined ? null : String(cell);
}

/** Every sheet of a workbook as { sheets: [{ name, rows }] }. */
export async function parseWorkbook(
  bytes: Buffer,
): Promise<{ sheets: { name: string; rows: SheetCell[][] }[] }> {
  // Loaded on first use, so commands that never read a workbook start faster.
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const sheets = await readXlsxFile(bytes).catch((error: unknown) => {
    // The library reports damaged or unsupported files by throwing.
    throw sourceFailure(
      "INVALID_DATA",
      `The file is not a readable .xlsx workbook (${error instanceof Error ? error.message : String(error)}).`,
      "PARSE_FAILED",
    );
  });
  return {
    sheets: sheets.map((sheet) => ({
      name: sheet.sheet,
      rows: sheet.data.map((row) => row.map(sheetCell)),
    })),
  };
}

/** Parses the bytes of a file or response in its format. */
export async function parseSourceBytes(
  bytes: Buffer,
  format: SourceFormat,
  name: string,
): Promise<{ value: unknown; layout: FileLayout }> {
  if (format === "xlsx")
    return { value: await parseWorkbook(bytes), layout: DEFAULT_LAYOUT };
  let text: string;
  try {
    // Undecodable bytes would be read as replacement characters and
    // written back, damaging the file.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw sourceFailure(
      "INVALID_DATA",
      `${name} is not UTF-8 text. Save it as UTF-8 (in Excel: CSV UTF-8) and read it again.`,
      "PARSE_FAILED",
    );
  }
  return parseSource(text, format);
}

export function serializeSource(
  value: unknown,
  format: SourceFormat,
  layout: FileLayout = DEFAULT_LAYOUT,
): string {
  if (!WRITABLE_FORMATS.includes(format)) throw readOnlyFormat(format);
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
      throw sourceFailure(
        "INVALID_PATH",
        `${path} is not a file.`,
        "SOURCE_MISSING",
      );
    if (before.size > limit)
      throw sourceFailure(
        "INVALID_DATA",
        `${basename(path)} is ${before.size} bytes; a dataset holds at most ${limit} bytes.`,
        "TOO_LARGE",
      );
    const bytes = await file.readFile();
    const after = await file.stat();
    if (stampOf(before) !== stampOf(after))
      throw new CoreError(
        "CONFLICT",
        `${basename(path)} is still being written. Retry when it finishes.`,
      );
    const { value, layout } = await parseSourceBytes(
      bytes,
      format,
      basename(path),
    );
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
// Fetching online data

export type RemoteFetch =
  | { notModified: true; etag?: string; lastModified?: string }
  | {
      notModified: false;
      value: unknown;
      bytes: number;
      etag?: string;
      lastModified?: string;
    };

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 127],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");

function publicIp(address: string): boolean {
  const family = isIP(address);
  return (
    family !== 0 && !NON_PUBLIC.check(address, family === 6 ? "ipv6" : "ipv4")
  );
}

/** Connections that resolve only to public addresses (checked at connect time). */
let publicDispatcher: Agent | undefined;
async function publicOnly(): Promise<Agent> {
  const { Agent } = await import("undici");
  publicDispatcher ??= new Agent({
    connect: {
      lookup: ((
        hostname: string,
        options: object,
        callback: (
          error: NodeJS.ErrnoException | null,
          address: string | { address: string; family: number }[],
          family?: number,
        ) => void,
      ) =>
        lookup(hostname, options, (error, address, family) => {
          if (error) return callback(error, address, family);
          const addresses = Array.isArray(address)
            ? address.map((entry) => entry.address)
            : [address];
          if (addresses.some((entry) => !publicIp(entry)))
            return callback(
              Object.assign(
                new Error(`${hostname} is not a public internet address`),
                { code: "ENOTPUBLIC" },
              ),
              address,
              family,
            );
          callback(null, address, family);
        })) as never,
    },
  });
  return publicDispatcher;
}

const unreachable = (url: string, problem: string) =>
  sourceFailure(
    "SOURCE_UNAVAILABLE",
    `${url} could not be read (${problem}).`,
    "SOURCE_UNREACHABLE",
  );

/** Reads the body of a response, stopping as soon as it exceeds the limit. */
async function responseBytes(
  response: Response,
  url: string,
  limit: number,
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  const tooLarge = (bytes: number | string) =>
    sourceFailure(
      "INVALID_DATA",
      `${url} returned ${bytes} bytes; a dataset holds at most ${limit} bytes.`,
      "TOO_LARGE",
    );
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw tooLarge(declared);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge(`more than ${limit}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetches online data without cookies or credentials, following redirects
 * only to http(s) addresses. With the validators of an earlier fetch, an
 * unchanged response comes back as notModified.
 */
export async function fetchSource(
  url: string,
  format: SourceFormat,
  limit: number,
  validators: { etag?: string; lastModified?: string } = {},
): Promise<RemoteFetch> {
  const signal = AbortSignal.timeout(REMOTE_FETCH.timeoutMs);
  const guarded = REMOTE_FETCH.publicAddressesOnly;
  let target = url;
  try {
    for (let hop = 0; ; hop++) {
      const host = new URL(target).hostname.replace(/^\[|\]$/g, "");
      if (guarded && isIP(host) && !publicIp(host))
        throw unreachable(url, `${host} is not a public internet address`);
      const response = await fetch(target, {
        redirect: "manual",
        credentials: "omit",
        signal,
        ...(guarded ? { dispatcher: await publicOnly() } : {}),
        headers: {
          accept:
            format === "json"
              ? "application/json, */*;q=0.5"
              : format === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*;q=0.5"
                : "text/csv, text/tab-separated-values, text/plain, */*;q=0.5",
          ...(validators.etag ? { "if-none-match": validators.etag } : {}),
          ...(validators.lastModified
            ? { "if-modified-since": validators.lastModified }
            : {}),
        },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        if (hop >= REMOTE_FETCH.maxRedirects)
          throw unreachable(url, "too many redirects");
        const next = URL.canParse(location, target)
          ? new URL(location, target)
          : undefined;
        if (
          !next ||
          !["http:", "https:"].includes(next.protocol) ||
          next.username ||
          next.password
        )
          throw unreachable(
            url,
            "it redirects to an address that is not http(s)",
          );
        target = next.href;
        continue;
      }
      const etag = response.headers.get("etag") ?? undefined;
      const lastModified = response.headers.get("last-modified") ?? undefined;
      const fresh = {
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
      };
      if (response.status === 304) {
        await response.body?.cancel();
        return { notModified: true, ...fresh };
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw unreachable(url, `the server answered ${response.status}`);
      }
      const bytes = await responseBytes(response, url, limit);
      const { value } = await parseSourceBytes(
        bytes,
        format,
        basename(new URL(target).pathname) || target,
      );
      return { notModified: false, value, bytes: bytes.length, ...fresh };
    }
  } catch (error) {
    // Network failures and the timeout reject fetch or the body read.
    if (error instanceof CoreError) throw error;
    const cause = (error as { cause?: { code?: string; message?: string } })
      ?.cause;
    throw unreachable(
      url,
      signal.aborted
        ? `no answer within ${REMOTE_FETCH.timeoutMs / 1000} s`
        : cause?.code === "ENOTPUBLIC"
          ? cause.message!
          : (cause?.code ??
            (error instanceof Error ? error.message : String(error))),
    );
  }
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
