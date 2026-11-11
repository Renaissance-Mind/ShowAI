import { LOCAL_FILE_TYPES } from "../../portable/local-files.mjs";
import { normalizeDate } from "../../components/blocks/database-contract.mjs";
import { parseDelimited } from "../dataset-sources";
import { CoreError } from "../model";
import {
  NOTION_BLOCKS,
  NOTION_INFERENCE,
  NOTION_PROPERTY_COLUMNS,
  type NotionProperty,
} from "./notion-mapping";
import {
  importRef,
  type ImportBlock,
  type ImportBundle,
  type ImportFile,
  type ImportInput,
  type ImportWarning,
  type Importer,
} from "./types";

// Notion's "Markdown & CSV" export: pages are "Title <32 hex>.md", a page's
// subpages and attachments sit in the folder of the same name, databases are
// "Name <id>.csv" (and "_all.csv" with every row) with their row pages in the
// folder "Name <id>". Markdown text of a page stays Markdown inside rich text
// blocks; blocks Notion writes as HTML or as a lone line (callouts, toggles,
// images, files, bookmarks, database links) become components through
// NOTION_BLOCKS. A folder of plain Markdown files with links and images reads
// the same way.

const NOTION_ID = /^(.*?)\s*([0-9a-f]{32})$/i;
const MAX_TEXT_BLOCK = 400_000;
/** Inline images inside text stay inline only up to this size. */
const INLINE_IMAGE_BYTES = 256 * 1024;
const MAX_ROWS = 5000;
const MAX_COLUMNS = 50;

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const dirname = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const extension = (path: string) =>
  /\.[^./]+$/.exec(path)?.[0]?.toLowerCase() ?? "";
function join(base: string, relative: string): string | undefined {
  const parts = base ? base.split("/") : [];
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}
/** "Title 0123…" → { title, id }. */
function parseName(name: string): { title: string; id?: string } {
  const match = NOTION_ID.exec(name);
  return match && match[1]
    ? { title: match[1].trim(), id: match[2].toLowerCase() }
    : { title: name.trim() };
}

interface PageNode {
  type: "page";
  base: string;
  file: ImportFile;
  title: string;
  id?: string;
}
interface DatabaseNode {
  type: "database";
  base: string;
  file: ImportFile;
  title: string;
  id?: string;
}

/** The export as pages, databases and the folders between them. */
function index(input: ImportInput) {
  const pages = new Map<string, PageNode>();
  const databases = new Map<string, DatabaseNode>();
  const files = new Map<string, ImportFile>();
  const ids = new Map<string, string>();
  for (const file of input.files) {
    files.set(file.path, file);
    const type = extension(file.path);
    if (type === ".md" || type === ".markdown") {
      const base = file.path.slice(0, -type.length);
      const { title, id } = parseName(basename(base));
      pages.set(base, { type: "page", base, file, title, id });
      if (id) ids.set(id, base);
    } else if (type === ".csv") {
      const all = /_all\.csv$/i.test(file.path);
      const base = file.path.slice(0, all ? -8 : -4);
      // The _all file lists every row; the plain one only the saved view's.
      if (databases.has(base) && !all) continue;
      const { title, id } = parseName(basename(base));
      databases.set(base, { type: "database", base, file, title, id });
      if (id) ids.set(id, base);
    }
  }
  return { pages, databases, files, ids };
}

type Index = ReturnType<typeof index>;

/** Where a link of a page points: another page or database, a file, or outside. */
function resolveLink(
  href: string,
  from: string,
  exportIndex: Index,
):
  | { kind: "page"; key: string }
  | { kind: "file"; path: string; file: ImportFile }
  | { kind: "web"; url: string }
  | { kind: "unresolved" } {
  if (/^(mailto:|tel:|#)/i.test(href)) return { kind: "web", url: href };
  if (/^https?:\/\//i.test(href)) {
    const notion = /^https?:\/\/(?:www\.)?notion\.so\//i.test(href)
      ? /([0-9a-f]{32})(?:[?#].*)?$/i.exec(href)
      : null;
    const key = notion && exportIndex.ids.get(notion[1].toLowerCase());
    return key ? { kind: "page", key } : { kind: "web", url: href };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "unresolved" };
  const path = join(dirname(from), decode(href.replace(/[?#].*$/, "")));
  if (path === undefined) return { kind: "unresolved" };
  const type = extension(path);
  if (type === ".md" || type === ".markdown") {
    const base = path.slice(0, -type.length);
    return exportIndex.pages.has(base)
      ? { kind: "page", key: base }
      : { kind: "unresolved" };
  }
  if (type === ".csv") {
    const base = path.slice(0, /_all\.csv$/i.test(path) ? -8 : -4);
    return exportIndex.databases.has(base)
      ? { kind: "page", key: base }
      : { kind: "unresolved" };
  }
  const file = exportIndex.files.get(path);
  return file ? { kind: "file", path, file } : { kind: "unresolved" };
}

const fileKind = (path: string) =>
  (LOCAL_FILE_TYPES as Record<string, { kind: string }>)[extension(path)]
    ?.kind as "image" | "video" | "audio" | "pdf" | undefined;

interface PageContext {
  source: string;
  index: Index;
  warnings: ImportWarning[];
  used: Set<string>;
}

const LINK =
  /(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Rewrites the links and images of Markdown text that are not alone on a line. */
function rewriteInline(markdown: string, context: PageContext): string {
  let fence: string | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^\s*(```|~~~)/.exec(line)?.[1];
      if (marker && (!fence || fence === marker)) {
        fence = fence ? undefined : marker;
        return line;
      }
      if (fence) return line;
      return line.replace(LINK, (whole, bang, text, href) => {
        const target = resolveLink(href, context.source, context.index);
        if (target.kind === "web") return whole;
        if (target.kind === "page")
          return bang ? text : `[${text}](${importRef("page", target.key)})`;
        if (target.kind === "file") {
          context.used.add(target.path);
          if (
            bang &&
            fileKind(target.path) === "image" &&
            target.file.size <= INLINE_IMAGE_BYTES
          )
            return `![${text}](${importRef("file", target.path)})`;
          context.warnings.push({
            source: context.source,
            message: `${target.path} is linked inside text; kept as its name.`,
          });
          return text || basename(target.path);
        }
        context.warnings.push({
          source: context.source,
          message: `The link to ${decode(href)} is not part of the export; kept as text.`,
        });
        return text;
      });
    })
    .join("\n");
}

/** A line that is only a link or an image becomes a component of its own. */
function lineBlock(
  line: string,
  context: PageContext,
): ImportBlock | undefined {
  const match =
    /^\s*(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*$/.exec(
      line,
    );
  if (!match) return undefined;
  const [, bang, text, href] = match;
  const target = resolveLink(href, context.source, context.index);
  if (bang) {
    if (target.kind === "web" && /^https?:/i.test(target.url))
      return NOTION_BLOCKS.image({ src: target.url, alt: text });
    if (target.kind === "file" && fileKind(target.path) === "image") {
      context.used.add(target.path);
      return NOTION_BLOCKS.image({
        src: importRef("file", target.path),
        alt: text,
      });
    }
    return undefined;
  }
  if (target.kind === "web" && /^https?:/i.test(target.url)) {
    // Notion writes bookmarks and embeds as a link whose text is the address.
    if (!/^https?:\/\//i.test(text.trim())) return undefined;
    return NOTION_BLOCKS.bookmark({ url: target.url, title: text.trim() });
  }
  if (target.kind === "file") {
    const kind = fileKind(target.path);
    context.used.add(target.path);
    if (kind === "image")
      return NOTION_BLOCKS.image({
        src: importRef("file", target.path),
        alt: text,
      });
    if (kind)
      return NOTION_BLOCKS[kind]({
        src: importRef("file", target.path),
        name: basename(target.path),
      });
    context.warnings.push({
      source: context.source,
      message: `${target.path} has no matching component (images, video, audio and PDF are embedded); kept as its name.`,
    });
    return NOTION_BLOCKS.text(text || basename(target.path));
  }
  return undefined;
}

const HTML_TAG = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;
const KNOWN_TEXT_TAGS = new Set(["br", "u", "sup", "sub", "mark", "span"]);

/** Notion Markdown → component instances in reading order. */
export function notionBlocks(
  markdown: string,
  context: PageContext,
): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  let text: string[] = [];
  const flush = () => {
    const joined = text.join("\n").trim();
    text = [];
    if (!joined) return;
    const tags = new Set<string>();
    for (const [, tag] of joined.matchAll(HTML_TAG))
      if (!KNOWN_TEXT_TAGS.has(tag.toLowerCase())) tags.add(tag.toLowerCase());
    if (tags.size)
      context.warnings.push({
        source: context.source,
        message: `HTML <${[...tags].join(">, <")}> has no ShowAI component; kept as text.`,
      });
    const rewritten = rewriteInline(joined, context);
    // Very long text is split at paragraph breaks to stay within one block.
    let rest = rewritten;
    while (rest.length > MAX_TEXT_BLOCK) {
      const cut = rest.lastIndexOf("\n\n", MAX_TEXT_BLOCK);
      const at = cut > 0 ? cut : MAX_TEXT_BLOCK;
      blocks.push(NOTION_BLOCKS.text(rest.slice(0, at)));
      rest = rest.slice(at).trimStart();
    }
    if (rest) blocks.push(NOTION_BLOCKS.text(rest));
  };
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let fence: string | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker && (!fence || fence === marker)) {
      fence = fence ? undefined : marker;
      text.push(line);
      continue;
    }
    if (fence) {
      text.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (/^<aside\b[^>]*>/i.test(trimmed)) {
      const inner: string[] = [trimmed.replace(/^<aside\b[^>]*>/i, "")];
      while (
        !/<\/aside>\s*$/i.test(inner.at(-1) ?? "") &&
        ++index < lines.length
      )
        inner.push(lines[index]);
      inner[inner.length - 1] = inner[inner.length - 1].replace(
        /<\/aside>\s*$/i,
        "",
      );
      flush();
      let body = inner.join("\n").trim();
      const icon =
        /^(\p{Extended_Pictographic}️?|\p{Emoji_Presentation})\s*/u.exec(body);
      if (icon) body = body.slice(icon[0].length);
      blocks.push(
        NOTION_BLOCKS.callout({
          icon: icon?.[1],
          markdown: rewriteInline(body, context),
        }),
      );
      continue;
    }
    if (/^<details\b[^>]*>/i.test(trimmed)) {
      const inner: string[] = [trimmed.replace(/^<details\b[^>]*>/i, "")];
      while (
        !/<\/details>\s*$/i.test(inner.at(-1) ?? "") &&
        ++index < lines.length
      )
        inner.push(lines[index]);
      inner[inner.length - 1] = inner[inner.length - 1].replace(
        /<\/details>\s*$/i,
        "",
      );
      flush();
      let body = inner.join("\n").trim();
      const summary = /^<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(body);
      if (summary) body = body.slice(summary[0].length);
      blocks.push(
        NOTION_BLOCKS.toggle({
          summary: (summary?.[1] ?? "").replace(HTML_TAG, "").trim(),
          markdown: rewriteInline(body.trim(), context),
        }),
      );
      continue;
    }
    const block = lineBlock(line, context);
    if (block) {
      flush();
      blocks.push(block);
      continue;
    }
    text.push(line);
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// Databases

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A Notion date ("November 12, 2026", "2026/11/12 9:00 AM", ISO) → YYYY-MM-DD and whether a time was left out. */
export function notionDate(
  value: string,
): { day: string; time: boolean } | undefined {
  const text = value.trim();
  const named = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(.*)$/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[1].toLowerCase());
    if (month < 0) return undefined;
    const day = normalizeDate(`${named[3]}-${month + 1}-${named[2]}`);
    return day ? { day, time: /\d/.test(named[4]) } : undefined;
  }
  const day = normalizeDate(text);
  if (!day) return undefined;
  return {
    day,
    time: /^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[T\s]+\d/.test(text),
  };
}

const RELATION = /^(.*?)\s*\(([^()]*\.md)\)$/;

function inferProperty(values: string[], rows: number): NotionProperty {
  const filled = values.filter((value) => value.trim());
  if (!filled.length) return "text";
  const lower = filled.map((value) => value.trim().toLowerCase());
  if (
    lower.every(
      (value) =>
        NOTION_INFERENCE.checked.includes(value) ||
        NOTION_INFERENCE.unchecked.includes(value),
    ) &&
    values.length === filled.length
  )
    return "checkbox";
  const parts = filled.flatMap((value) => value.split(/,\s*/));
  if (parts.every((part) => RELATION.test(part.trim()))) return "relation";
  if (filled.every((value) => /^-?\d+(?:\.\d+)?$/.test(value.trim())))
    return "number";
  if (filled.every((value) => /^https?:\/\/\S+$/i.test(value.trim())))
    return "url";
  if (filled.every((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())))
    return "email";
  if (
    filled.every((value) =>
      value.split(" → ").every((part) => notionDate(part) !== undefined),
    )
  )
    return "date";
  const distinct = new Set(filled.map((value) => value.trim()));
  const short = filled.every((value) => value.length <= 80);
  if (
    short &&
    filled.some((value) => /,\s/.test(value)) &&
    new Set(parts.map((part) => part.trim())).size <=
      NOTION_INFERENCE.selectOptions
  )
    return "multiSelect";
  if (
    short &&
    rows >= 2 &&
    distinct.size <= NOTION_INFERENCE.selectOptions &&
    distinct.size < filled.length
  )
    return "select";
  return "text";
}

interface DatabaseResult {
  value: {
    columns: Record<string, unknown>[];
    rows: Record<string, unknown>[];
  };
  headers: string[];
}

function databaseValue(
  node: DatabaseNode,
  text: string,
  rowPages: PageNode[],
  rowTitles: Map<string, string>,
  context: PageContext,
): DatabaseResult {
  const table = parseDelimited(text, ",").filter((row) =>
    row.some((cell) => cell.trim()),
  );
  const [header = [], ...records] = table;
  const headers = header.map(
    (name, index) => name.trim() || `Column ${index + 1}`,
  );
  if (records.length > MAX_ROWS)
    context.warnings.push({
      source: node.file.path,
      message: `${records.length} rows; a database holds ${MAX_ROWS}, so rows after ${MAX_ROWS} were left out.`,
    });
  const kept = records.slice(0, MAX_ROWS);
  const available = MAX_COLUMNS - 2;
  const properties = headers.slice(1);
  if (properties.length > available)
    context.warnings.push({
      source: node.file.path,
      message: `${headers.length} properties; a database holds ${MAX_COLUMNS} columns, so ${properties.slice(available).join(", ")} were left out.`,
    });
  const columns: Record<string, unknown>[] = [
    { id: "title", name: headers[0] ?? "Name", type: "text" },
  ];
  const fillers: ((record: string[], row: Record<string, unknown>) => void)[] =
    [];
  let timed = 0;
  properties.slice(0, available).forEach((name, offset) => {
    const at = offset + 1;
    const values = kept.map((record) => record[at] ?? "");
    const property = inferProperty(values, kept.length);
    const id = `p${at}`;
    const column: Record<string, unknown> = {
      id,
      name,
      type: NOTION_PROPERTY_COLUMNS[property],
    };
    if (property === "select")
      column.options = [
        ...new Set(values.map((v) => v.trim()).filter(Boolean)),
      ];
    columns.push(column);
    const ranged =
      property === "date" && values.some((value) => value.includes(" → "));
    if (ranged && columns.length < MAX_COLUMNS - 1)
      columns.push({ id: `${id}_end`, name: `${name} →`, type: "date" });
    fillers.push((record, row) => {
      const raw = (record[at] ?? "").trim();
      if (!raw) return;
      if (property === "checkbox")
        row[id] = NOTION_INFERENCE.checked.includes(raw.toLowerCase());
      else if (property === "number") row[id] = Number(raw);
      else if (property === "date") {
        const [start, end] = raw.split(" → ");
        const first = notionDate(start)!;
        row[id] = first.day;
        if (first.time) timed++;
        if (end && ranged) row[`${id}_end`] = notionDate(end)!.day;
      } else if (property === "relation")
        row[id] = raw
          .split(/,\s*(?=[^,]*\.md\))/)
          .map((part) => {
            const match = RELATION.exec(part.trim());
            return match
              ? match[1] ||
                  parseName(basename(decode(match[2]).replace(/\.md$/, "")))
                    .title
              : part;
          })
          .join(", ");
      else row[id] = raw;
    });
  });
  if (timed)
    context.warnings.push({
      source: node.file.path,
      message: `${timed} dates carried a time of day; database date columns keep the day.`,
    });
  columns.push({
    id: "page",
    name: "Page",
    type: "page",
    titleColumn: "title",
    folder: importRef("folder", node.base),
  });
  // Row pages are matched to rows by title, in order for repeated titles.
  const byTitle = new Map<string, string[]>();
  for (const page of rowPages) {
    const title = rowTitles.get(page.base) ?? page.title;
    byTitle.set(title, [...(byTitle.get(title) ?? []), page.base]);
  }
  const matched = new Set<string>();
  const rows = kept.map((record, index) => {
    const title = (record[0] ?? "").trim();
    const row: Record<string, unknown> = { id: `r${index + 1}`, title };
    for (const fill of fillers) fill(record, row);
    const page = byTitle.get(title)?.shift();
    if (page) {
      matched.add(page);
      row.page = importRef("page", page);
    }
    return row;
  });
  for (const page of rowPages)
    if (!matched.has(page.base) && rows.length < MAX_ROWS)
      rows.push({
        id: `r${rows.length + 1}`,
        title: rowTitles.get(page.base) ?? page.title,
        page: importRef("page", page.base),
      });
  return { value: { columns, rows }, headers };
}

// ---------------------------------------------------------------------------

/** The page title from its first heading, and the Markdown after it. */
function splitTitle(markdown: string, fallback: string) {
  const text = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(text);
  return match
    ? { title: match[1].trim() || fallback, body: text.slice(match[0].length) }
    : { title: fallback, body: text };
}

/** Removes the "Property: value" lines Notion writes below a row page's title. */
function stripProperties(body: string, headers: string[]): string {
  const names = new Set(headers.map((name) => name.trim()));
  const lines = body.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index++;
  const start = index;
  while (index < lines.length) {
    const match =
      /^([^:]{1,200}):\s/.exec(lines[index]) ??
      /^([^:]{1,200}):$/.exec(lines[index]);
    if (!match || !names.has(match[1].trim())) break;
    index++;
  }
  return index > start ? lines.slice(index).join("\n") : body;
}

async function convertNotion(input: ImportInput): Promise<ImportBundle> {
  const exportIndex = index(input);
  if (!exportIndex.pages.size && !exportIndex.databases.size) {
    if (input.files.some((file) => /\s[0-9a-f]{32}\.html$/i.test(file.path)))
      throw new CoreError(
        "INVALID_DATA",
        'This is Notion\'s HTML export. Export again from Notion with "Markdown & CSV" and import that zip.',
      );
    throw new CoreError(
      "INVALID_DATA",
      "The input holds no Markdown pages or CSV databases.",
    );
  }
  const warnings: ImportWarning[] = [...input.problems];
  const used = new Set<string>();
  const bundle: Required<Pick<ImportBundle, "folders" | "pages" | "datasets">> &
    ImportBundle = {
    title: parseName(input.name.replace(/\.zip$/i, "")).title,
    folders: [],
    pages: [],
    datasets: [],
    warnings,
  };
  const folderKeys = new Set<string>();
  // Folders on the way to a page, made from the export's own folders.
  const ensureFolder = (path: string): string | undefined => {
    if (!path) return undefined;
    if (folderKeys.has(path)) return path;
    const parent = ensureFolder(dirname(path));
    folderKeys.add(path);
    const owner =
      exportIndex.pages.get(path) ?? exportIndex.databases.get(path);
    bundle.folders.push({
      key: path,
      title: owner?.title ?? parseName(basename(path)).title,
      ...(parent ? { parent } : {}),
    });
    return path;
  };
  // A page or database with anything inside its folder becomes a folder
  // holding the page itself and its children.
  const hasChildren = (base: string) =>
    [...exportIndex.pages.keys(), ...exportIndex.databases.keys()].some((key) =>
      key.startsWith(`${base}/`),
    );
  const parentOf = (base: string) => ensureFolder(dirname(base));
  const rowsOf = new Map<string, PageNode[]>();
  for (const [base] of exportIndex.databases)
    rowsOf.set(
      base,
      [...exportIndex.pages.values()].filter(
        (page) => dirname(page.base) === base,
      ),
    );
  const rowHeaders = new Map<string, string[]>();
  const rowTitles = new Map<string, string>();
  for (const [, rows] of rowsOf)
    for (const page of rows)
      rowTitles.set(
        page.base,
        splitTitle(await page.file.text(), page.title).title,
      );

  for (const [base, node] of [...exportIndex.databases].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const context: PageContext = {
      source: node.file.path,
      index: exportIndex,
      warnings,
      used,
    };
    const folder = ensureFolder(base)!;
    const result = databaseValue(
      node,
      await node.file.text(),
      rowsOf.get(base) ?? [],
      rowTitles,
      context,
    );
    for (const page of rowsOf.get(base) ?? [])
      rowHeaders.set(page.base, result.headers);
    bundle.datasets.push({ key: base, name: node.title, value: result.value });
    bundle.pages.push({
      key: base,
      title: node.title,
      parent: folder,
      source: node.file.path,
      blocks: [
        NOTION_BLOCKS.database({
          title: node.title,
          dataset: importRef("dataset", base),
        }),
      ],
    });
  }
  for (const [base, node] of [...exportIndex.pages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const context: PageContext = {
      source: node.file.path,
      index: exportIndex,
      warnings,
      used,
    };
    const { title, body } = splitTitle(await node.file.text(), node.title);
    const headers = rowHeaders.get(base);
    const markdown = headers ? stripProperties(body, headers) : body;
    const parent = hasChildren(base) ? ensureFolder(base) : parentOf(base);
    bundle.pages.push({
      key: base,
      title,
      ...(parent ? { parent } : {}),
      source: node.file.path,
      blocks: notionBlocks(markdown, context),
    });
  }
  for (const file of input.files) {
    const type = extension(file.path);
    if ([".md", ".markdown", ".csv"].includes(type) || used.has(file.path))
      continue;
    warnings.push({
      source: file.path,
      message: "No page refers to this file; it was not imported.",
    });
  }
  // Reading order: a page before what its folder holds.
  bundle.pages.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // A database's own folder exists already; drop folders that only held attachments.
  const needed = new Set<string>();
  for (const item of [...bundle.pages, ...bundle.folders]) {
    let parent = item.parent;
    while (parent && !needed.has(parent)) {
      needed.add(parent);
      parent = bundle.folders.find((folder) => folder.key === parent)?.parent;
    }
  }
  bundle.folders = bundle.folders.filter(
    (folder) => needed.has(folder.key) || exportIndex.databases.has(folder.key),
  );
  return bundle;
}

export const notionImporter: Importer = {
  id: "notion",
  name: "Notion",
  description:
    'Notion "Markdown & CSV" exports (zip, nested Part zips or the unzipped folder): pages, subpages, databases with row pages, links and attachments. Also folders of Markdown files.',
  extensions: [".zip"],
  folders: true,
  origin: "builtin",
  async detect(input) {
    const notion = input.files.some((file) =>
      /\s[0-9a-f]{32}(\.md|\.csv|_all\.csv|\.html)$/i.test(file.path),
    );
    if (notion) return 0.9;
    if (input.kind === "file" || input.kind === "files") return 0;
    return input.files.some((file) => /\.(md|markdown)$/i.test(file.path))
      ? 0.4
      : 0;
  },
  convert: convertNotion,
};
