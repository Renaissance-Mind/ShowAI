import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { ContentLibrary as GitLibrary } from "./content-library";
import { resourceForPath, type HistoryEntry } from "./history-model";
import { withLibraryLock } from "./library-lock";
import { CoreError } from "./model";
import type { JSONContent } from "@tiptap/core";

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
const EXTRACTION_VERSION = "2";
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
    return withLibraryLock(this.library.root, async () => {
      const revision = await this.library.head();
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
        const tree = revision ? await this.library.tree(revision) : [];
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
        for (const path of changed) {
          const resource = resourceForPath(path);
          if (resource.kind === "component" || resource.kind === "template")
            for (const related of new Set([...allPaths, ...previous.keys()]))
              if (related.startsWith(resource.path + "/")) reload.add(related);
        }
        const paths = allPaths.filter((path) => reload.has(path));
        const rows: SearchRow[] = [],
          edges: ReferenceEdge[] = [];
        // Read bounded batches; the resulting index always names this exact revision.
        for (let offset = 0; offset < paths.length; offset += 32) {
          const batch = await this.library.readFiles(
            paths.slice(offset, offset + 32),
            revision!,
          );
          for (const [path, bytes] of batch)
            this.extract(path, bytes, rows, edges);
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          if (!incremental)
            db.exec(
              "DELETE FROM resources; DELETE FROM search; DELETE FROM refs; DELETE FROM history; DELETE FROM history_resources; DELETE FROM index_state;",
            );
          else {
            const deleteSearch = db.prepare(
              "DELETE FROM search WHERE id IN(SELECT id FROM resources WHERE path=?)",
            );
            const deleteRows = db.prepare("DELETE FROM resources WHERE path=?");
            const deleteRefs = db.prepare("DELETE FROM refs WHERE source=?");
            for (const path of reload) {
              deleteSearch.run(path);
              deleteRows.run(path);
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
          const refStatement = db.prepare(
            "INSERT INTO refs VALUES(?,?,?,?,?,?)",
          );
          for (const ref of edges)
            refStatement.run(
              ref.source,
              ref.targetKind,
              ref.targetId,
              ref.version ?? null,
              ref.integrity ?? null,
              ref.blockId ?? null,
            );
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
    });
  }

  private extract(
    path: string,
    bytes: Buffer,
    rows: SearchRow[],
    edges: ReferenceEdge[],
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
            [ownText, ...readableText(node.attrs?.data)]
              .filter(Boolean)
              .join("\n"),
            id,
            [...ancestors, String(title)],
          );
        if (node.type === "widget") {
          const data = node.attrs?.data;
          edges.push({
            source: path,
            targetKind: "component",
            targetId: data?.componentId ?? node.attrs?.kind ?? "",
            version: data?.version,
            integrity: data?.integrity,
            blockId: id,
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
      if (value.document?.content) {
        const visit = (node: JSONContent) => {
          if (node.type === "widget" && node.attrs?.kind === "custom")
            edges.push({
              source: id,
              targetKind: "component",
              targetId: node.attrs.data.componentId,
              version: node.attrs.data.version,
              integrity: node.attrs.data.integrity,
              blockId: node.attrs.id,
            });
          node.content?.forEach(visit);
        };
        visit(value.document.content);
      }
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
