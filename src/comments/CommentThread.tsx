import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Pencil, RotateCcw, Trash2 } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/comments";
import { getLocale } from "../i18n";
import type { CommentThread as Thread } from "../core/comments";
import type { CommentAuthor, PageComment } from "../types";

/** A person's own comment: the same sync account, or written on a device without one. */
export function ownComment(comment: PageComment, me: CommentAuthor) {
  const author = comment.author;
  if (!author) return !me.id;
  return author.kind === "person" && (me.id ? author.id === me.id : !author.id);
}

/** Multi-line input: Enter submits, Shift+Enter adds a line, Escape cancels. */
export function CommentInput({
  initial = "",
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}) {
  const t = useTranslator(messages);
  const [text, setText] = useState(initial);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(initial.length, initial.length);
  }, [autoFocus]);
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text);
    setText("");
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="comment-input">
      <textarea
        ref={input}
        value={text}
        rows={Math.min(6, Math.max(1, text.split("\n").length))}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keyDown}
      />
      <div className="comment-input-actions">
        {onCancel && (
          <button type="button" className="comment-button" onClick={onCancel}>
            {t("cancel")}
          </button>
        )}
        <button
          type="button"
          className="comment-button is-primary"
          disabled={!text.trim()}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  me,
  readOnly,
  onEdit,
  onDelete,
}: {
  comment: PageComment;
  me: CommentAuthor;
  readOnly: boolean;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslator(messages);
  const [editing, setEditing] = useState(false);
  const author = comment.author;
  const name =
    author?.name ??
    (author?.kind === "agent" ? t("agent") : ownComment(comment, me) ? t("you") : "");
  const own = !readOnly && ownComment(comment, me);
  return (
    <li className="comment-item">
      <div className="comment-meta">
        <span className={`comment-author${author?.kind === "agent" ? " is-agent" : ""}`}>
          {name}
        </span>
        <time dateTime={comment.createdAt}>
          {new Date(comment.createdAt).toLocaleString(getLocale(), {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          {comment.editedAt ? ` · ${t("edited")}` : ""}
        </time>
        {own && !editing && (
          <span className="comment-item-actions">
            <button
              type="button"
              className="comment-icon"
              aria-label={t("edit")}
              title={t("edit")}
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              className="comment-icon"
              aria-label={t("delete")}
              title={t("delete")}
              onClick={onDelete}
            >
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <CommentInput
          initial={comment.text}
          placeholder={t("placeholder")}
          submitLabel={t("save")}
          autoFocus
          onSubmit={(text) => {
            onEdit(text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="comment-text">{comment.text}</p>
      )}
    </li>
  );
}

export interface ThreadActions {
  reply(threadId: string, text: string): void;
  edit(id: string, text: string): void;
  remove(id: string): void;
  resolve(threadId: string, resolved: boolean): void;
}

export function CommentThreadView({
  thread,
  me,
  readOnly,
  actions,
  autoFocus,
  onCancel,
}: {
  thread: Thread;
  me: CommentAuthor;
  readOnly: boolean;
  actions: ThreadActions;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const t = useTranslator(messages);
  return (
    <div className={`comment-thread${thread.resolved ? " is-resolved" : ""}`}>
      <ol className="comment-list">
        {[thread.root, ...thread.replies].map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            me={me}
            readOnly={readOnly}
            onEdit={(text) => actions.edit(comment.id, text)}
            onDelete={() => actions.remove(comment.id)}
          />
        ))}
      </ol>
      {!readOnly && (
        <div className="comment-thread-footer">
          {!thread.resolved && (
            <CommentInput
              placeholder={t("replyPlaceholder")}
              submitLabel={t("submit")}
              autoFocus={autoFocus}
              onSubmit={(text) => actions.reply(thread.id, text)}
              onCancel={onCancel}
            />
          )}
          <button
            type="button"
            className="comment-button comment-resolve"
            onClick={() => actions.resolve(thread.id, !thread.resolved)}
          >
            {thread.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
            {thread.resolved ? t("reopen") : t("resolve")}
          </button>
        </div>
      )}
    </div>
  );
}
