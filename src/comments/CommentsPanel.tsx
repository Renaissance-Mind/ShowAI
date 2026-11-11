import { useEffect, useRef } from "react";
import { MessageSquareText, X } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/comments";
import {
  addReply,
  deleteComment,
  editComment,
  setThreadResolved,
  type LocatedThread,
} from "../core/comments";
import { commentsStore, useCommentsStore } from "./comments-store";
import { CommentThreadView, type ThreadActions } from "./CommentThread";
import "./comments.css";

function useController(documentId: string | null) {
  const store = useCommentsStore();
  return {
    store,
    controller: documentId ? store.controllers.get(documentId) : undefined,
  };
}

/** The top-bar control: opens the page's comment list and counts open threads. */
export function CommentsToggle({
  documentId,
  onOpen,
}: {
  documentId: string | null;
  onOpen: () => void;
}) {
  const t = useTranslator(messages);
  const { store, controller } = useController(documentId);
  if (!controller) return null;
  const count = controller.threads().filter((thread) => !thread.resolved).length;
  const label = count ? t("toggleCount", { count }) : t("toggle");
  return (
    <button
      className={`studio-icon studio-icon-count${store.open ? " is-active" : ""}`}
      aria-pressed={store.open}
      aria-label={label}
      title={`${label} ⇧⌘M`}
      onClick={() => {
        if (!store.open) onOpen();
        commentsStore.setOpen(!store.open);
      }}
    >
      <MessageSquareText size={15} aria-hidden="true" />
      {count > 0 && (
        <span className="studio-icon-badge" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

function anchorLabel(
  thread: LocatedThread,
  t: (key: "detached" | "pageLevel" | "block") => string,
) {
  if (thread.location.kind === "detached") return t("detached");
  if (thread.location.kind === "page") return t("pageLevel");
  return thread.anchor?.quote ?? t("block");
}

/** The comment list in the workbench's side-panel slot, beside the Agent panel. */
export function CommentsPanel({
  documentId,
  assistantOpen,
}: {
  documentId: string | null;
  assistantOpen: boolean;
}) {
  const t = useTranslator(messages);
  const { store, controller } = useController(documentId);
  const list = useRef<HTMLDivElement>(null);
  // The panel and the Agent panel share the slot.
  useEffect(() => {
    if (assistantOpen) commentsStore.setOpen(false);
  }, [assistantOpen]);
  useEffect(() => {
    if (!store.open || !store.active) return;
    list.current
      ?.querySelector(`[data-thread="${CSS.escape(store.active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [store.open, store.active]);
  if (!store.open || !controller) return null;
  const all = controller.threads();
  const resolved = store.filter === "resolved";
  const threads = all.filter((thread) => thread.resolved === resolved);
  const openCount = all.filter((thread) => !thread.resolved).length;
  const actions: ThreadActions = {
    reply: (threadId, text) =>
      controller.change((comments) =>
        addReply(comments, { threadId, text, author: controller.author }),
      ),
    edit: (id, text) => controller.change((comments) => editComment(comments, id, text)),
    remove: (id) => controller.change((comments) => deleteComment(comments, id)),
    resolve: (threadId, value) =>
      controller.change((comments) => setThreadResolved(comments, threadId, value)),
  };
  return (
    <aside className="comments-panel" aria-label={t("panel")}>
      <header className="comments-panel-header">
        <div className="comments-filter" role="tablist" aria-label={t("panel")}>
          {(["open", "resolved"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              role="tab"
              aria-selected={store.filter === filter}
              className={store.filter === filter ? "is-active" : ""}
              onClick={() => commentsStore.setFilter(filter)}
            >
              {filter === "open" ? `${t("open")} ${openCount}` : `${t("resolvedFilter")} ${all.length - openCount}`}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="comment-icon"
          aria-label={t("close")}
          title={t("close")}
          onClick={() => commentsStore.setOpen(false)}
        >
          <X size={15} />
        </button>
      </header>
      <div className="comments-panel-list" ref={list}>
        {threads.length === 0 && (
          <p className="comments-empty">{resolved ? t("emptyResolved") : t("empty")}</p>
        )}
        {threads.map((thread) => {
          const active = store.active === thread.id;
          const located = thread.location.kind === "text" || thread.location.kind === "block";
          return (
            <section
              key={thread.id}
              data-thread={thread.id}
              className={`comments-panel-thread${active ? " is-active" : ""}`}
            >
              <button
                type="button"
                className={`comments-panel-anchor${located ? "" : " is-detached"}`}
                aria-expanded={active}
                onClick={() => {
                  if (located) controller.reveal(thread.id);
                  else commentsStore.setActive(active ? null : thread.id);
                }}
              >
                <span className="comments-panel-quote">{anchorLabel(thread, t)}</span>
                {!active && (
                  <>
                    <span className="comments-panel-text">{thread.root.text}</span>
                    {thread.replies.length > 0 && (
                      <span className="comments-panel-count">
                        {t("replies", { count: thread.replies.length })}
                      </span>
                    )}
                  </>
                )}
              </button>
              {active && (
                <CommentThreadView
                  thread={thread}
                  me={controller.author}
                  readOnly={controller.readOnly}
                  actions={actions}
                />
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
