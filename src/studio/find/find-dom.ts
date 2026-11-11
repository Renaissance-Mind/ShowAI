import type { Editor } from "@tiptap/core";
import { textRangeEditMeta } from "../../components/rich-text/text-range-edit";
import {
  findInSegments,
  replacementOrder,
  type EditorRange,
  type FindOptions,
  type SegmentMatch,
} from "./find-model";

/**
 * Text that belongs to the page: editor content (page text, text inside
 * components that the editor owns, board text objects) and the same content
 * rendered for reading on read-only pages.
 */
const TEXT_ROOT = ".ProseMirror, .portable-content";
/** Component bodies, interface chrome and decorations inside text roots. */
const SKIPPED =
  '[contenteditable="false"], .portable-widget, [aria-hidden="true"], [data-surface-ui], svg, canvas, script, style, template, textarea, input, button, select';
const BLOCKS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "UL",
  "OL",
  "TD",
  "TH",
  "TR",
  "TABLE",
  "PRE",
  "BLOCKQUOTE",
  "DIV",
  "SECTION",
  "FIGCAPTION",
  "DT",
  "DD",
  "SUMMARY",
  "DETAILS",
  "HR",
  "BR",
]);

interface Piece {
  node: Text;
  /** Where this text node starts in its segment's text. */
  start: number;
}
export interface TextSegment {
  text: string;
  pieces: Piece[];
  root: HTMLElement;
}
export interface PageMatch extends SegmentMatch {
  range: Range;
  root: HTMLElement;
}

const visible = (element: Element) =>
  typeof element.checkVisibility === "function"
    ? element.checkVisibility()
    : element.getClientRects().length > 0;

/** The page's text, split at block boundaries, in reading order. */
export function collectSegments(container: HTMLElement): TextSegment[] {
  const segments: TextSegment[] = [];
  let current: TextSegment | null = null;
  const end = () => {
    if (current?.text) segments.push(current);
    current = null;
  };
  const visit = (element: Element, root: HTMLElement | null) => {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!root) continue;
        const node = child as Text;
        const value = node.data;
        if (!value) continue;
        if (current?.root !== root) {
          end();
          current = { text: "", pieces: [], root };
        }
        const segment: TextSegment = current!;
        segment.pieces.push({ node, start: segment.text.length });
        segment.text += value;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const next = child as Element;
      const isRoot = next.matches(TEXT_ROOT);
      if (!isRoot && root && next.matches(SKIPPED)) {
        // Text owned by a nested editor inside a component body still counts.
        if (next.querySelector(TEXT_ROOT)) {
          end();
          visit(next, null);
          end();
        }
        continue;
      }
      const block = isRoot || BLOCKS.has(next.tagName);
      if (block) {
        end();
        if (!visible(next)) continue;
      }
      visit(next, isRoot ? (next as HTMLElement) : root);
      if (block) end();
    }
  };
  visit(container, container.matches(TEXT_ROOT) ? container : null);
  end();
  return segments;
}

function boundary(segment: TextSegment, offset: number, isEnd: boolean) {
  const { pieces } = segment;
  let low = 0,
    high = pieces.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    const start = pieces[middle].start;
    if (start < offset || (!isEnd && start === offset)) low = middle;
    else high = middle - 1;
  }
  const piece = pieces[low];
  return { node: piece.node, offset: offset - piece.start };
}

/** Finds the query in the page and returns a DOM range for every match. */
export function findInPage(
  container: HTMLElement,
  query: string,
  options: FindOptions,
): PageMatch[] {
  const segments = collectSegments(container);
  return findInSegments(
    segments.map((segment) => segment.text),
    query,
    options,
  ).map((match) => {
    const segment = segments[match.segment];
    const start = boundary(segment, match.start, false);
    const finish = boundary(segment, match.end, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(finish.node, finish.offset);
    return { ...match, range, root: segment.root };
  });
}

type EditorElement = HTMLElement & { editor?: Editor };

/** The editor that owns a match's text, when that text can be edited. */
export function editableEditor(match: PageMatch): Editor | null {
  const editor = (match.root as EditorElement).editor;
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

/** The editor positions of a match, when they still hold the matched text. */
function editorRange(editor: Editor, match: PageMatch): EditorRange | null {
  const { view, state } = editor;
  const { range } = match;
  if (!view.dom.contains(range.startContainer)) return null;
  const from = view.posAtDOM(range.startContainer, range.startOffset);
  const to = view.posAtDOM(range.endContainer, range.endOffset);
  if (to <= from || state.doc.textBetween(from, to) !== range.toString())
    return null;
  return { from, to };
}

let replacementGroup = 0;

/**
 * Replaces matches through each owning editor's own transaction, one per
 * editor. All of them share one history group, so a single undo restores
 * every replacement. Returns how many matches were replaced.
 */
export function replaceMatches(matches: readonly PageMatch[], text: string) {
  const byEditor = new Map<Editor, EditorRange[]>();
  for (const match of matches) {
    const editor = editableEditor(match);
    const range = editor && editorRange(editor, match);
    if (!editor || !range) continue;
    const ranges = byEditor.get(editor) ?? [];
    ranges.push(range);
    byEditor.set(editor, ranges);
  }
  const group = `find-replace:${++replacementGroup}`;
  let replaced = 0;
  for (const [editor, ranges] of byEditor) {
    const tr = editor.state.tr;
    for (const range of replacementOrder(ranges)) {
      tr.insertText(text, range.from, range.to);
      replaced++;
    }
    // Replacing text never turns it into a link; autolink detection also
    // costs time per step, which matters for thousands of replacements.
    editor.view.dispatch(
      tr.setMeta(textRangeEditMeta, group).setMeta("preventAutolink", true),
    );
  }
  return replaced;
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}
const registry = () =>
  (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)
    ?.highlights;
const HighlightClass = () =>
  (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
    .Highlight;

/** Paints matches with the CSS Custom Highlight API; the DOM stays untouched. */
export function paintMatches(matches: readonly PageMatch[], current: number) {
  const highlights = registry(),
    Highlight = HighlightClass();
  if (!highlights || !Highlight) return;
  highlights.set(
    "showai-find",
    new Highlight(
      ...matches.filter((_, index) => index !== current).map((m) => m.range),
    ),
  );
  if (matches[current])
    highlights.set("showai-find-current", new Highlight(matches[current].range));
  else highlights.delete("showai-find-current");
}

export function clearPaint() {
  const highlights = registry();
  highlights?.delete("showai-find");
  highlights?.delete("showai-find-current");
}

const scrollable = (element: HTMLElement) => {
  const style = getComputedStyle(element);
  return (
    /(auto|scroll|overlay)/.test(style.overflowY + style.overflowX) &&
    (element.scrollHeight > element.clientHeight ||
      element.scrollWidth > element.clientWidth)
  );
};

/**
 * Scrolls the match into the middle of its scrolling ancestors. Returns false
 * when it stays out of view, as on a board whose camera has to move instead.
 */
export function scrollToMatch(match: PageMatch, within: HTMLElement) {
  const rect = () => match.range.getBoundingClientRect();
  for (
    let element = match.range.startContainer.parentElement;
    element && element !== document.body;
    element = element.parentElement
  ) {
    if (!scrollable(element)) continue;
    const box = element.getBoundingClientRect(),
      target = rect();
    if (target.top < box.top + 48 || target.bottom > box.bottom - 24)
      element.scrollTop += target.top - (box.top + box.height / 2);
    if (target.left < box.left || target.right > box.right)
      element.scrollLeft += target.left - (box.left + box.width / 2);
    if (element === within) break;
  }
  const target = rect(),
    view = within.getBoundingClientRect();
  return (
    target.bottom > view.top &&
    target.top < view.bottom &&
    target.right > view.left &&
    target.left < view.right
  );
}
