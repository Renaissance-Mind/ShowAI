import { describe, expect, it } from "vitest";
import { applyOperations, documentHash, normalizeDocument } from "./diff";
import {
  addReply,
  addThread,
  agentCommentView,
  blockIndex,
  deleteComment,
  documentThreads,
  editComment,
  locateAnchor,
  rebaseCommentAnchors,
  setThreadResolved,
  textAnchor,
} from "./comments";
import { mergePageContent } from "./page-merge-model";
import { withChangeContext } from "./history-context";
import { createResource } from "../surface/containers.mjs";
import { blankDocument } from "./catalog";
import type { PageComment, ShowDocument } from "../types";

function page(paragraphs: Record<string, string>, comments: PageComment[] = []) {
  return normalizeDocument({
    id: "page",
    title: "Comments",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    content: {
      type: "doc",
      content: Object.entries(paragraphs).map(([id, text]) => ({
        type: "paragraph",
        attrs: { id },
        content: text ? [{ type: "text", text }] : [],
      })),
    },
    comments,
  });
}
const at = "2026-11-02T00:00:00.000Z";
function anchored(document: ShowDocument, blockId: string, quote: string) {
  const text = (document.content.content!.find((n) => n.attrs?.id === blockId)!
    .content ?? [])
    .map((n) => n.text)
    .join("");
  const from = text.indexOf(quote);
  return addThread(document.comments, {
    id: "t1",
    text: "Check this",
    anchor: textAnchor(blockId, text, from, from + quote.length),
    author: { kind: "person", name: "Ada" },
    at,
  });
}
function setText(document: ShowDocument, blockId: string, text: string) {
  return applyOperations(document, [{ type: "block.text.set", blockId, text }]);
}
function where(document: ShowDocument) {
  const thread = documentThreads(document)[0];
  const location = thread.location;
  if (location.kind !== "text") return location.kind;
  const node = blockIndex(document).get(location.blockId)!.node;
  return `${location.blockId}:${(node.content ?? []).map((n) => n.text).join("").slice(location.from, location.to)}`;
}

describe("comment anchors", () => {
  it("keep the hash of pages without comments", () => {
    const before = page({ a: "Alpha" });
    expect(before.comments).toEqual([]);
    const legacy = page({ a: "Alpha" }, [
      { id: "old", text: "Legacy note", createdAt: at, resolved: false },
    ]);
    expect(documentThreads(legacy)[0].location).toEqual({ kind: "page" });
    expect(documentHash(page({ a: "Alpha" }))).toBe(documentHash(before));
  });

  it("survive edits before, after and inside the quoted text", () => {
    let doc = page({ a: "The quick brown fox jumps" });
    doc = { ...doc, comments: anchored(doc, "a", "brown fox") };
    doc = setText(doc, "a", "Then the quick brown fox jumps");
    expect(where(doc)).toBe("a:brown fox");
    doc = setText(doc, "a", "Then the quick brown fox jumps high");
    expect(where(doc)).toBe("a:brown fox");
    doc = setText(doc, "a", "Then the quick brown sly fox jumps high");
    expect(where(doc)).toBe("a:brown sly fox");
    expect(doc.comments[0].anchor!.quote).toBe("brown sly fox");
  });

  it("prefer the quoted occurrence its context names", () => {
    let doc = page({ a: "one fox, two fox, red fox" });
    const text = "one fox, two fox, red fox";
    doc = {
      ...doc,
      comments: [
        {
          id: "t",
          text: "x",
          createdAt: at,
          resolved: false,
          anchor: textAnchor("a", text, 13, 16),
        },
      ],
    };
    doc = setText(doc, "a", "zero fox, one fox, two fox, red fox");
    const location = locateAnchor(doc.comments[0].anchor, blockIndex(doc));
    expect(location).toEqual({ kind: "text", blockId: "a", from: 23, to: 26 });
  });

  it("detach when the quoted text is deleted and keep the thread", () => {
    let doc = page({ a: "Keep the risky claim here" });
    doc = { ...doc, comments: anchored(doc, "a", "risky claim") };
    doc = setText(doc, "a", "Keep here");
    expect(doc.comments).toHaveLength(1);
    expect(where(doc)).toBe("detached");
    doc = applyOperations(doc, [{ type: "block.remove", blockId: "a" }]);
    expect(where(doc)).toBe("detached");
    expect(agentCommentView(doc)!.open[0]).toMatchObject({ detached: true });
  });

  it("follow text into the block created by splitting a paragraph", () => {
    const before = page({ a: "First half. Second claim here." });
    const commented = { ...before, comments: anchored(before, "a", "Second claim") };
    const split = page(
      { a: "First half. ", b: "Second claim here." },
      commented.comments,
    );
    const after = rebaseCommentAnchors(commented, split);
    expect(after.comments[0].anchor!.blockId).toBe("b");
    expect(where(after)).toBe("b:Second claim");
  });

  it("anchor whole blocks and detach when the block is removed", () => {
    let doc = page({ a: "Alpha", b: "Beta" });
    doc = {
      ...doc,
      comments: addThread([], { id: "t", text: "Whole block", anchor: { blockId: "b" }, at }),
    };
    expect(documentThreads(doc)[0].location).toEqual({ kind: "block", blockId: "b" });
    doc = applyOperations(doc, [{ type: "block.remove", blockId: "b" }]);
    expect(documentThreads(doc)[0].location.kind).toBe("detached");
  });
});

describe("comment threads", () => {
  it("reply, edit, resolve, reopen and delete", () => {
    let list = addThread([], { id: "t", text: " First ", at });
    list = addReply(list, { threadId: "t", id: "r", text: "Reply", at: "2026-11-03T00:00:00.000Z" });
    expect(list[0].text).toBe("First");
    list = editComment(list, "r", "Reply, edited", at);
    expect(list[1]).toMatchObject({ text: "Reply, edited", editedAt: at, threadId: "t" });
    list = setThreadResolved(list, "t", true);
    expect(list[0].resolved).toBe(true);
    list = setThreadResolved(list, "t", false);
    expect(list[0].resolved).toBe(false);
    expect(deleteComment(list, "r")).toHaveLength(1);
    expect(deleteComment(list, "t")).toEqual([]);
    expect(() => addReply(list, { threadId: "missing", text: "x" })).toThrow();
    expect(() => addThread(list, { text: "   " })).toThrow();
  });

  it("list threads in document order with page-level and detached threads last", () => {
    const doc = page({ a: "Alpha text", b: "Beta text" });
    doc.comments = [
      { id: "page", text: "Page", createdAt: at, resolved: false },
      { id: "late", text: "B", createdAt: at, resolved: false, anchor: textAnchor("b", "Beta text", 0, 4) },
      { id: "early", text: "A", createdAt: at, resolved: false, anchor: { blockId: "a" } },
      { id: "gone", text: "G", createdAt: at, resolved: false, anchor: { blockId: "zzz" } },
    ];
    expect(documentThreads(doc).map((thread) => thread.id)).toEqual([
      "early",
      "late",
      "page",
      "gone",
    ]);
  });
});

describe("comment validation", () => {
  const base = { id: "c", text: "x", createdAt: at, resolved: false };
  it.each([
    [{ ...base, author: { kind: "robot" } }, /author/],
    [{ ...base, anchor: { blockId: "" } }, /blockId/],
    [{ ...base, anchor: { blockId: "a", quote: "" } }, /quote/],
    [{ ...base, anchor: { blockId: "a", start: -1 } }, /start/],
    [{ ...base, threadId: "c" }, /itself/],
    [{ ...base, threadId: "t", anchor: { blockId: "a" } }, /anchor/],
    [{ ...base, editedAt: "yesterday" }, /editedAt/],
  ])("rejects %j", (comment, message) => {
    expect(() => page({ a: "A" }, [comment as PageComment])).toThrow(message);
  });
  it("rejects duplicate ids", () => {
    expect(() => page({ a: "A" }, [base, base])).toThrow(/Duplicate/);
  });
});

describe("comment merge", () => {
  const resource = createResource(blankDocument());
  resource.content.content = [
    {
      type: "richText",
      attrs: { id: "rt" },
      content: [
        { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "Alpha text" }] },
        { type: "paragraph", attrs: { id: "b" }, content: [{ type: "text", text: "Beta text" }] },
      ],
    },
  ];
  resource.surfaceViews[resource.content.attrs!.id].readingOrder = ["rt"];
  resource.comments = [
    { id: "t", text: "Existing", createdAt: at, resolved: false, anchor: { blockId: "a" } },
  ];
  const base = normalizeDocument(resource);
  it("merges different threads and replies from two writers without conflicts", () => {
    const ours = { ...base, comments: addReply(addThread(base.comments, { id: "mine", text: "Mine", anchor: { blockId: "b" }, at }), { threadId: "t", id: "r1", text: "Ours", at }) };
    const theirs = { ...base, comments: addReply(setThreadResolved(addThread(base.comments, { id: "theirs", text: "Theirs", at }), "t", true), { threadId: "t", id: "r2", text: "Theirs reply", at }) };
    const merged = mergePageContent(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.document.comments.map((c) => c.id).sort()).toEqual(["mine", "r1", "r2", "t", "theirs"]);
    expect(merged.document.comments.find((c) => c.id === "t")!.resolved).toBe(true);
  });
  it("merges a comment with a concurrent text edit", () => {
    const ours = { ...base, comments: addThread(base.comments, { id: "n", text: "New", anchor: textAnchor("b", "Beta text", 5, 9), at }) };
    const theirs = setText(base, "a", "Alpha text edited");
    const merged = mergePageContent(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.document.comments).toHaveLength(2);
  });
  it("conflicts only when both writers change the same comment differently", () => {
    const ours = { ...base, comments: editComment(base.comments, "t", "Ours", at) };
    const theirs = { ...base, comments: editComment(base.comments, "t", "Theirs", at) };
    const merged = mergePageContent(base, ours, theirs);
    expect(merged.conflicts.map((c) => c.path)).toEqual(["/page/comments/t/text"]);
    expect(mergePageContent(base, ours, theirs, "merge", { "/page/comments/t/text": "theirs" }).document.comments[0].text).toBe("Theirs");
  });
  it("drops replies to a thread the other writer deleted", () => {
    const ours = { ...base, comments: addReply(base.comments, { threadId: "t", id: "r", text: "Reply", at }) };
    const theirs = { ...base, comments: deleteComment(base.comments, "t") };
    const merged = mergePageContent(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.document.comments).toEqual([]);
  });
});

describe("page_apply comment operation", () => {
  const agent = { actor: { kind: "agent" as const, label: "Codex" }, channel: "mcp" as const };
  it("adds, replies to and resolves threads signed by the Agent", () => {
    const doc = page({ a: "Revenue grew 12%", b: "Costs" });
    const added = withChangeContext(agent, () =>
      applyOperations(doc, [
        { type: "comment", text: "Source?", quote: "12%" },
        { type: "comment", text: "Whole block", blockId: "b" },
      ]),
    );
    const [first, second] = added.comments;
    expect(first).toMatchObject({ author: { kind: "agent", name: "Codex" }, anchor: { blockId: "a", quote: "12%" } });
    expect(second.anchor).toEqual({ blockId: "b" });
    const done = withChangeContext(agent, () =>
      applyOperations(added, [
        { type: "comment", threadId: first.id, text: "Added the source.", resolved: true },
      ]),
    );
    expect(done.comments[0].resolved).toBe(true);
    expect(done.comments[2]).toMatchObject({ threadId: first.id, text: "Added the source." });
    expect(agentCommentView(done)).toMatchObject({ open: [{ threadId: second.id, blockId: "b" }], resolved: 1 });
  });
  it("rejects missing quotes, blocks and threads", () => {
    const doc = page({ a: "Alpha" });
    expect(() => applyOperations(doc, [{ type: "comment", text: "x", quote: "nope" }])).toThrow(/quote/);
    expect(() => applyOperations(doc, [{ type: "comment", text: "x", blockId: "zzz" }])).toThrow(/zzz/);
    expect(() => applyOperations(doc, [{ type: "comment", threadId: "zzz", text: "x" }])).toThrow(/zzz/);
    expect(() => applyOperations(doc, [{ type: "comment", resolved: true }])).toThrow(/threadId/);
  });
});
