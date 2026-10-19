import type { Editor } from "@tiptap/core";
import type { Selection } from "@tiptap/pm/state";

const editors = new WeakMap<HTMLElement, Editor>();
const rangeFactories = new WeakMap<
  Editor,
  (anchor: number, head: number) => Selection
>();
const frameText = new WeakMap<HTMLIFrameElement, string>();
const frameChannels = new WeakMap<HTMLIFrameElement, string>();
export function registerSelectionFrame(
  frame: HTMLIFrameElement,
  channel: string,
) {
  frameChannels.set(frame, channel);
  return () => {
    frameChannels.delete(frame);
    frameText.delete(frame);
  };
}
export function receiveSelectionFrameText(
  frame: HTMLIFrameElement,
  text: unknown,
) {
  if (typeof text === "string" && text.length <= 256_000)
    frameText.set(frame, text);
}
export function registerSelectionEditor(
  editor: Editor,
  createRange: (anchor: number, head: number) => Selection,
) {
  rangeFactories.set(editor, createRange);
  const dom = editor.view.dom;
  editors.set(dom, editor);
  return () => {
    editors.delete(dom);
    rangeFactories.delete(editor);
  };
}

const excluded =
  'button,input,textarea,select,summary,[role="button"],[role="slider"],[data-surface-ui],.editor-toolbar,.editor-bubble,.block-handle,.block-menu,[data-surface-handle]';
const atomSelector = ".document-widget,.page-document-module";
type Point = { x: number; y: number };
type Caret = { node: Node; offset: number };

export function edgeVelocity(value: number, low: number, high: number) {
  const margin = Math.min(40, (high - low) / 3);
  if (margin <= 0) return 0;
  if (value < low + margin)
    return -18 * Math.min(1, (low + margin - value) / margin);
  if (value > high - margin)
    return 18 * Math.min(1, (value - high + margin) / margin);
  return 0;
}

function caretAt(doc: Document, point: Point): Caret | null {
  if (!doc.caretRangeFromPoint) {
    const position = (
      doc as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number,
        ) => { offsetNode: Node; offset: number } | null;
      }
    ).caretPositionFromPoint?.(point.x, point.y);
    return position
      ? { node: position.offsetNode, offset: position.offset }
      : null;
  }
  const range = doc.caretRangeFromPoint(point.x, point.y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : null;
}
function frameBoundary(frame: HTMLIFrameElement, after: boolean): Caret {
  return {
    node: frame.parentNode!,
    offset: [...frame.parentNode!.childNodes].indexOf(frame) + (after ? 1 : 0),
  };
}
function ownerEditor(target: Element, page: Element) {
  let current: Element | null = target;
  let owner: Editor | undefined;
  while (current && page.contains(current)) {
    if (current instanceof HTMLElement && editors.has(current))
      owner = editors.get(current);
    current = current.parentElement;
  }
  return owner;
}
function atomAt(editor: Editor, target: Element) {
  let current: Element | null = target;
  let atom: Element | null = null;
  while (current && current !== editor.view.dom) {
    if (current.matches(atomSelector)) atom = current;
    current = current.parentElement;
  }
  if (!atom || current !== editor.view.dom) return null;
  const from = editor.view.posAtDOM(atom, 0);
  const node = editor.state.doc.nodeAt(from);
  return node?.isAtom
    ? { element: atom, from, to: from + node.nodeSize }
    : null;
}

/** Called only after the component host has checked message source and channel. */
export function relayComponentSelectionPointer(
  frame: HTMLIFrameElement,
  data: Record<string, unknown>,
) {
  if (
    !["down", "move", "up", "cancel"].includes(String(data.phase)) ||
    ![data.x, data.y, data.width, data.height, data.buttons].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    Number(data.width) <= 0 ||
    Number(data.height) <= 0
  )
    return;
  const rect = frame.getBoundingClientRect();
  frame.dispatchEvent(
    new CustomEvent("showai:text-selection-pointer", {
      bubbles: true,
      detail: {
        phase: data.phase,
        buttons: data.buttons,
        x: rect.left + (Number(data.x) / Number(data.width)) * rect.width,
        y: rect.top + (Number(data.y) / Number(data.height)) * rect.height,
      },
    }),
  );
}

/** Selection autoscroll is independent of the pointer's movement. Inner scrollers
 * get first refusal; an exhausted inner scroller hands the edge to its Page. */
export function scrollSelection(
  target: Element,
  page: HTMLElement,
  point: Point,
) {
  let changed = false,
    movedX = false,
    movedY = false;
  const clip = page.getBoundingClientRect();
  for (
    let current: Element | null = target;
    current && page.contains(current);
    current = current.parentElement
  ) {
    if (!(current instanceof HTMLElement)) continue;
    const style = getComputedStyle(current);
    const rect = current.getBoundingClientRect();
    const x =
      !movedX && /auto|scroll/.test(style.overflowX)
        ? edgeVelocity(
            point.x,
            Math.max(0, rect.left, clip.left),
            Math.min(innerWidth, rect.right, clip.right),
          )
        : 0;
    const y =
      !movedY && /auto|scroll/.test(style.overflowY)
        ? edgeVelocity(
            point.y,
            Math.max(0, rect.top, clip.top),
            Math.min(innerHeight, rect.bottom, clip.bottom),
          )
        : 0;
    const beforeX = current.scrollLeft,
      beforeY = current.scrollTop;
    if (x) current.scrollLeft += x;
    if (y) current.scrollTop += y;
    if (current.scrollLeft !== beforeX || current.scrollTop !== beforeY) {
      changed = true;
      movedX ||= current.scrollLeft !== beforeX;
      movedY ||= current.scrollTop !== beforeY;
      if (movedX && movedY) break;
    }
    if (current === page) break;
  }
  return changed;
}

/** A Page has one editing selection, including atoms rendered by nested editors.
 * Only crossing a component boundary takes over the browser/inner editor drag. */
export function installPageTextSelection(root: HTMLElement) {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  let drag: {
    page: HTMLElement;
    target: Element;
    start: Point;
    point: Point;
    anchor: Caret | null;
    frameAnchor: HTMLIFrameElement | null;
    editor?: Editor;
    atom: ReturnType<typeof atomAt>;
    position?: number;
    cross: boolean;
    moved: boolean;
    pointer?: number;
    table: Element | null;
    innerEditor: Element | null;
  } | null = null;
  let frame = 0;
  let suppressClick = false;
  let selectionEditor: Editor | undefined;
  let nativePage: HTMLElement | null = null;
  const stop = () => {
    win.cancelAnimationFrame(frame);
    frame = 0;
    drag = null;
  };
  const start = (target: Element, point: Point, pointer?: number) => {
    if (target.closest(excluded)) return;
    let page = target.closest<HTMLElement>(".container-page");
    if (!page || !root.contains(page)) return;
    for (
      let outer = page.parentElement?.closest<HTMLElement>(".container-page");
      outer && root.contains(outer);
      outer = outer.parentElement?.closest<HTMLElement>(".container-page")
    )
      page = outer;
    for (const iframe of page.querySelectorAll("iframe")) {
      const channel = frameChannels.get(iframe);
      if (channel)
        iframe.contentWindow?.postMessage(
          { channel, type: "showai:text-selection-content-request" },
          "*",
        );
    }
    // Canvas pan/resize and graph gestures never start a text selection.
    if (
      target.closest(
        '.react-flow,[data-surface-gesture="own"],[data-drawing-active="true"]',
      )
    )
      return;
    const frameAnchor = target instanceof HTMLIFrameElement ? target : null;
    const anchor = frameAnchor
      ? frameBoundary(frameAnchor, false)
      : caretAt(doc, point);
    const editor = ownerEditor(target, page);
    const atom = editor ? atomAt(editor, target) : null;
    const selectableText =
      anchor?.node.nodeType === Node.TEXT_NODE &&
      target.contains(anchor.node) &&
      getComputedStyle(target).userSelect !== "none";
    if (!selectableText && !frameAnchor) return;
    stop();
    selectionEditor = undefined;
    drag = {
      page,
      target,
      start: point,
      point,
      anchor,
      frameAnchor,
      editor,
      atom,
      position: editor?.view.posAtCoords({ left: point.x, top: point.y })?.pos,
      cross: false,
      moved: false,
      pointer,
      table: target.closest("table"),
      innerEditor: target.closest(".ProseMirror"),
    };
  };
  const extend = () => {
    if (!drag || !drag.moved) return;
    const { page, editor, point } = drag;
    if (!drag.target.isConnected || editor?.isDestroyed) {
      stop();
      return;
    }
    const rect = page.getBoundingClientRect();
    const clipped = {
      x: Math.max(rect.left + 2, Math.min(rect.right - 2, point.x)),
      y: Math.max(
        rect.top + 2,
        Math.min(rect.bottom - 2, innerHeight - 2, point.y),
      ),
    };
    const target = doc.elementFromPoint(clipped.x, clipped.y);
    if (!target || !page.contains(target)) return;
    const atom = editor ? atomAt(editor, target) : null;
    if (
      !editor &&
      drag.anchor &&
      (drag.cross || drag.frameAnchor || target instanceof HTMLIFrameElement)
    ) {
      let anchor = drag.anchor;
      let head =
        target instanceof HTMLIFrameElement
          ? frameBoundary(target, false)
          : caretAt(doc, clipped);
      if (!head || !page.contains(head.node)) return;
      const probe = doc.createRange(),
        endProbe = doc.createRange();
      probe.setStart(anchor.node, anchor.offset);
      probe.collapse(true);
      endProbe.setStart(head.node, head.offset);
      endProbe.collapse(true);
      const backward =
        probe.compareBoundaryPoints(Range.START_TO_START, endProbe) > 0;
      if (drag.frameAnchor) {
        if (target === drag.frameAnchor && !drag.cross) return;
        anchor = frameBoundary(drag.frameAnchor, backward);
      }
      if (target instanceof HTMLIFrameElement)
        head = frameBoundary(target, !backward);
      doc
        .getSelection()
        ?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
      drag.cross = true;
      nativePage = page;
    }
    const changedEditor = target.closest(".ProseMirror") !== drag.innerEditor;
    const leftTable = drag.table && target.closest("table") !== drag.table;
    if (
      editor &&
      (drag.cross ||
        changedEditor ||
        leftTable ||
        atom?.element !== drag.atom?.element)
    ) {
      const initialAtom = atomAt(editor, drag.target);
      const anchorCaret = drag.anchor;
      const initialPosition =
        anchorCaret?.node.isConnected &&
        editor.view.dom.contains(anchorCaret.node)
          ? editor.view.posAtDOM(
              anchorCaret.node,
              Math.min(
                anchorCaret.offset,
                anchorCaret.node.nodeType === Node.TEXT_NODE
                  ? anchorCaret.node.textContent!.length
                  : anchorCaret.node.childNodes.length,
              ),
            )
          : drag.position;
      if (drag.atom && !initialAtom) {
        stop();
        return;
      }
      const caret = caretAt(doc, clipped);
      const position = atom
        ? undefined
        : caret && editor.view.dom.contains(caret.node)
          ? editor.view.posAtDOM(caret.node, caret.offset)
          : editor.view.posAtCoords({ left: clipped.x, top: clipped.y })?.pos;
      if (!atom && position === undefined) return;
      const backward = atom
        ? atom.from < (initialAtom?.from ?? initialPosition ?? 0)
        : position! < (initialAtom?.from ?? initialPosition ?? 0);
      const anchor = initialAtom
        ? backward
          ? initialAtom.to
          : initialAtom.from
        : initialPosition;
      const head = atom ? (backward ? atom.from : atom.to) : position;
      if (
        anchor === undefined ||
        head === undefined ||
        anchor === head ||
        anchor > editor.state.doc.content.size ||
        head > editor.state.doc.content.size
      )
        return;
      drag.cross = true;
      selectionEditor = editor;
      editor.view.focus();
      const factory = rangeFactories.get(editor);
      if (!factory) {
        stop();
        return;
      }
      const selection = factory(anchor, head);
      if (!selection.eq(editor.state.selection))
        editor.view.dispatch(
          editor.state.tr
            .setSelection(selection)
            .setMeta("addToHistory", false),
        );
    }
  };
  const tick = () => {
    if (!drag) return;
    if (drag.moved) {
      const hit = doc.elementFromPoint(
        Math.max(0, Math.min(innerWidth - 1, drag.point.x)),
        Math.max(0, Math.min(innerHeight - 1, drag.point.y)),
      );
      const changed = scrollSelection(
        hit && drag.page.contains(hit) ? hit : drag.target,
        drag.page,
        drag.point,
      );
      if (changed) {
        if (drag.cross) extend();
        else {
          // ProseMirror's table plugin updates CellSelection on mousemove.
          const selection = doc.getSelection();
          const caret = caretAt(doc, {
            x: Math.max(0, Math.min(innerWidth - 2, drag.point.x)),
            y: Math.max(
              drag.page.getBoundingClientRect().top + 2,
              Math.min(
                innerHeight - 2,
                drag.page.getBoundingClientRect().bottom - 2,
                drag.point.y,
              ),
            ),
          });
          if (
            !drag.frameAnchor &&
            !drag.page.querySelector(".selectedCell") &&
            caret &&
            drag.anchor?.node.isConnected &&
            drag.page.contains(caret.node)
          )
            selection?.setBaseAndExtent(
              drag.anchor.node,
              drag.anchor.offset,
              caret.node,
              caret.offset,
            );
          if (drag.page.querySelector(".selectedCell"))
            doc.dispatchEvent(
              new MouseEvent("mousemove", {
                bubbles: true,
                buttons: 1,
                clientX: Math.max(
                  drag.page.getBoundingClientRect().left + 2,
                  Math.min(
                    drag.page.getBoundingClientRect().right - 2,
                    drag.point.x,
                  ),
                ),
                clientY: Math.max(
                  drag.page.getBoundingClientRect().top + 2,
                  Math.min(
                    innerHeight - 2,
                    drag.page.getBoundingClientRect().bottom - 2,
                    drag.point.y,
                  ),
                ),
              }),
            );
          extend();
        }
      }
    }
    frame = win.requestAnimationFrame(tick);
  };
  const down = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      event.pointerType !== "mouse" ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      !(event.target instanceof Element)
    )
      return;
    start(
      event.target,
      { x: event.clientX, y: event.clientY },
      event.pointerId,
    );
  };
  const move = (event: PointerEvent) => {
    if (
      !drag ||
      (drag.pointer !== undefined && drag.pointer !== event.pointerId)
    )
      return;
    if (!(event.buttons & 1)) {
      stop();
      return;
    }
    drag.point = { x: event.clientX, y: event.clientY };
    drag.moved ||=
      Math.hypot(drag.point.x - drag.start.x, drag.point.y - drag.start.y) > 4;
    extend();
    if (drag?.cross) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!frame) frame = win.requestAnimationFrame(tick);
  };
  const mouseMove = (event: MouseEvent) => {
    if (drag?.cross) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const up = () => {
    if (drag?.cross) extend();
    if (drag && !drag.editor) nativePage = drag.page;
    if (drag?.moved && (drag.cross || !doc.getSelection()?.isCollapsed))
      suppressClick = true;
    stop();
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const copy = (event: ClipboardEvent) => {
    if (
      !event.clipboardData ||
      (doc.activeElement instanceof Element &&
        doc.activeElement.matches("input,textarea,select"))
    )
      return;
    let range: Range;
    let editor = selectionEditor;
    if (
      editor &&
      !editor.isDestroyed &&
      editor.view.hasFocus() &&
      !editor.state.selection.empty
    ) {
      const { from, to } = editor.state.selection;
      range = doc.createRange();
      const start = editor.view.domAtPos(from),
        end = editor.view.domAtPos(to);
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } else {
      editor = undefined;
      const selected = doc.getSelection();
      if (
        !nativePage ||
        !selected?.rangeCount ||
        selected.isCollapsed ||
        !nativePage.contains(selected.anchorNode) ||
        !nativePage.contains(selected.focusNode)
      )
        return;
      range = selected.getRangeAt(0);
    }
    const fragment = range.cloneContents();
    const originals = [
      ...(editor?.view.dom ?? nativePage!).querySelectorAll("iframe"),
    ].filter((iframe) => range.intersectsNode(iframe));
    fragment
      .querySelectorAll("iframe")
      .forEach((iframe, index) =>
        iframe.replaceWith(
          frameText.get(originals[index]) ?? originals[index]?.title ?? "",
        ),
      );
    fragment
      .querySelectorAll(excluded + ",script,style")
      .forEach((node) => node.remove());
    const container = doc.createElement("div");
    container.append(fragment);
    // Preserve paragraph and table boundaries in the plain-text clipboard.
    container
      .querySelectorAll(
        "p,div,section,article,li,tr,h1,h2,h3,h4,pre,blockquote",
      )
      .forEach((node) => node.append("\n"));
    container.querySelectorAll("td,th").forEach((node) => node.append("\t"));
    container.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    event.clipboardData.setData(
      "text/plain",
      (container.textContent ?? "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\n+$/, ""),
    );
    // Keep editable components as their schema-preserving clipboard HTML.
    const html = editor
      ? editor.view.serializeForClipboard(editor.state.selection.content()).dom
          .innerHTML
      : container.innerHTML;
    event.clipboardData.setData("text/html", html);
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "cut" && editor?.isEditable)
      editor.commands.deleteSelection();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      selectionEditor = undefined;
      stop();
    } else if (
      !(event.metaKey || event.ctrlKey) ||
      !["c", "x"].includes(event.key.toLowerCase())
    )
      selectionEditor = undefined;
  };
  const bridgedPointer = (event: Event) => {
    const { phase, x, y, buttons } = (event as CustomEvent).detail;
    if (!(event.target instanceof Element)) return;
    if (phase === "down") start(event.target, { x, y });
    else if (phase === "move" && drag && buttons & 1) {
      drag.point = { x, y };
      drag.moved ||= Math.hypot(x - drag.start.x, y - drag.start.y) > 4;
      extend();
      if (!frame) frame = win.requestAnimationFrame(tick);
    } else if (phase === "up") up();
    else if (phase === "cancel") stop();
  };
  const reset = (event: PointerEvent) => {
    if (event.button !== 0) return;
    selectionEditor = undefined;
    nativePage = null;
    suppressClick = false;
    stop();
  };
  doc.addEventListener("pointerdown", reset, true);
  root.addEventListener("showai:text-selection-pointer", bridgedPointer);
  root.addEventListener("pointerdown", down, true);
  doc.addEventListener("pointermove", move, true);
  doc.addEventListener("mousemove", mouseMove, true);
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("pointercancel", stop, true);
  root.addEventListener("click", click, true);
  doc.addEventListener("copy", copy, true);
  doc.addEventListener("cut", copy, true);
  doc.addEventListener("keydown", key, true);
  win.addEventListener("blur", stop);
  return () => {
    stop();
    doc.removeEventListener("pointerdown", reset, true);
    root.removeEventListener("showai:text-selection-pointer", bridgedPointer);
    root.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("mousemove", mouseMove, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("pointercancel", stop, true);
    root.removeEventListener("click", click, true);
    doc.removeEventListener("copy", copy, true);
    doc.removeEventListener("cut", copy, true);
    doc.removeEventListener("keydown", key, true);
    win.removeEventListener("blur", stop);
  };
}
