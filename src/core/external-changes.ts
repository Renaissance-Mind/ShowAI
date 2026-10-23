import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { atomicRename } from "./atomic-rename";
import { diffDocuments } from "./diff";
import type { ChangeActor, ChangeContext } from "./history-model";
import type { ShowDocument } from "./model";
import { assertId } from "./store";

/**
 * Who wrote the current revision of a page, as shown to the person editing it.
 * Session identifiers stay in the library history; the workbench needs only a name.
 */
export interface ChangeAuthor {
  kind: ChangeActor["kind"];
  harness?: string;
  label?: string;
  channel: ChangeContext["channel"];
  at: string;
}

export function changeAuthor(
  entry: Pick<ChangeContext, "actor" | "channel" | "syncOrigin"> & { at: string },
): ChangeAuthor {
  return {
    kind: entry.actor.kind,
    ...(entry.actor.harness ? { harness: entry.actor.harness } : {}),
    ...(entry.actor.label
      ? { label: entry.actor.label }
      : entry.syncOrigin?.sourceUser
        ? { label: entry.syncOrigin.sourceUser.name }
        : {}),
    channel: entry.channel,
    at: entry.at,
  };
}

/**
 * A write by another writer (an Agent through MCP or the CLI, another window)
 * that the workbench installed into an open page. `before` is the page as it
 * was immediately before that write, `after` the version the write produced;
 * 「撤销此次修改」 merges the inverse of after→before into the current page.
 */
export interface ExternalChange {
  id: string;
  projectId: string;
  pageId: string;
  /** When the workbench installed the write. */
  at: string;
  revision?: string;
  hash: string;
  author?: ChangeAuthor;
  /** Added, edited or moved blocks still present after the write, in document order. */
  blockIds: string[];
  /** Changed places: blocks added, edited, moved or removed, plus page fields. */
  count: number;
}
export interface StoredExternalChange extends ExternalChange {
  before: ShowDocument;
  after: ShowDocument;
}

/** Snapshots are a short-lived safety net, not page history. */
export const EXTERNAL_CHANGE_LIMIT = 5;
export const EXTERNAL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

const directory = (root: string, projectId: string) =>
  join(root, "local", "external-changes", assertId(projectId));
const file = (root: string, projectId: string, pageId: string) =>
  join(directory(root, projectId), `${assertId(pageId)}.json`);

export function summarizeChange(before: ShowDocument, after: ShowDocument) {
  const changes = diffDocuments(before, after);
  const order = new Map<string, number>();
  let index = 0;
  const visit = (node: { attrs?: Record<string, unknown> | null; content?: unknown[] }) => {
    const id = node.attrs?.id;
    if (typeof id === "string" && !order.has(id)) order.set(id, index++);
    for (const child of (node.content ?? []) as (typeof node)[]) visit(child);
  };
  visit(after.content as Parameters<typeof visit>[0]);
  const present = new Set<string>();
  let removed = 0,
    page = 0;
  for (const change of changes) {
    if (change.type === "page.changed") page = 1;
    else if (change.type === "block.removed") removed++;
    else present.add(change.blockId);
  }
  // A changed parent and its changed children are separate places only when
  // the parent changed itself; diffDocuments already reports them that way.
  const blockIds = [...present].sort(
    (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
  return { blockIds, count: blockIds.length + removed + page };
}

async function readEntries(path: string): Promise<StoredExternalChange[]> {
  const text = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (text === null) return [];
  const value = JSON.parse(text) as {
    format?: string;
    entries?: StoredExternalChange[];
  };
  if (value.format !== "showai-external-changes" || !Array.isArray(value.entries))
    throw new Error(`Unrecognized external change snapshots: ${path}`);
  return value.entries;
}
async function writeEntries(path: string, entries: StoredExternalChange[]) {
  if (!entries.length) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({ format: "showai-external-changes", version: 1, entries }),
  );
  await atomicRename(temporary, path);
}
const fresh = (entries: StoredExternalChange[], now: number) =>
  entries.filter((entry) => now - Date.parse(entry.at) < EXTERNAL_CHANGE_TTL_MS);

/** One writer per page file inside this process; renderers call through it. */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(path: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  queues.set(path, next);
  void next.finally(() => {
    if (queues.get(path) === next) queues.delete(path);
  });
  return next;
}

/**
 * Records the snapshot before an installed external write. Returns null when
 * the write changed nothing visible (only timestamps).
 */
export function recordExternalChange(
  root: string,
  input: {
    projectId: string;
    pageId: string;
    before: ShowDocument;
    after: ShowDocument;
    revision?: string;
    hash: string;
    author?: ChangeAuthor;
  },
  now = Date.now(),
): Promise<ExternalChange | null> {
  const { blockIds, count } = summarizeChange(input.before, input.after);
  if (!count) return Promise.resolve(null);
  const path = file(root, input.projectId, input.pageId);
  return serialized(path, async () => {
    const entry: StoredExternalChange = {
      id: randomUUID(),
      projectId: input.projectId,
      pageId: input.pageId,
      at: new Date(now).toISOString(),
      ...(input.revision ? { revision: input.revision } : {}),
      hash: input.hash,
      ...(input.author ? { author: input.author } : {}),
      blockIds,
      count,
      before: input.before,
      after: input.after,
    };
    const entries = [
      entry,
      ...fresh(await readEntries(path), now).filter(
        (item) => item.hash !== input.hash || item.revision !== input.revision,
      ),
    ].slice(0, EXTERNAL_CHANGE_LIMIT);
    await writeEntries(path, entries);
    const { before: _before, after: _after, ...summary } = entry;
    return summary;
  });
}

/** Newest first; expired snapshots are removed on read. */
export function listExternalChanges(
  root: string,
  projectId: string,
  pageId: string,
  now = Date.now(),
): Promise<StoredExternalChange[]> {
  const path = file(root, projectId, pageId);
  return serialized(path, async () => {
    const entries = await readEntries(path);
    const kept = fresh(entries, now);
    if (kept.length !== entries.length) await writeEntries(path, kept);
    return kept;
  });
}

export function dismissExternalChange(
  root: string,
  projectId: string,
  pageId: string,
  id: string,
): Promise<void> {
  const path = file(root, projectId, pageId);
  return serialized(path, async () => {
    const entries = await readEntries(path);
    const kept = entries.filter((entry) => entry.id !== id);
    if (kept.length !== entries.length) await writeEntries(path, kept);
  });
}

/** Removes every page file whose snapshots have all expired. */
export async function pruneExternalChanges(root: string, now = Date.now()) {
  const base = join(root, "local", "external-changes");
  const projects = await readdir(base).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  for (const project of projects)
    for (const name of await readdir(join(base, project)))
      if (name.endsWith(".json"))
        await listExternalChanges(root, project, name.slice(0, -5), now);
}
