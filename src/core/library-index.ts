import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { ContentLibrary as GitLibrary } from "./content-library";
import { resourceForPath, type HistoryEntry } from "./history-model";
import { withLibraryLock } from "./library-lock";
import { CoreError } from "./model";
import type { JSONContent } from "@tiptap/core";
import { visitContentNodes, widgetDocuments } from "../document/document.mjs";
import {
  boundDatabaseEdges,
  declaredPageFields,
  pageReferenceEdges,
  type BoundDatabase,
  type ComponentPageFields,
  type PageReferenceEdge,
} from "./page-reference-index";

interface SearchRow {
  id: string;
  kind: string;
  projectId: string | null;
  resourceId: string;
  blockId: string | null;
  title: string;
  body: string;
  path: string;
  location: string[];
}
export interface SearchResult extends Omit<SearchRow, "body"> {
  snippet: string;
  score: number;
  revision: string;
}
export interface ReferenceEdge {
  source: string;
  targetKind: string;
  targetId: string;
  version?: string;
  integrity?: string;
  blockId?: string;
}
/** One reference between pages, as seen from the page that was asked about. */
export interface PageReferenceItem {
  /** The other page: the referring page for `to`, the referenced page for `from`. */
  projectId: string;
  pageId: string;
  title: string;
  icon?: string;
  /** The block on the referring page that holds the reference. */
  blockId: string | null;
  /** Blocks the reference points at on the referenced page. */
  blockIds: string[];
  kind: PageReferenceEdge["kind"];
  snippet: string;
  /** `from` only: the referenced page is deleted or absent. */
  missing?: true;
}
export interface PageReferences {
  /** Pages that refer to this page (backlinks), most recently changed first. */
  to: PageReferenceItem[];
  /** Pages this page refers to, in page order. */
  from: PageReferenceItem[];
  /** References in each direction; more than listed when the limit cut the list. */
  total: { to: number; from: number };
  /** Distinct pages in each direction, counted over every reference. */
  pages: { to: number; from: number };
  revision: string | null;
}
export interface PageReferenceOptions {
  /** Only references whose other page is in this project. */
  scope?: string;
  direction?: "to" | "from" | "both";
  limit?: number;
}
export interface SearchOptions {
  query: string;
  projectId?: string;
  kind?: "page" | "component" | "template" | "project" | "source";
  limit?: number;
  cursor?: string;
}

/** CJK unigram/bigram tokens support short Chinese searches alongside Unicode words. */
function cjkTokens(text: string, query = false): string[] {
  const result: string[] = [];
  for (const group of text.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu,
  ) ?? []) {
    const chars = Array.from(group);
    if (!query || chars.length === 1) result.push(...chars);
    for (let index = 1; index < chars.length; index++)
      result.push(chars[index - 1] + chars[index]);
  }
  return [...new Set(result)];
}
function matchQuery(query: string): string {
  const normalized = query.toLocaleLowerCase().trim();
  const words =
    normalized
      .replace(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu,
        " ",
      )
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [
    ...words.map((word) => `"${word}"*`),
    ...cjkTokens(normalized, true).map((token) => `"${token}"`),
  ].join(" AND ");
}
function strings(value: unknown): string[] {
  if (typeof value === "string")
    return /^(?:data:|asset:)/.test(value) ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(strings);
  return typeof value === "number" || typeof value === "boolean"
    ? [String(value)]
    : [];
}

// Bump when extraction changes so existing indexes rebuild once.
const EXTRACTION_VERSION = "5";
// Component data keys that configure identity, layout or style rather than carry reader text.
const NON_TEXT_KEYS = new Set([
  "id",
  "parentId",
  "componentId",
  "version",
  "integrity",
  "format",
  "type",
  "kind",
  "layout",
  "direction",
  "position",
  "sourceSide",
  "targetSide",
  "color",
  "backgroundColor",
  "stroke",
  "fill",
  "accent",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "padding",
  "radius",
  "height",
  "width",
  "widthMode",
  "textAlign",
  "align",
  "tone",
  "groupBy",
  "theme",
]);
const isRichDocument = (value: unknown): value is JSONContent =>
  !!value &&
  typeof value === "object" &&
  (value as JSONContent).type === "doc" &&
  Array.isArray((value as JSONContent).content);
/** Text of a rich-text tree, one line per block, without node types or IDs. */
function richText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  const children = node.content ?? [];
  const inline = children.every((child) => child.type === "text");
  return children.map(richText).join(inline ? "" : "\n");
}
/** Markdown reduced to its words, so snippets don't show markup. */
function markdownText(value: string): string {
  return value
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "");
}
/** Reader-visible text of component data: labels, cells, notes and links, not styling or structure. */
function readableText(value: unknown, markdown = false): string[] {
  if (typeof value === "string") {
    if (/^(?:data:|asset:)/.test(value)) return [];
    return [markdown ? markdownText(value) : value];
  }
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value))
    return value.flatMap((item) => readableText(item, markdown));
  if (isRichDocument(value)) return [richText(value)];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const isMarkdown = markdown || record.format === "markdown";
    return Object.entries(record).flatMap(([key, item]) =>
      NON_TEXT_KEYS.has(key) ? [] : readableText(item, isMarkdown),
    );
  }
  return [];
}
/** Headings inside text data, in order; the first names the block, the last opens the next section. */
function dataHeadings(data: unknown): string[] {
  const content = (data as { content?: unknown } | undefined)?.content;
  if (isRichDocument(content))
    return (content.content ?? [])
      .filter((node) => node.type === "heading")
      .map(richText)
      .filter(Boolean);
  if (typeof content === "string")
    return [...content.matchAll(/^\s{0,3}#{1,6}\s+(.+)$/gm)].map((match) =>
      match[1].trim(),
    );
  return [];
}

interface PageRow {
  path: string;
  projectId: string;
  pageId: string;
  title: string;
  icon?: string;
  archived: boolean;
  updatedAt: string;
}
// A saved component version never changes, so its declared page fields stay valid.
const declaredFields = new Map<string, string[]>();

/** Every table is a rebuildable projection of a named committed revision. */
export class LibraryIndex {
  readonly library: GitLibrary;
  readonly path: string;
  constructor(root: string) {
    this.library = new GitLibrary(root);
    this.path = join(this.library.root, "index.sqlite");
  }

  private database(): DatabaseSync {
    const db = new DatabaseSync(this.path);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS index_state (path TEXT PRIMARY KEY, signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT, resource_id TEXT NOT NULL,
        block_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, path TEXT NOT NULL, location TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resource_scope ON resources(project_id, kind, resource_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, title, body, tokens);
      CREATE TABLE IF NOT EXISTS refs (
        source TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
        version TEXT, integrity TEXT, block_id TEXT
      );
      CREATE INDEX IF NOT EXISTS reference_target ON refs(target_kind,target_id,version,integrity);
      CREATE TABLE IF NOT EXISTS pages (
        path TEXT PRIMARY KEY, project_id TEXT NOT NULL, page_id TEXT NOT NULL, title TEXT NOT NULL,
        icon TEXT, archived INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS page_refs (
        source TEXT NOT NULL, position INTEGER NOT NULL, block_id TEXT, target_project TEXT NOT NULL,
        target_page TEXT NOT NULL, target_blocks TEXT NOT NULL, kind TEXT NOT NULL, snippet TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS page_ref_target ON page_refs(target_project,target_page);
      CREATE INDEX IF NOT EXISTS page_ref_source ON page_refs(source,position);
      CREATE TABLE IF NOT EXISTS page_datasets (source TEXT NOT NULL, dataset TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS page_dataset_target ON page_datasets(dataset);
      CREATE INDEX IF NOT EXISTS page_dataset_source ON page_datasets(source);
      CREATE TABLE IF NOT EXISTS history (
        revision TEXT PRIMARY KEY, at TEXT NOT NULL, actor_kind TEXT NOT NULL, harness TEXT,
        session_id TEXT, message TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_actor ON history(harness, session_id, at);
      CREATE TABLE IF NOT EXISTS history_resources (
        revision TEXT NOT NULL, kind TEXT NOT NULL, resource_id TEXT NOT NULL, project_id TEXT, path TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_scope ON history_resources(project_id,kind,resource_id,revision);
    `);
    return db;
  }

  async synchronize(force = false): Promise<string | null> {
    await this.library.manifest();
    // The index has its own lease and reads one committed library state, so
    // rebuilding it never holds back saves or reads of the library itself.
    return withLibraryLock(
      this.library.root,
      () =>
        this.library.readSnapshot((revision) => this.update(revision, force)),
      "index",
    );
  }

  private async update(revision: string | null, force: boolean) {
    const db = this.database();
    try {
      const indexed = db
        .prepare("SELECT value FROM metadata WHERE key='revision'")
        .get()?.value;
      const signaturesReady =
        db
          .prepare("SELECT value FROM metadata WHERE key='signature_version'")
          .get()?.value === EXTRACTION_VERSION;
      if (!force && signaturesReady && indexed === (revision ?? ""))
        return revision;
      const incremental = !force && signaturesReady;
      const history: HistoryEntry[] = [];
      // SQLite libraries sign each page by its resource revision, which
      // changes with any of its nodes, instead of listing every node.
      const sqlite = await this.library.sqlite();
      const tree = revision
        ? await (sqlite
            ? this.library.treeFiles(revision)
            : this.library.tree(revision))
        : [];
      const eligible = (path: string) =>
        !path.startsWith("assets/") &&
        !path.startsWith("runtimes/") &&
        !path.startsWith("imports/") &&
        !path.includes("/history/") &&
        !/\/reader\.json$|\.reader\.json$/.test(path) &&
        !/\/pages\/[^/]+\/nodes\//.test(path) &&
        (path.endsWith(".json") || /\.(tsx?|jsx?|md)$/.test(path));
      const allPaths = tree.map((entry) => entry.path).filter(eligible);
      const signatures = new Map<string, string[]>();
      for (const entry of tree) {
        const node = entry.path.match(
          /^(projects\/[^/]+\/pages\/[^/]+)\/nodes\//,
        );
        const path = node ? node[1] + ".json" : entry.path;
        if (!eligible(path)) continue;
        if (!signatures.has(path)) signatures.set(path, []);
        signatures.get(path)!.push(`${entry.path}:${entry.oid}`);
      }
      if (sqlite && revision) {
        const pages = allPaths.filter((path) =>
          /^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path),
        );
        for (const [path, token] of await this.library.resourceRevisions(
          pages,
          revision,
        ))
          signatures.get(path)!.push(`revision:${token}`);
      }
      const current = new Map(
        allPaths.map((path) => [
          path,
          createHash("sha256")
            .update(JSON.stringify(signatures.get(path)))
            .digest("hex"),
        ]),
      );
      const previous = new Map(
        (
          db.prepare("SELECT path,signature FROM index_state").all() as {
            path: string;
            signature: string;
          }[]
        ).map((row) => [row.path, row.signature]),
      );
      const changed = incremental
        ? [...new Set([...allPaths, ...previous.keys()])].filter(
            (path) => current.get(path) !== previous.get(path),
          )
        : allPaths;
      const reload = new Set(changed);
      // Pages showing a shared dataset's rows hold its page cells.
      if (incremental) {
        const dependents = db.prepare(
          "SELECT source FROM page_datasets WHERE dataset=?",
        );
        for (const path of changed)
          if (resourceForPath(path).kind === "dataset")
            for (const row of dependents.all(path) as { source: string }[])
              if (current.has(row.source)) reload.add(row.source);
      }
      for (const path of changed) {
        const resource = resourceForPath(path);
        if (resource.kind === "component" || resource.kind === "template")
          for (const related of new Set([...allPaths, ...previous.keys()]))
            if (related.startsWith(resource.path + "/")) reload.add(related);
      }
      const paths = allPaths.filter((path) => reload.has(path));
      const rows: SearchRow[] = [],
        edges: ReferenceEdge[] = [],
        pages: PageRow[] = [],
        pageEdges: { source: string; edge: PageReferenceEdge }[] = [],
        bound: { source: string; database: BoundDatabase }[] = [];
      const pageFields = await this.componentPageFields(revision, allPaths);
      // Read bounded batches; the resulting index always names this exact revision.
      for (let offset = 0; offset < paths.length; offset += 32) {
        const batch = await this.library.readFiles(
          paths.slice(offset, offset + 32),
          revision!,
        );
        for (const [path, bytes] of batch)
          this.extract(
            path,
            bytes,
            rows,
            edges,
            pages,
            pageEdges,
            pageFields,
            bound,
          );
      }
      // Page cells of databases whose rows live in a shared dataset, read from
      // each dataset once.
      const datasetPath = (database: BoundDatabase) =>
        `projects/${database.projectId}/datasets/${database.datasetId}.json`;
      const needed = [
        ...new Set(bound.map(({ database }) => datasetPath(database))),
      ].filter((path) => current.has(path));
      const values = new Map<string, unknown>();
      for (let offset = 0; offset < needed.length; offset += 32)
        for (const [path, bytes] of await this.library.readFiles(
          needed.slice(offset, offset + 32),
          revision!,
        ))
          values.set(path, JSON.parse(bytes.toString("utf8")).value);
      for (const { source, database } of bound) {
        const owner = resourceForPath(source);
        for (const edge of boundDatabaseEdges(
          database,
          values.get(datasetPath(database)),
          { projectId: owner.projectId!, pageId: owner.id },
        ))
          pageEdges.push({ source, edge });
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!incremental)
          db.exec(
            "DELETE FROM resources; DELETE FROM search; DELETE FROM refs; DELETE FROM pages; DELETE FROM page_refs; DELETE FROM page_datasets; DELETE FROM history; DELETE FROM history_resources; DELETE FROM index_state;",
          );
        else {
          const deleteSearch = db.prepare(
            "DELETE FROM search WHERE id IN(SELECT id FROM resources WHERE path=?)",
          );
          const deleteRows = db.prepare("DELETE FROM resources WHERE path=?");
          const deleteRefs = db.prepare("DELETE FROM refs WHERE source=?");
          const deletePage = db.prepare("DELETE FROM pages WHERE path=?");
          const deletePageRefs = db.prepare(
            "DELETE FROM page_refs WHERE source=?",
          );
          const deletePageDatasets = db.prepare(
            "DELETE FROM page_datasets WHERE source=?",
          );
          for (const path of reload) {
            deleteSearch.run(path);
            deleteRows.run(path);
            deletePage.run(path);
            deletePageRefs.run(path);
            deletePageDatasets.run(path);
            const resource = resourceForPath(path);
            deleteRefs.run(
              resource.kind === "component" || resource.kind === "template"
                ? resource.path
                : path,
            );
          }
        }
        const rowStatement = db.prepare(
          "INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?)",
        );
        const searchStatement = db.prepare(
          "INSERT INTO search VALUES(?,?,?,?)",
        );
        for (const row of rows) {
          rowStatement.run(
            row.id,
            row.kind,
            row.projectId,
            row.resourceId,
            row.blockId,
            row.title,
            row.body,
            row.path,
            JSON.stringify(row.location),
          );
          searchStatement.run(
            row.id,
            row.title,
            row.body,
            cjkTokens(row.title + " " + row.body).join(" "),
          );
        }
        const refStatement = db.prepare("INSERT INTO refs VALUES(?,?,?,?,?,?)");
        for (const ref of edges)
          refStatement.run(
            ref.source,
            ref.targetKind,
            ref.targetId,
            ref.version ?? null,
            ref.integrity ?? null,
            ref.blockId ?? null,
          );
        const pageStatement = db.prepare(
          "INSERT INTO pages VALUES(?,?,?,?,?,?,?)",
        );
        for (const page of pages)
          pageStatement.run(
            page.path,
            page.projectId,
            page.pageId,
            page.title,
            page.icon ?? null,
            page.archived ? 1 : 0,
            page.updatedAt,
          );
        const pageRefStatement = db.prepare(
          "INSERT INTO page_refs VALUES(?,?,?,?,?,?,?,?)",
        );
        pageEdges.forEach(({ source, edge }, position) =>
          pageRefStatement.run(
            source,
            position,
            edge.blockId,
            edge.projectId,
            edge.pageId,
            JSON.stringify(edge.blockIds),
            edge.kind,
            edge.snippet,
          ),
        );
        const pageDatasetStatement = db.prepare(
          "INSERT INTO page_datasets VALUES(?,?)",
        );
        for (const entry of new Set(
          bound.map(({ source, database }) =>
            JSON.stringify([source, datasetPath(database)]),
          ),
        ))
          pageDatasetStatement.run(...(JSON.parse(entry) as [string, string]));
        const removeSignature = db.prepare(
          "DELETE FROM index_state WHERE path=?",
        );
        const saveSignature = db.prepare(
          "INSERT INTO index_state VALUES(?,?) ON CONFLICT(path) DO UPDATE SET signature=excluded.signature",
        );
        for (const path of reload) {
          const signature = current.get(path);
          if (signature === undefined) removeSignature.run(path);
          else saveSignature.run(path, signature);
        }
        const historyStatement = db.prepare(
          "INSERT INTO history VALUES(?,?,?,?,?,?,?)",
        );
        const scopeStatement = db.prepare(
          "INSERT INTO history_resources VALUES(?,?,?,?,?)",
        );
        for (const entry of [...history].reverse()) {
          historyStatement.run(
            entry.revision,
            entry.at,
            entry.actor.kind,
            entry.actor.harness ?? null,
            entry.actor.sessionId ?? null,
            entry.message ?? "",
            JSON.stringify(entry),
          );
          for (const resource of entry.resources)
            scopeStatement.run(
              entry.revision,
              resource.kind,
              resource.id,
              resource.projectId ?? null,
              resource.path,
            );
        }
        db.prepare(
          "INSERT INTO metadata(key,value) VALUES('revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run(revision ?? "");
        db.prepare(
          "INSERT INTO metadata VALUES('signature_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run(EXTRACTION_VERSION);
        db.prepare(
          "INSERT INTO metadata VALUES('last_path_count',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run(String(paths.length));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return revision;
    } finally {
      db.close();
    }
  }

  /**
   * Page-reference fields of the component versions in this revision. A page
   * resolves its project's version first, then global and published ones,
   * like the catalog.
   */
  private async componentPageFields(
    revision: string | null,
    paths: string[],
  ): Promise<(projectId: string) => ComponentPageFields> {
    const versions = new Map<string, string>();
    for (const path of paths) {
      const match = path.match(
        /^((?:projects\/[^/]+\/)?packages\/(?:published\/)?components\/[^/]+\/[^/]+)\/(manifest|compiled)\.json$/,
      );
      if (match && (match[2] === "manifest" || !versions.has(match[1])))
        versions.set(match[1], path);
    }
    const missing = [...versions.values()].filter(
      (path) => !declaredFields.has(path),
    );
    for (let offset = 0; offset < missing.length; offset += 32)
      for (const [path, bytes] of await this.library.readFiles(
        missing.slice(offset, offset + 32),
        revision!,
      ))
        declaredFields.set(
          path,
          declaredPageFields(JSON.parse(bytes.toString("utf8"))),
        );
    const at = (base: string) => {
      const path = versions.get(base);
      return path ? declaredFields.get(path) : undefined;
    };
    return (projectId) => (id, version) =>
      at(`projects/${projectId}/packages/components/${id}/${version}`) ??
      at(`packages/components/${id}/${version}`) ??
      at(`packages/published/components/${id}/${version}`);
  }

  private extract(
    path: string,
    bytes: Buffer,
    rows: SearchRow[],
    edges: ReferenceEdge[],
    pages: PageRow[],
    pageEdges: { source: string; edge: PageReferenceEdge }[],
    pageFields: (projectId: string) => ComponentPageFields,
    bound: { source: string; database: BoundDatabase }[],
  ): void {
    const owner = resourceForPath(path);
    const add = (
      id: string,
      kind: string,
      title: string,
      body: string,
      blockId: string | null = null,
      location: string[] = [],
    ) =>
      rows.push({
        id,
        kind,
        projectId: owner.projectId ?? null,
        resourceId: owner.id,
        blockId,
        title,
        body,
        path,
        location,
      });
    if (
      !path.endsWith(".json") ||
      ((owner.kind === "component" || owner.kind === "template") &&
        !/\/(?:manifest|compiled|template)\.json$/.test(path))
    ) {
      if (!isUtf8(bytes) || bytes.includes(0)) return;
      add(path, "source", path.split("/").at(-1)!, bytes.toString("utf8"));
      return;
    }
    const value = JSON.parse(bytes.toString("utf8"));
    if (owner.kind === "page") {
      const document = value.document;
      add(path, "page", document.title, "", null, [document.title]);
      pages.push({
        path,
        projectId: owner.projectId!,
        pageId: owner.id,
        title: document.title ?? "",
        icon: typeof document.icon === "string" ? document.icon : undefined,
        archived: document.archived === true,
        updatedAt: String(document.updatedAt ?? ""),
      });
      for (const edge of pageReferenceEdges(
        document,
        owner.projectId!,
        pageFields(owner.projectId!),
        (database) => bound.push({ source: path, database }),
      ))
        pageEdges.push({ source: path, edge });
      // `section` is the nearest preceding heading, which names unnamed native text blocks.
      const visit = (
        node: JSONContent,
        ancestors: string[],
        section?: string,
      ) => {
        const id = node.attrs?.id;
        const ownText = (node.content ?? [])
          .filter((child) => child.type === "text")
          .map((child) => child.text ?? "")
          .join("");
        const named: string | undefined =
          node.attrs?.name ??
          node.attrs?.data?.props?.title ??
          node.attrs?.data?.title ??
          dataHeadings(node.attrs?.data)[0];
        const title =
          named ??
          (node.type === "heading" ? ownText || undefined : section) ??
          (node.type === "widget" ? node.attrs?.kind : undefined) ??
          node.type ??
          "";
        if (typeof id === "string")
          add(
            `${path}#${id}`,
            "page",
            String(title),
            [
              ownText,
              node.type === "drawing" ? node.attrs?.label : undefined,
              ...readableText(node.attrs?.data),
            ]
              .filter(Boolean)
              .join("\n"),
            id,
            [...ancestors, String(title)],
          );
        if (node.type === "widget" || node.type === "inlineWidget") {
          const data = node.attrs?.data;
          edges.push({
            source: path,
            targetKind: "component",
            targetId: data?.componentId ?? node.attrs?.kind ?? "",
            version: data?.version,
            integrity: data?.integrity,
            blockId: id,
          });
          // Components inside its rich text are used by the page too; their
          // text is already part of this block's search row.
          for (const tree of widgetDocuments(data))
            visitContentNodes(tree, (inner: JSONContent) => {
              if (inner.type !== "widget") return;
              edges.push({
                source: path,
                targetKind: "component",
                targetId:
                  inner.attrs?.data?.componentId ?? inner.attrs?.kind ?? "",
                version: inner.attrs?.data?.version,
                integrity: inner.attrs?.data?.integrity,
                blockId: inner.attrs?.id,
              });
            });
        }
        // Lists and paragraphs don't add a location level; named containers and components do.
        const inner =
          named !== undefined || node.type === "widget"
            ? [...ancestors, String(title)]
            : ancestors;
        let current = named !== undefined ? undefined : section;
        for (const child of node.content ?? []) {
          if (child.type === "text") continue;
          if (child.type === "heading") current = richText(child) || current;
          visit(child, inner, current);
          if (child.type === "widget")
            current = dataHeadings(child.attrs?.data).at(-1) ?? current;
        }
      };
      visit(document.content, [document.title]);
    } else if (owner.kind === "component" || owner.kind === "template") {
      // Compiled execution code is retained for rendering, but descriptive search does not index it.
      if (!/\/(?:manifest|compiled|template)\.json$/.test(path)) return;
      const metadata = Object.fromEntries(
        Object.entries(value).filter(([key]) =>
          [
            "id",
            "name",
            "description",
            "category",
            "scenarios",
            "effects",
            "contentGuide",
            "related",
            "examples",
            "defaultData",
          ].includes(key),
        ),
      );
      const id = owner.path;
      const existing = rows.find((row) => row.id === id);
      if (!existing)
        add(
          id,
          owner.kind,
          String(value.name ?? value.id ?? owner.id),
          strings(metadata).join("\n"),
        );
      for (const dependency of value.dependencies ?? [])
        edges.push({
          source: id,
          targetKind: dependency.kind,
          targetId: dependency.id,
          version: dependency.version,
          integrity: dependency.integrity,
        });
      if (value.document?.content)
        visitContentNodes(value.document.content, (node: JSONContent) => {
          if ((node.type === "widget" || node.type === "inlineWidget") && node.attrs?.kind === "custom")
            edges.push({
              source: id,
              targetKind: "component",
              targetId: node.attrs.data.componentId,
              version: node.attrs.data.version,
              integrity: node.attrs.data.integrity,
              blockId: node.attrs.id,
            });
        });
    } else if (owner.kind === "project")
      add(path, "project", value.name, strings(value.folders).join("\n"));
  }

  async search(input: SearchOptions): Promise<{
    items: SearchResult[];
    total: number;
    nextCursor: string | null;
    revision: string | null;
  }> {
    let revision = await this.synchronize();
    const expression = matchQuery(input.query);
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new CoreError("INVALID_DATA", "Search limit must be from 1 to 50.");
    if (!expression) return { items: [], total: 0, nextCursor: null, revision };
    const db = this.database();
    try {
      db.exec("BEGIN");
      revision =
        String(
          db.prepare("SELECT value FROM metadata WHERE key='revision'").get()
            ?.value ?? "",
        ) || null;
      const key = createHash("sha256")
        .update(
          JSON.stringify([revision, input.query, input.projectId, input.kind]),
        )
        .digest("hex");
      let offset = 0;
      if (input.cursor) {
        if (!/^[A-Za-z0-9_-]{1,1024}$/.test(input.cursor))
          throw new CoreError("INVALID_DATA", "Invalid search cursor.");
        const cursor = JSON.parse(
          Buffer.from(input.cursor, "base64url").toString(),
        ) as { key: string; offset: number };
        if (
          cursor.key !== key ||
          !Number.isInteger(cursor.offset) ||
          cursor.offset < 0
        )
          throw new CoreError(
            "CONFLICT",
            "The library or query changed. Restart the search.",
          );
        offset = cursor.offset;
      }
      const filters = ["search MATCH ?"],
        parameters: (string | number)[] = [expression];
      if (input.projectId) {
        filters.push("r.project_id=?");
        parameters.push(input.projectId);
      }
      if (input.kind) {
        filters.push("r.kind=?");
        parameters.push(input.kind);
      }
      const where = filters.join(" AND ");
      const total = Number(
        db
          .prepare(
            `SELECT count(*) AS total FROM search JOIN resources r ON search.id=r.id WHERE ${where}`,
          )
          .get(...parameters)!.total,
      );
      const results = db
        .prepare(
          `SELECT r.*, bm25(search,0,8,1,0.5) AS score,
        snippet(search,2,'[',']','…',24) AS snippet FROM search JOIN resources r ON search.id=r.id
        WHERE ${where} ORDER BY score,r.id LIMIT ? OFFSET ?`,
        )
        .all(...parameters, limit, offset);
      const items = results.map((row): SearchResult => ({
        id: String(row.id),
        kind: String(row.kind),
        projectId: row.project_id === null ? null : String(row.project_id),
        resourceId: String(row.resource_id),
        blockId: row.block_id === null ? null : String(row.block_id),
        title: String(row.title),
        snippet: String(row.snippet),
        path: String(row.path),
        location: JSON.parse(String(row.location)),
        score: Number(row.score),
        revision: revision!,
      }));
      db.exec("COMMIT");
      return {
        items,
        total,
        revision,
        nextCursor:
          offset + items.length < total
            ? Buffer.from(
                JSON.stringify({ key, offset: offset + items.length }),
              ).toString("base64url")
            : null,
      };
    } finally {
      db.close();
    }
  }

  async references(
    targetKind: string,
    targetId: string,
    input: { version?: string; integrity?: string; projectId?: string } = {},
  ): Promise<ReferenceEdge[]> {
    await this.synchronize();
    const db = this.database();
    try {
      const clauses = ["target_kind=?", "target_id=?"],
        values: string[] = [targetKind, targetId];
      if (input.version) {
        clauses.push("version=?");
        values.push(input.version);
      }
      if (input.integrity) {
        clauses.push("integrity=?");
        values.push(input.integrity);
      }
      if (input.projectId) {
        clauses.push("source LIKE ?");
        values.push(`projects/${input.projectId}/%`);
      }
      return db
        .prepare(`SELECT DISTINCT * FROM refs WHERE ${clauses.join(" AND ")}`)
        .all(...values)
        .map((row) => ({
          source: String(row.source),
          targetKind: String(row.target_kind),
          targetId: String(row.target_id),
          ...(row.version ? { version: String(row.version) } : {}),
          ...(row.integrity ? { integrity: String(row.integrity) } : {}),
          ...(row.block_id ? { blockId: String(row.block_id) } : {}),
        }));
    } finally {
      db.close();
    }
  }

  /** References to and from one page, with the block holding each and its surrounding text. */
  async pageReferences(
    projectId: string,
    pageId: string,
    input: PageReferenceOptions = {},
  ): Promise<PageReferences> {
    await this.synchronize();
    const limit = input.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new CoreError(
        "INVALID_DATA",
        "Reference limit must be from 1 to 1000.",
      );
    const direction = input.direction ?? "both";
    const db = this.database();
    try {
      db.exec("BEGIN");
      const revision =
        String(
          db.prepare("SELECT value FROM metadata WHERE key='revision'").get()
            ?.value ?? "",
        ) || null;
      const item = (row: Record<string, unknown>): PageReferenceItem => ({
        projectId: String(row.project),
        pageId: String(row.page),
        title: String(row.title ?? ""),
        ...(row.icon ? { icon: String(row.icon) } : {}),
        blockId: row.block_id === null ? null : String(row.block_id),
        blockIds: JSON.parse(String(row.target_blocks)),
        kind: String(row.kind) as PageReferenceItem["kind"],
        snippet: String(row.snippet),
        ...(row.title === null || row.archived === 1
          ? { missing: true as const }
          : {}),
      });
      const scoped = input.scope ? [input.scope] : [];
      const to =
        direction === "from"
          ? []
          : db
              .prepare(
                `SELECT p.project_id AS project, p.page_id AS page, p.title, p.icon, 0 AS archived,
                   r.block_id, r.target_blocks, r.kind, r.snippet
                 FROM page_refs r JOIN pages p ON p.path=r.source
                 WHERE r.target_project=? AND r.target_page=? AND p.archived=0${input.scope ? " AND p.project_id=?" : ""}
                 ORDER BY p.updated_at DESC, p.path, r.position LIMIT ?`,
              )
              .all(projectId, pageId, ...scoped, limit)
              .map(item);
      const from =
        direction === "to"
          ? []
          : db
              .prepare(
                `SELECT r.target_project AS project, r.target_page AS page, p.title, p.icon, p.archived,
                   r.block_id, r.target_blocks, r.kind, r.snippet
                 FROM page_refs r LEFT JOIN pages p
                   ON p.path='projects/'||r.target_project||'/pages/'||r.target_page||'.json'
                 WHERE r.source=?${input.scope ? " AND r.target_project=?" : ""}
                 ORDER BY r.position LIMIT ?`,
              )
              .all(`projects/${projectId}/pages/${pageId}.json`, ...scoped, limit)
              .map(item);
      const total = {
        to:
          direction === "from"
            ? 0
            : Number(
                db
                  .prepare(
                    `SELECT count(*) AS n FROM page_refs r JOIN pages p ON p.path=r.source
                     WHERE r.target_project=? AND r.target_page=? AND p.archived=0${input.scope ? " AND p.project_id=?" : ""}`,
                  )
                  .get(projectId, pageId, ...scoped)!.n,
              ),
        from:
          direction === "to"
            ? 0
            : Number(
                db
                  .prepare(
                    `SELECT count(*) AS n FROM page_refs r WHERE r.source=?${input.scope ? " AND r.target_project=?" : ""}`,
                  )
                  .get(`projects/${projectId}/pages/${pageId}.json`, ...scoped)!
                  .n,
              ),
      };
      const pages = {
        to:
          direction === "from"
            ? 0
            : Number(
                db
                  .prepare(
                    `SELECT count(DISTINCT r.source) AS n FROM page_refs r JOIN pages p ON p.path=r.source
                     WHERE r.target_project=? AND r.target_page=? AND p.archived=0${input.scope ? " AND p.project_id=?" : ""}`,
                  )
                  .get(projectId, pageId, ...scoped)!.n,
              ),
        from:
          direction === "to"
            ? 0
            : Number(
                db
                  .prepare(
                    `SELECT count(DISTINCT r.target_project||'/'||r.target_page) AS n FROM page_refs r WHERE r.source=?${input.scope ? " AND r.target_project=?" : ""}`,
                  )
                  .get(`projects/${projectId}/pages/${pageId}.json`, ...scoped)!
                  .n,
              ),
      };
      db.exec("COMMIT");
      return { to, from, total, pages, revision };
    } finally {
      db.close();
    }
  }

  async history(
    input: {
      projectId?: string;
      path?: string;
      harness?: string;
      sessionId?: string;
      from?: string;
      to?: string;
      query?: string;
      limit?: number;
      before?: string;
    } = {},
  ): Promise<{
    items: HistoryEntry[];
    nextCursor: string | null;
    revision: string | null;
  }> {
    await this.synchronize();
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new CoreError(
        "INVALID_DATA",
        "History limit must be from 1 to 200.",
      );
    const db = this.database();
    try {
      db.exec("BEGIN");
      const revision =
        String(
          db.prepare("SELECT value FROM metadata WHERE key='revision'").get()
            ?.value ?? "",
        ) || null;
      const clauses: string[] = [],
        values: (string | number)[] = [];
      if (input.projectId || input.path) {
        const scoped: string[] = [];
        if (input.projectId) {
          scoped.push("r.project_id=?");
          values.push(input.projectId);
        }
        if (input.path) {
          scoped.push("r.path=?");
          values.push(input.path);
        }
        clauses.push(
          `EXISTS(SELECT 1 FROM history_resources r WHERE r.revision=h.revision AND ${scoped.join(" AND ")})`,
        );
      }
      if (input.harness) {
        clauses.push("h.harness=?");
        values.push(input.harness);
      }
      if (input.sessionId) {
        clauses.push("h.session_id=?");
        values.push(input.sessionId);
      }
      if (input.query) {
        clauses.push("instr(lower(h.message),lower(?))>0");
        values.push(input.query);
      }
      for (const [key, operator] of [
        ["from", ">="],
        ["to", "<="],
      ] as const)
        if (input[key]) {
          if (!Number.isFinite(Date.parse(input[key]!)))
            throw new CoreError(
              "INVALID_DATA",
              "History time filters require valid dates.",
            );
          clauses.push(`h.at${operator}?`);
          values.push(new Date(input[key]!).toISOString());
        }
      if (input.before) {
        const boundary = db
          .prepare("SELECT rowid FROM history WHERE revision=?")
          .get(input.before);
        if (!boundary)
          throw new CoreError(
            "NOT_FOUND",
            "The history cursor is missing. Restart the history query.",
          );
        clauses.push("h.rowid<?");
        values.push(Number(boundary.rowid));
      }
      const rows = db
        .prepare(
          `SELECT h.payload FROM history h ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY h.rowid DESC LIMIT ?`,
        )
        .all(...values, limit + 1);
      const items = rows
        .slice(0, limit)
        .map((row) => JSON.parse(String(row.payload)) as HistoryEntry);
      db.exec("COMMIT");
      return {
        items,
        revision,
        nextCursor: rows.length > limit ? items.at(-1)!.revision : null,
      };
    } finally {
      db.close();
    }
  }
}
