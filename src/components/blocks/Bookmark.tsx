import { useState } from "react";
import { Bookmark, Check, ExternalLink, Link2 } from "../../ui/icons";
import { safeImageUrl, safeUrl, text } from "./helpers";
import { BlockHeader, EmptyState, Field } from "./shared";
import type { BlockProps } from "./types";

export function BookmarkBlock({ data, onChange, readOnly }: BlockProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    url: "",
    image: "",
  });
  const [error, setError] = useState("");
  const editable = Boolean(onChange && !readOnly);
  const url = safeUrl(data.url);
  const image = safeImageUrl(data.image);
  const hostname = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  const openEditor = () => {
    setDraft({
      title: text(data.title),
      description: text(data.description),
      url: text(data.url),
      image: text(data.image),
    });
    setError("");
    setEditing(!editing);
  };
  const save = () => {
    if (!safeUrl(draft.url.trim())) {
      setError("请输入完整的 http 或 https 网址。");
      return;
    }
    if (draft.image.trim() && !safeImageUrl(draft.image.trim())) {
      setError("封面需要 http、https 或内嵌图片地址。");
      return;
    }
    onChange?.({
      ...data,
      ...draft,
      url: draft.url.trim(),
      image: draft.image.trim(),
    });
    setEditing(false);
  };
  return (
    <section
      className="sb-block sb-bookmark"
      aria-label={text(data.title) || "来源书签"}
    >
      <BlockHeader
        icon={<Bookmark size={16} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      />
      {editing && (
        <div className="sb-editor-panel">
          <Field label="网址">
            <input
              type="url"
              placeholder="https://…"
              value={draft.url}
              onChange={(event) =>
                setDraft((current) => ({ ...current, url: event.target.value }))
              }
            />
          </Field>
          <Field label="标题">
            <input
              placeholder="来源的名称"
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="摘要">
            <textarea
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="封面图片地址（可选）">
            <input
              type="url"
              value={draft.image}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  image: event.target.value,
                }))
              }
            />
          </Field>
          {error && (
            <p className="sb-error" role="alert">
              {error}
            </p>
          )}
          <div className="sb-panel-footer">
            <button
              type="button"
              className="sb-button sb-primary"
              onClick={save}
            >
              <Check size={14} />
              保存书签
            </button>
          </div>
        </div>
      )}
      {url ? (
        <a
          className="sb-bookmark-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <div className="sb-bookmark-copy">
            <strong>{text(data.title) || hostname}</strong>
            {text(data.description) && <p>{text(data.description)}</p>}
            <span className="sb-bookmark-domain">
              <Link2 size={12} />
              {hostname}
              <ExternalLink size={12} />
            </span>
          </div>
          {image && (
            <img
              src={image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
        </a>
      ) : (
        <EmptyState
          icon={<Bookmark size={27} strokeWidth={1.4} />}
          title="为结论留下出处"
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={openEditor}>
                <Link2 size={14} />
                添加来源
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
