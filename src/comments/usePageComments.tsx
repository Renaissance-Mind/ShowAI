import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { MessageSquareText } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/comments";
import { CommentSlots } from "../components/comment-slots";
import {
  addReply,
  addThread,
  blockIndex,
  deleteComment,
  documentThreads,
  editComment,
  setThreadResolved,
  textAnchor,
  textBlockText,
  type CommentAnchor,
  type LocatedThread,
} from "../core/comments";
import type { PageComment, ShowDocument } from "../types";
import { commentHighlights } from "./highlights";
import { commentsStore, useCommentsStore } from "./comments-store";
import { CommentInput, CommentThreadView, type ThreadActions } from "./CommentThread";
import { useCommentAuthor } from "./author";
import { flashTarget, reducedMotion } from "./flash";
import "./comments.css";

type Rect = { left: number; top: number; bottom: number };
type Popover =
  | { kind: "new"; anchor?: CommentAnchor; rect: Rect; restore: () => void }
  | { kind: "thread"; threadId: string; rect: Rect; restore: () => void };

const SHORTCUT = "⇧⌘M";

function isShortcut(event: KeyboardEvent) {
  return (
    event.code === "KeyM" &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey
  );
}

const anchorSelector = (id: string) =>
  `[data-surface-id="${CSS.escape(id)}"],[data-block-id="${CSS.escape(id)}"]`;

function editorOf(element: Element | null): Editor | null {
  const dom = element?.closest(".ProseMirror") as
    | (HTMLElement & { editor?: Editor })
    | null;
  return dom?.editor ?? null;
}

/** The comment target of an editor selection: quoted text in one text block, or a whole block. */
function editorTarget(
  editor: Editor,
  document: ShowDocument,
): { anchor: CommentAnchor; rect: Rect } | null {
  const blocks = blockIndex(document);
  const { selection } = editor.state;
  const coords = editor.view.coordsAtPos(selection.from);
  const rect = { left: coords.left, top: coords.top, bottom: coords.bottom };
  if (selection instanceof NodeSelection) {
    const id = selection.node.attrs?.id;
    return typeof id === "string" && blocks.has(id)
      ? { anchor: { blockId: id }, rect }
      : null;
  }
  const { $from, from, to } = selection;
  const parent = $from.parent;
  const id = parent.attrs?.id;
  if (parent.isTextblock && typeof id === "string" && blocks.has(id)) {
    const start = $from.start();
    const end = Math.min(to, $from.end());
    if (end > from) {
      const text = textBlockText(parent.toJSON());
      return { anchor: textAnchor(id, text, from - start, end - start), rect };
    }
    return { anchor: { blockId: id }, rect };
  }
  // Text inside a component keeps its own structure: the component is the target.
  for (let depth = $from.depth; depth > 0; depth--) {
    const ancestor = $from.node(depth).attrs?.id;
    if (typeof ancestor === "string" && blocks.has(ancestor))
      return { anchor: { blockId: ancestor }, rect };
  }
  const host = editor.view.dom.closest("[data-surface-id],[data-block-id]");
  const hostId =
    host?.getAttribute("data-surface-id") ?? host?.getAttribute("data-block-id");
  return hostId && blocks.has(hostId) ? { anchor: { blockId: hostId }, rect } : null;
}

/** The ancestor of a block that sits directly in a surface: what the editor's reveal can open. */
function surfaceChild(document: ShowDocument, blockId: string): string {
  let found = blockId;
  const visit = (node: JSONContent, top: string | null): boolean =>
    (node.content ?? []).some((child) => {
      const id = typeof child.attrs?.id === "string" ? child.attrs.id : null;
      const owner = node.type === "surface" ? id : top;
      if (id === blockId) {
        found = owner ?? blockId;
        return true;
      }
      return visit(child, owner);
    });
  visit(document.content, null);
  return found;
}

function placement(rect: Rect, width: number) {
  const gutter = 16;
  const left = Math.max(
    gutter,
    Math.min(rect.left, window.innerWidth - width - gutter),
  );
  const below = rect.bottom + 8;
  return window.innerHeight - below > 260
    ? { left, top: below }
    : { left, bottom: Math.max(gutter, window.innerHeight - rect.top + 8) };
}

/**
 * Comments for one page editor: the actions joined to the selection, block
 * and board menus, the shortcut, highlights, block markers, the composer and
 * thread popovers, and the controller the comments panel uses.
 */
export function usePageComments({
  document,
  commit,
  readOnly,
  shell,
  projectId,
}: {
  /** The editor's current document. */
  document: ShowDocument;
  commit: (next: ShowDocument, group: string) => void;
  readOnly: boolean;
  shell: RefObject<HTMLElement | null>;
  projectId?: string;
}) {
  const t = useTranslator(messages);
  const author = useCommentAuthor(projectId);
  const store = useCommentsStore();
  const [popover, setPopover] = useState<Popover | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const latest = useRef({ document, commit, readOnly, author });
  latest.current = { document, commit, readOnly, author };
  const threadsCache = useRef<{ comments?: PageComment[]; content?: unknown; threads: LocatedThread[] }>({ threads: [] });
  const threads = useCallback(() => {
    const current = latest.current.document;
    const cache = threadsCache.current;
    if (cache.comments !== current.comments || cache.content !== current.content)
      threadsCache.current = {
        comments: current.comments,
        content: current.content,
        threads: documentThreads(current),
      };
    return threadsCache.current.threads;
  }, []);

  const change = useCallback(
    (update: (comments: PageComment[]) => PageComment[]) => {
      const { document: current, commit: save, readOnly: locked } = latest.current;
      if (locked) return;
      save(
        { ...current, comments: update(current.comments ?? []) },
        `comments:${crypto.randomUUID()}`,
      );
    },
    [],
  );

  const highlight = useMemo(
    () =>
      commentHighlights({
        threads: () => threads().filter((thread) => !thread.resolved),
        active: () => commentsStore.get().active,
        open: (threadId, box) =>
          openThread(threadId, { left: box.left, top: box.top, bottom: box.bottom }),
      }),
    [],
  );

  const restoreFocus = () => {
    const active = window.document.activeElement as HTMLElement | null;
    return () => {
      if (active?.isConnected) active.focus({ preventScroll: true });
    };
  };
  const openThread = (threadId: string, rect: Rect) => {
    commentsStore.setActive(threadId);
    setPopover({ kind: "thread", threadId, rect, restore: restoreFocus() });
  };
  const startComment = (anchor: CommentAnchor | undefined, rect: Rect, restore?: () => void) => {
    if (latest.current.readOnly) return;
    setPopover({ kind: "new", anchor, rect, restore: restore ?? restoreFocus() });
  };
  const popoverRef = useRef(popover);
  popoverRef.current = popover;
  const close = () => {
    popoverRef.current?.restore();
    setPopover(null);
  };

  const revealThread = useCallback((threadId: string) => {
    const thread = threads().find((item) => item.id === threadId);
    commentsStore.setActive(threadId);
    const root = shell.current;
    if (!thread || !root) return;
    const location = thread.location;
    if (location.kind === "text") {
      // The editor's reveal leaves an expanded Board; the text then scrolls to the middle and flashes.
      setReveal(surfaceChild(latest.current.document, location.blockId));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          root.querySelector(anchorSelector(location.blockId))?.scrollIntoView({
            block: "center",
            behavior: reducedMotion() ? "auto" : "smooth",
          });
          flashTarget(() => highlight.rects(threadId));
        }),
      );
    } else if (location.kind === "block") {
      // The editor's reveal also opens nested surfaces and pans Boards.
      setReveal(location.blockId);
      const selector = anchorSelector(location.blockId);
      flashTarget(() =>
        [...root.querySelectorAll(selector)].slice(0, 1).map((element) => element.getBoundingClientRect()),
      );
    }
  }, []);

  // The panel and its toggle use this page's controller.
  useEffect(
    () =>
      commentsStore.register({
        documentId: document.id,
        get readOnly() {
          return latest.current.readOnly;
        },
        get author() {
          return latest.current.author;
        },
        threads,
        change,
        reveal: revealThread,
      }),
    [document.id],
  );
  const comments = document.comments;
  const content = document.content;
  useEffect(() => {
    commentsStore.changed();
    highlight.refresh();
  }, [comments, content]);
  useEffect(() => highlight.refresh(), [store.active]);
  // A thread deleted or undone elsewhere closes its popover.
  useEffect(() => {
    if (
      popover?.kind === "thread" &&
      !threads().some((thread) => thread.id === popover.threadId)
    )
      setPopover(null);
  }, [comments]);

  const actions: ThreadActions = {
    reply: (threadId, text) =>
      change((list) => addReply(list, { threadId, text, author: latest.current.author })),
    edit: (id, text) => change((list) => editComment(list, id, text)),
    remove: (id) => change((list) => deleteComment(list, id)),
    resolve: (threadId, resolved) => {
      change((list) => setThreadResolved(list, threadId, resolved));
      if (resolved && popover?.kind === "thread") close();
    },
  };
  const create = (anchor: CommentAnchor | undefined, text: string) => {
    const id = `comment-${crypto.randomUUID()}`;
    change((list) =>
      addThread(list, { id, text, anchor, author: latest.current.author }),
    );
    commentsStore.setActive(id);
  };

  // Mod+Shift+M comments on the selected text, block or Board object.
  useEffect(() => {
    if (readOnly) return;
    const keyDown = (event: KeyboardEvent) => {
      const root = shell.current;
      if (!root || !isShortcut(event) || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (!target || !(root.contains(target) || target === window.document.body))
        return;
      if (target !== window.document.body && target.closest("input,textarea,select"))
        return;
      const editor = editorOf(target) ?? editorOf(window.document.activeElement);
      const fromEditor =
        editor && root.contains(editor.view.dom)
          ? editorTarget(editor, latest.current.document)
          : null;
      if (fromEditor) {
        event.preventDefault();
        startComment(fromEditor.anchor, fromEditor.rect, () => editor!.view.focus());
        return;
      }
      const selected = root.querySelector<HTMLElement>(
        ".surface-object.is-selected[data-surface-id]",
      );
      const id = selected?.dataset.surfaceId;
      if (id && blockIndex(latest.current.document).has(id)) {
        event.preventDefault();
        const box = selected!.getBoundingClientRect();
        startComment({ blockId: id }, { left: box.right - 8, top: box.top, bottom: box.top + 24 });
        return;
      }
      if (root.contains(target) || target === window.document.body) {
        event.preventDefault();
        commentsStore.setOpen(true);
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [readOnly]);

  const slots = useMemo<CommentSlots>(
    () => ({
      text: (editor, closeMenu) => (
        <>
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="editor-tool"
            aria-label={t("comment")}
            title={`${t("comment")} ${SHORTCUT}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const target = editorTarget(editor, latest.current.document);
              closeMenu();
              if (target) startComment(target.anchor, target.rect, () => editor.view.focus());
            }}
          >
            <MessageSquareText size={16} />
          </button>
        </>
      ),
      block: (id, closeMenu) =>
        typeof id === "string" && blockIndex(latest.current.document).has(id) ? (
          <button
            onClick={(event) => {
              const box = event.currentTarget
                .closest(".block-handle")!
                .getBoundingClientRect();
              closeMenu();
              startComment({ blockId: id }, { left: box.right + 8, top: box.top, bottom: box.bottom });
            }}
          >
            <MessageSquareText size={15} />
            {t("comment")}
          </button>
        ) : null,
      dock: (ids) => (
        <button
          type="button"
          aria-label={t("comment")}
          title={`${t("comment")} ${SHORTCUT}`}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            startComment({ blockId: ids[0] }, { left: box.left, top: box.top, bottom: box.bottom });
          }}
        >
          <MessageSquareText size={15} />
        </button>
      ),
      menu: (ids) => ({
        label: t("comment"),
        icon: <MessageSquareText size={14} />,
        shortcut: SHORTCUT,
        onSelect: () => {
          const element = shell.current?.querySelector(anchorSelector(ids[0]));
          const box = element?.getBoundingClientRect();
          startComment(
            { blockId: ids[0] },
            box
              ? { left: box.right - 8, top: box.top, bottom: box.top + 24 }
              : { left: window.innerWidth / 2, top: 80, bottom: 80 },
          );
        },
      }),
    }),
    [t],
  );

  const open = threads().filter((thread) => !thread.resolved);
  const markers = groupBlockMarkers(open);
  const popoverThread =
    popover?.kind === "thread"
      ? threads().find((thread) => thread.id === popover.threadId)
      : undefined;

  const render = (children: ReactNode) => (
    <>
      {readOnly ? children : <CommentSlots.Provider value={slots}>{children}</CommentSlots.Provider>}
      {markers.length > 0 && (
        <BlockMarkers
          shell={shell}
          markers={markers}
          label={(count) => t("marker", { count })}
          onOpen={(threadId, rect) => openThread(threadId, rect)}
        />
      )}
      {popover &&
        (popover.kind === "new" || popoverThread) &&
        createPortal(
          <CommentPopover rect={popover.rect} onClose={close}>
            {popover.kind === "new" ? (
              <CommentInput
                placeholder={t("placeholder")}
                submitLabel={t("submit")}
                autoFocus
                onSubmit={(text) => {
                  create(popover.anchor, text);
                  close();
                }}
                onCancel={close}
              />
            ) : (
              <CommentThreadView
                thread={popoverThread!}
                me={author}
                readOnly={readOnly}
                actions={actions}
                autoFocus
                onCancel={close}
              />
            )}
          </CommentPopover>,
          window.document.body,
        )}
    </>
  );
  return {
    extension: highlight.extension,
    revealId: reveal,
    revealHandled: () => setReveal(null),
    render,
  };
}

function groupBlockMarkers(threads: LocatedThread[]) {
  const byBlock = new Map<string, string[]>();
  for (const thread of threads)
    if (thread.location.kind === "block")
      byBlock.set(thread.location.blockId, [
        ...(byBlock.get(thread.location.blockId) ?? []),
        thread.id,
      ]);
  return [...byBlock].map(([blockId, ids]) => ({ blockId, ids }));
}

/** Small count markers at the top-right of commented blocks and Board objects. */
function BlockMarkers({
  shell,
  markers,
  label,
  onOpen,
}: {
  shell: RefObject<HTMLElement | null>;
  markers: { blockId: string; ids: string[] }[];
  label: (count: number) => string;
  onOpen: (threadId: string, rect: Rect) => void;
}) {
  const layer = useId();
  useLayoutEffect(() => {
    const button = (blockId: string) =>
      window.document.querySelector<HTMLButtonElement>(
        `[data-comment-layer="${CSS.escape(layer)}"] [data-comment-block="${CSS.escape(blockId)}"]`,
      );
    let frame = 0;
    const paint = () => {
      const root = shell.current;
      const scroller = root?.closest(".studio-scroll") ?? root;
      const bounds = scroller?.getBoundingClientRect();
      for (const { blockId } of markers) {
        const marker = button(blockId);
        if (!marker) continue;
        const target = root?.querySelector(anchorSelector(blockId));
        const rect = target?.getBoundingClientRect();
        const visible =
          !!rect &&
          !!bounds &&
          rect.height > 0 &&
          rect.top >= bounds.top - 4 &&
          rect.top <= bounds.bottom - 20 &&
          rect.right <= bounds.right + 4 &&
          rect.right >= bounds.left;
        marker.hidden = !visible;
        if (visible) {
          marker.style.left = `${Math.min(rect!.right + 4, bounds!.right - 30)}px`;
          marker.style.top = `${rect!.top}px`;
        }
      }
      frame = requestAnimationFrame(paint);
    };
    paint();
    return () => {
      cancelAnimationFrame(frame);
      // A hidden tab keeps this DOM without running effects; nothing may stay on screen.
      for (const { blockId } of markers) {
        const marker = button(blockId);
        if (marker) marker.hidden = true;
      }
    };
  }, [markers.map((marker) => marker.blockId).join("\n")]);
  return createPortal(
    <div className="comment-markers" data-comment-layer={layer}>
      {markers.map(({ blockId, ids }) => (
        <button
          key={blockId}
          type="button"
          hidden
          data-comment-block={blockId}
          className="comment-marker"
          aria-label={label(ids.length)}
          title={label(ids.length)}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            onOpen(ids[0], { left: box.left, top: box.top, bottom: box.bottom });
          }}
        >
          <MessageSquareText size={12} />
          {ids.length > 1 && <span>{ids.length}</span>}
        </button>
      ))}
    </div>,
    window.document.body,
  );
}

function CommentPopover({
  rect,
  onClose,
  children,
}: {
  rect: Rect;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslator(messages);
  const element = useRef<HTMLDivElement>(null);
  const width = Math.min(340, window.innerWidth - 32);
  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      if (!element.current?.contains(event.target as Node)) onClose();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("pointerdown", pointerDown, true);
    element.current?.addEventListener("keydown", keyDown);
    const current = element.current;
    if (current) current.hidden = false;
    return () => {
      // Hidden with its tab, shown again when the tab returns.
      if (current) current.hidden = true;
      window.removeEventListener("pointerdown", pointerDown, true);
      current?.removeEventListener("keydown", keyDown);
    };
  }, [onClose]);
  return (
    <div
      ref={element}
      className="comment-popover"
      role="dialog"
      aria-label={t("thread")}
      data-editor-keyboard-scope
      style={{ width, ...placement(rect, width) }}
    >
      {children}
    </div>
  );
}
