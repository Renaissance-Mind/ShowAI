/**
 * Page comments: threads anchored to a text range in a text block or to a
 * whole block (component, board object, any block with a stable id).
 *
 * `document.comments` stays a flat list so that pages without comments keep
 * their bytes and hashes, and concurrent writers merge record by record. A
 * thread is its first comment plus the comments whose `threadId` names it.
 * Text anchors quote the text with a little context instead of storing
 * positions, so they survive edits around them and edits by any writer; when
 * the quoted text is gone the thread is detached but kept.
 */
import type { JSONContent } from "@tiptap/core";
import type { CommentAnchor, CommentAuthor, PageComment, ShowDocument } from "../types";
import { walk } from "../document/walk.mjs";

export type { CommentAnchor, CommentAuthor, PageComment };

const TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);
/** Inline leaves (hard breaks, inline math) take one position in the editor. */
const INLINE_LEAF = "￼";
const CONTEXT = 32;
export const COMMENT_TEXT_LIMIT = 10_000;

export interface CommentThread {
  id: string;
  root: PageComment;
  replies: PageComment[];
  anchor?: CommentAnchor;
  resolved: boolean;
}

export type AnchorLocation =
  | { kind: "page" }
  | { kind: "block"; blockId: string }
  | { kind: "text"; blockId: string; from: number; to: number }
  | { kind: "detached"; blockId: string };

export function isTextBlock(node: JSONContent | undefined): boolean {
  return !!node && TEXT_BLOCKS.has(node.type ?? "");
}

/** Text of a text block with each inline leaf as one character, matching editor offsets. */
export function textBlockText(node: JSONContent): string {
  return (node.content ?? [])
    .map((child) =>
      child.type === "text" ? (child.text ?? "") : INLINE_LEAF,
    )
    .join("");
}

export function blockIndex(document: ShowDocument) {
  const blocks = new Map<string, { node: JSONContent; order: number }>();
  let order = 0;
  // Comment highlights render on the page tree, so anchors address its blocks.
  walk(document.content, (node, { parent }) => {
    if (!parent || node.type === "text") return;
    const id = node.attrs?.id;
    if (typeof id === "string" && id && !blocks.has(id))
      blocks.set(id, { node, order: order++ });
  }, { scope: "tree" });
  return blocks;
}

export function textAnchor(
  blockId: string,
  text: string,
  from: number,
  to: number,
): CommentAnchor {
  return {
    blockId,
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
    start: from,
  };
}

function sharedSuffix(a: string, b: string) {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  )
    length++;
  return length;
}
function sharedPrefix(a: string, b: string) {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length])
    length++;
  return length;
}

/** The occurrence of the quote that best matches its context, or -1. */
export function findQuote(text: string, anchor: CommentAnchor): number {
  const quote = anchor.quote ?? "";
  if (!quote) return -1;
  let best = -1;
  let bestScore = -1;
  let bestDistance = Infinity;
  for (
    let index = text.indexOf(quote);
    index >= 0;
    index = text.indexOf(quote, index + 1)
  ) {
    const score =
      sharedSuffix(text.slice(0, index), anchor.prefix ?? "") +
      sharedPrefix(text.slice(index + quote.length), anchor.suffix ?? "");
    const distance = Math.abs(index - (anchor.start ?? 0));
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = index;
      bestScore = score;
      bestDistance = distance;
    }
  }
  return best;
}

export function locateAnchor(
  anchor: CommentAnchor | undefined,
  blocks: ReturnType<typeof blockIndex>,
): AnchorLocation {
  if (!anchor) return { kind: "page" };
  const block = blocks.get(anchor.blockId);
  if (!block) return { kind: "detached", blockId: anchor.blockId };
  if (anchor.quote === undefined)
    return { kind: "block", blockId: anchor.blockId };
  if (!isTextBlock(block.node))
    return { kind: "detached", blockId: anchor.blockId };
  const from = findQuote(textBlockText(block.node), anchor);
  return from < 0
    ? { kind: "detached", blockId: anchor.blockId }
    : {
        kind: "text",
        blockId: anchor.blockId,
        from,
        to: from + anchor.quote.length,
      };
}

export function commentThreads(comments: readonly PageComment[]): CommentThread[] {
  const threads = new Map<string, CommentThread>();
  const replies: PageComment[] = [];
  for (const comment of comments) {
    if (comment.threadId) replies.push(comment);
    else
      threads.set(comment.id, {
        id: comment.id,
        root: comment,
        replies: [],
        anchor: comment.anchor,
        resolved: comment.resolved,
      });
  }
  for (const reply of replies) {
    const thread = threads.get(reply.threadId!);
    // A reply whose first comment was deleted concurrently keeps its own thread.
    if (thread) thread.replies.push(reply);
    else
      threads.set(reply.threadId!, {
        id: reply.threadId!,
        root: reply,
        replies: [],
        resolved: reply.resolved,
      });
  }
  for (const thread of threads.values())
    thread.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...threads.values()];
}

export interface LocatedThread extends CommentThread {
  location: AnchorLocation;
}

/** Threads in reading order: by anchor block and offset; page-level and detached last. */
export function documentThreads(document: ShowDocument): LocatedThread[] {
  const comments = document.comments ?? [];
  if (!comments.length) return [];
  const blocks = blockIndex(document);
  const located = commentThreads(comments).map((thread) => ({
    ...thread,
    location: locateAnchor(thread.anchor, blocks),
  }));
  const rank = (thread: LocatedThread) =>
    thread.location.kind === "block" || thread.location.kind === "text"
      ? blocks.get(thread.location.blockId)!.order
      : Infinity;
  const offset = (thread: LocatedThread) =>
    thread.location.kind === "text" ? thread.location.from : -1;
  return located.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      offset(a) - offset(b) ||
      a.root.createdAt.localeCompare(b.root.createdAt),
  );
}

// Thread operations. Each returns a new list; callers save it as `comments`.

export function newCommentId() {
  return `comment-${crypto.randomUUID()}`;
}

function checkedText(text: string) {
  const value = text.trim();
  if (!value) throw new Error("A comment needs text.");
  if (value.length > COMMENT_TEXT_LIMIT)
    throw new Error(`A comment holds at most ${COMMENT_TEXT_LIMIT} characters.`);
  return value;
}

export function addThread(
  comments: readonly PageComment[],
  input: {
    text: string;
    anchor?: CommentAnchor;
    author?: CommentAuthor;
    id?: string;
    at?: string;
  },
): PageComment[] {
  return [
    ...comments,
    {
      id: input.id ?? newCommentId(),
      text: checkedText(input.text),
      createdAt: input.at ?? new Date().toISOString(),
      resolved: false,
      ...(input.anchor ? { anchor: input.anchor } : {}),
      ...(input.author ? { author: input.author } : {}),
    },
  ];
}

function requireThread(comments: readonly PageComment[], threadId: string) {
  if (!comments.some((c) => c.id === threadId || c.threadId === threadId))
    throw new Error(`Comment thread ${threadId} does not exist.`);
}

export function addReply(
  comments: readonly PageComment[],
  input: {
    threadId: string;
    text: string;
    author?: CommentAuthor;
    id?: string;
    at?: string;
  },
): PageComment[] {
  requireThread(comments, input.threadId);
  return [
    ...comments,
    {
      id: input.id ?? newCommentId(),
      threadId: input.threadId,
      text: checkedText(input.text),
      createdAt: input.at ?? new Date().toISOString(),
      resolved: false,
      ...(input.author ? { author: input.author } : {}),
    },
  ];
}

export function editComment(
  comments: readonly PageComment[],
  id: string,
  text: string,
  at = new Date().toISOString(),
): PageComment[] {
  if (!comments.some((c) => c.id === id))
    throw new Error(`Comment ${id} does not exist.`);
  const value = checkedText(text);
  return comments.map((comment) =>
    comment.id === id ? { ...comment, text: value, editedAt: at } : comment,
  );
}

/** Deleting a thread's first comment deletes the thread. */
export function deleteComment(
  comments: readonly PageComment[],
  id: string,
): PageComment[] {
  return comments.filter(
    (comment) => comment.id !== id && comment.threadId !== id,
  );
}

/** Resolution lives on the thread's first comment. */
export function setThreadResolved(
  comments: readonly PageComment[],
  threadId: string,
  resolved: boolean,
): PageComment[] {
  requireThread(comments, threadId);
  const root = commentThreads(comments).find((t) => t.id === threadId)!.root;
  return comments.map((comment) =>
    comment.id === root.id ? { ...comment, resolved } : comment,
  );
}

// Keeping anchors on their text through edits.

/** Map an offset through the single changed region between two texts. */
function mapOffset(
  before: string,
  after: string,
  offset: number,
  assoc: -1 | 1,
): number {
  const limit = Math.min(before.length, after.length);
  const head = sharedPrefix(before, after);
  let tail = sharedSuffix(before, after);
  tail = Math.min(tail, limit - head);
  const changedEnd = before.length - tail;
  const delta = after.length - before.length;
  if (offset < head) return offset;
  if (offset > changedEnd) return offset + delta;
  // Text typed exactly at an anchor's edge stays outside the anchor.
  if (head === changedEnd) return assoc < 0 ? offset : offset + delta;
  if (offset === head) return head;
  if (offset === changedEnd) return changedEnd + delta;
  return assoc < 0 ? head : changedEnd + delta;
}

/**
 * Carry text anchors from `before` to `after`: an anchor whose quoted text was
 * edited follows the edit, an anchor whose text moved to a new block (a split
 * or a join) follows it, and an anchor whose text was deleted stays as it was
 * and therefore detached. Returns `after` itself when nothing changes.
 */
export function rebaseCommentAnchors(
  before: ShowDocument,
  after: ShowDocument,
): ShowDocument {
  const comments = after.comments ?? [];
  if (!comments.some((comment) => comment.anchor?.quote)) return after;
  const old = blockIndex(before);
  const next = blockIndex(after);
  let changed = false;
  const rebased = comments.map((comment) => {
    const anchor = comment.anchor;
    if (!anchor?.quote) return comment;
    const previous = locateAnchor(anchor, old);
    if (previous.kind !== "text") return comment;
    const oldText = textBlockText(old.get(anchor.blockId)!.node);
    const target = next.get(anchor.blockId);
    if (target && isTextBlock(target.node)) {
      const newText = textBlockText(target.node);
      if (newText === oldText) return comment;
      const from = mapOffset(oldText, newText, previous.from, 1);
      const to = mapOffset(oldText, newText, previous.to, -1);
      if (to > from) {
        const moved = textAnchor(anchor.blockId, newText, from, to);
        const current = locateAnchor(anchor, next);
        if (
          current.kind === "text" &&
          current.from === from &&
          current.to === to
        )
          return comment;
        changed = true;
        return { ...comment, anchor: moved };
      }
    }
    // The quoted text may now live in a block created or changed by this edit.
    const candidates = [...next].filter(
      ([id, entry]) =>
        isTextBlock(entry.node) &&
        (!old.has(id) ||
          textBlockText(old.get(id)!.node) !== textBlockText(entry.node)),
    );
    for (const [id, entry] of candidates) {
      const text = textBlockText(entry.node);
      const from = findQuote(text, anchor);
      if (from < 0 || id === anchor.blockId) continue;
      changed = true;
      return {
        ...comment,
        anchor: textAnchor(id, text, from, from + anchor.quote.length),
      };
    }
    return comment;
  });
  return changed ? { ...after, comments: rebased } : after;
}

// Validation of the fields comments gained after the original
// {id,text,createdAt,resolved} shape. The portable reader keeps its own
// lenient check; saves go through this one.

function isDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function shortString(value: unknown, max = 200) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function validateComments(comments: readonly PageComment[]): void {
  const ids = new Set<string>();
  for (const comment of comments) {
    if (ids.has(comment.id))
      throw new Error(`Duplicate comment id: ${comment.id}.`);
    ids.add(comment.id);
    if (comment.threadId !== undefined) {
      if (!shortString(comment.threadId))
        throw new Error("comment.threadId must be a comment id.");
      if (comment.threadId === comment.id)
        throw new Error("A comment cannot reply to itself.");
      if (comment.anchor !== undefined)
        throw new Error("A reply takes its thread's anchor; remove reply.anchor.");
    }
    if (comment.editedAt !== undefined && !isDate(comment.editedAt))
      throw new Error("comment.editedAt must be an ISO date string.");
    const author = comment.author;
    if (author !== undefined) {
      if (
        typeof author !== "object" ||
        author === null ||
        (author.kind !== "person" && author.kind !== "agent") ||
        (author.name !== undefined && !shortString(author.name)) ||
        (author.id !== undefined && !shortString(author.id))
      )
        throw new Error(
          'comment.author must be {kind:"person"|"agent", name?, id?}.',
        );
    }
    const anchor = comment.anchor;
    if (anchor !== undefined) {
      if (typeof anchor !== "object" || anchor === null || !shortString(anchor.blockId))
        throw new Error("comment.anchor.blockId must be a block id.");
      for (const key of ["quote", "prefix", "suffix"] as const)
        if (
          anchor[key] !== undefined &&
          (typeof anchor[key] !== "string" ||
            anchor[key]!.length > COMMENT_TEXT_LIMIT)
        )
          throw new Error(`comment.anchor.${key} must be text.`);
      if (anchor.quote === "")
        throw new Error("comment.anchor.quote must not be empty; omit it to anchor the whole block.");
      if (
        anchor.start !== undefined &&
        (!Number.isInteger(anchor.start) || anchor.start < 0)
      )
        throw new Error("comment.anchor.start must be a non-negative integer.");
    }
  }
}

/** Open threads as an Agent reads them with a page; resolved ones are only counted. */
export function agentCommentView(document: ShowDocument, blockIds?: string[]) {
  const scope = blockIds ? new Set(blockIds) : undefined;
  const threads = documentThreads(document).filter(
    (thread) =>
      !scope ||
      (thread.location.kind !== "page" && scope.has(thread.location.blockId)),
  );
  const open = threads.filter((thread) => !thread.resolved);
  if (!threads.length) return undefined;
  return {
    open: open.map((thread) => ({
      threadId: thread.id,
      ...(thread.anchor
        ? {
            blockId: thread.anchor.blockId,
            ...(thread.anchor.quote ? { quote: thread.anchor.quote } : {}),
          }
        : {}),
      ...(thread.location.kind === "detached" ? { detached: true } : {}),
      comments: [thread.root, ...thread.replies].map((comment) => ({
        id: comment.id,
        ...(comment.author
          ? { author: `${comment.author.kind === "agent" ? "agent" : "person"}${comment.author.name ? `:${comment.author.name}` : ""}` }
          : {}),
        text: comment.text,
        at: comment.createdAt,
      })),
    })),
    resolved: threads.length - open.length,
  };
}
