import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { LocatedThread } from "../core/comments";

export interface HighlightSource {
  /** Open threads located in the current document. */
  threads(): LocatedThread[];
  active(): string | null;
  open(threadId: string, rect: DOMRect): void;
}

interface Painted {
  thread: string;
  from: number;
  to: number;
  range: Range;
}

/** Editor positions of the open text threads in one editor document. */
function anchoredRanges(doc: ProseMirrorNode, threads: LocatedThread[]) {
  const wanted = new Set(
    threads.flatMap((thread) =>
      thread.location.kind === "text" ? [thread.location.blockId] : [],
    ),
  );
  if (!wanted.size) return [];
  const positions = new Map<string, number>();
  doc.descendants((node, pos) => {
    const id = node.attrs?.id;
    if (typeof id === "string" && wanted.has(id) && node.isTextblock)
      positions.set(id, pos);
    return positions.size < wanted.size;
  });
  const result: { thread: string; from: number; to: number }[] = [];
  for (const thread of threads) {
    const location = thread.location;
    if (location.kind !== "text") continue;
    const pos = positions.get(location.blockId);
    if (pos === undefined) continue;
    const to = Math.min(location.to, doc.nodeAt(pos)!.content.size);
    if (location.from < to)
      result.push({ thread: thread.id, from: pos + 1 + location.from, to: pos + 1 + to });
  }
  return result;
}

/**
 * Quiet highlights for open text comments, painted with the CSS Custom
 * Highlight API so neither the document nor the editor DOM changes.
 * `refresh` repaints every editor using this extension.
 */
export function commentHighlights(source: HighlightSource) {
  const painted = new Map<EditorView, Painted[]>();
  const views = new Set<EditorView>();
  const measure = (view: EditorView) => {
    const items = anchoredRanges(view.state.doc, source.threads()).map(
      ({ thread, from, to }) => {
        const range = document.createRange();
        const start = view.domAtPos(from);
        const end = view.domAtPos(to);
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return { thread, from, to, range };
      },
    );
    if (items.length) painted.set(view, items);
    else painted.delete(view);
  };
  const paint = () => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const active = source.active();
    const quiet: Range[] = [];
    const strong: Range[] = [];
    for (const items of painted.values())
      for (const item of items)
        (item.thread === active ? strong : quiet).push(item.range);
    CSS.highlights.set("showai-comment", new Highlight(...quiet));
    CSS.highlights.set("showai-comment-active", new Highlight(...strong));
  };
  const extension = Extension.create({
    name: "showaiCommentHighlights",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleClick(view, pos) {
              if (!view.state.selection.empty) return false;
              const hit = painted
                .get(view)
                ?.find((item) => pos >= item.from && pos <= item.to);
              if (hit) source.open(hit.thread, hit.range.getBoundingClientRect());
              return false;
            },
          },
          view(view) {
            views.add(view);
            measure(view);
            paint();
            return {
              update(next, previous) {
                if (next.state.doc === previous.doc) return;
                measure(next);
                paint();
              },
              destroy() {
                views.delete(view);
                painted.delete(view);
                paint();
              },
            };
          },
        }),
      ];
    },
  });
  return {
    extension,
    refresh() {
      views.forEach((view) => measure(view));
      paint();
    },
    /** Client rects of a thread's highlighted text, for scrolling and flashing. */
    rects(threadId: string) {
      // Ranges go stale when an editor re-renders its DOM (e.g. leaving a Board).
      views.forEach((view) => measure(view));
      paint();
      return [...painted.values()]
        .flat()
        .filter((item) => item.thread === threadId)
        .flatMap((item) => [...item.range.getClientRects()]);
    },
  };
}
