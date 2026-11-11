import { agentAuthored, agentLabel } from "./agent-created";
import {
  addReply,
  addThread,
  blockIndex,
  isTextBlock,
  setThreadResolved,
  textAnchor,
  textBlockText,
  type CommentAnchor,
  type CommentAuthor,
  type PageComment,
} from "./comments";
import { changeContext } from "./history-context";
import { CoreError, type PageOperation, type ShowDocument } from "./model";

type CommentOperation = Extract<PageOperation, { type: "comment" }>;

/** The writer of this change: an Agent through MCP/CLI, otherwise the person. */
export function contextAuthor(): CommentAuthor {
  const context = changeContext();
  if (agentAuthored(context))
    return { kind: "agent", name: agentLabel(context) ?? "Agent" };
  return {
    kind: "person",
    ...(context.actor.label ? { name: context.actor.label } : {}),
  };
}

function anchorFor(
  document: ShowDocument,
  blockId: string | undefined,
  quote: string | undefined,
): CommentAnchor | undefined {
  if (blockId === undefined && quote === undefined) return undefined;
  const blocks = blockIndex(document);
  if (blockId !== undefined && !blocks.has(blockId))
    throw new CoreError("NOT_FOUND", `Block ${blockId} does not exist.`);
  if (!quote) return { blockId: blockId! };
  const candidates =
    blockId !== undefined ? [[blockId, blocks.get(blockId)!] as const] : [...blocks];
  for (const [id, entry] of candidates) {
    if (!isTextBlock(entry.node)) continue;
    const text = textBlockText(entry.node);
    const from = text.indexOf(quote);
    if (from >= 0) return textAnchor(id, text, from, from + quote.length);
  }
  throw new CoreError(
    "INVALID_DATA",
    `The quote was not found in ${blockId ? `paragraph, heading or code block ${blockId}` : "any paragraph, heading or code block"}. Quote text exactly as page_read shows it, within one block.`,
  );
}

/**
 * page_apply {type:"comment"}: without threadId it starts a thread on a block
 * (blockId), on text (quote, optionally inside blockId) or on the page; with
 * threadId it replies (text) and/or resolves or reopens (resolved).
 */
export function applyCommentOperation(
  document: ShowDocument,
  operation: CommentOperation,
): PageComment[] {
  const comments = document.comments ?? [];
  const author = contextAuthor();
  const { threadId, text, blockId, quote, resolved } = operation;
  for (const [key, value] of Object.entries({ threadId, text, blockId, quote }))
    if (value !== undefined && typeof value !== "string")
      throw new CoreError("INVALID_DATA", `comment ${key} must be a string.`);
  if (resolved !== undefined && typeof resolved !== "boolean")
    throw new CoreError("INVALID_DATA", "comment resolved must be true or false.");
  try {
    if (threadId !== undefined) {
      if (blockId !== undefined || quote !== undefined)
        throw new CoreError(
          "INVALID_DATA",
          "A reply belongs to its thread's anchor; omit blockId and quote with threadId.",
        );
      if (text === undefined && resolved === undefined)
        throw new CoreError(
          "INVALID_DATA",
          "A comment operation with threadId needs text (reply) or resolved.",
        );
      let next = comments;
      if (text !== undefined) next = addReply(next, { threadId, text, author });
      if (resolved !== undefined) next = setThreadResolved(next, threadId, resolved);
      return next;
    }
    if (resolved !== undefined)
      throw new CoreError("INVALID_DATA", "resolved needs the threadId of the thread.");
    if (text === undefined)
      throw new CoreError("INVALID_DATA", "A new comment needs text.");
    return addThread(comments, {
      text,
      author,
      anchor: anchorFor(document, blockId, quote),
    });
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw new CoreError(
      "INVALID_DATA",
      error instanceof Error ? error.message : String(error),
    );
  }
}
