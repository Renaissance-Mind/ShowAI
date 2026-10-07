import { useState } from "react";
import { BookOpen, Check, ExternalLink, Plus, Trash2 } from "../../ui/icons";
import { text, uid } from "./helpers";
import { referenceUrl, validateResearchData } from "./research-contract.mjs";
import { BlockHeader, EmptyState, Field } from "./shared";
import type { BlockProps } from "./types";
import "./research-media.css";

type Reference = {
  id: string;
  title: string;
  authors?: string;
  year?: string;
  venue?: string;
  doi?: string;
  url?: string;
  note?: string;
};
export function ReferencesBlock({ data, onChange, readOnly }: BlockProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data);
  const [error, setError] = useState("");
  const editable = Boolean(onChange && !readOnly);
  const items = (data.items ?? []) as Reference[];
  const draftItems = (draft.items ?? []) as Reference[];
  const open = () => {
    setDraft(data);
    setError("");
    setEditing(!editing);
  };
  const change = (id: string, key: string, value: string) =>
    setDraft((current) => ({
      ...current,
      items: (current.items as Reference[]).map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    }));
  const save = () => {
    try {
      validateResearchData("references", draft);
      onChange?.(draft);
      setEditing(false);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "参考文献格式不正确。",
      );
    }
  };
  return (
    <section
      className="sb-block sb-references"
      aria-label={text(data.title) || "参考文献"}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle="参考文献"
        editable={editable}
        editing={editing}
        onEdit={open}
      />
      {editing && (
        <div
          className="sb-editor-panel"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") setEditing(false);
          }}
        >
          <Field label="标题">
            <input
              value={text(draft.title)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </Field>
          {draftItems.map((item, index) => (
            <fieldset className="sb-reference-editor" key={item.id}>
              <legend>文献 {index + 1}</legend>
              <Field label="文献标题">
                <input
                  value={item.title}
                  onChange={(event) =>
                    change(item.id, "title", event.target.value)
                  }
                />
              </Field>
              <Field label="作者">
                <input
                  placeholder="多个作者用逗号分隔"
                  value={item.authors ?? ""}
                  onChange={(event) =>
                    change(item.id, "authors", event.target.value)
                  }
                />
              </Field>
              <div className="sb-resource-fields">
                <Field label="年份">
                  <input
                    value={item.year ?? ""}
                    onChange={(event) =>
                      change(item.id, "year", event.target.value)
                    }
                  />
                </Field>
                <Field label="期刊或会议">
                  <input
                    value={item.venue ?? ""}
                    onChange={(event) =>
                      change(item.id, "venue", event.target.value)
                    }
                  />
                </Field>
              </div>
              <Field label="DOI">
                <input
                  placeholder="10.xxxx/…"
                  value={item.doi ?? ""}
                  onChange={(event) =>
                    change(item.id, "doi", event.target.value)
                  }
                />
              </Field>
              <Field label="网址">
                <input
                  type="url"
                  value={item.url ?? ""}
                  onChange={(event) =>
                    change(item.id, "url", event.target.value)
                  }
                />
              </Field>
              <Field label="备注">
                <textarea
                  rows={2}
                  value={item.note ?? ""}
                  onChange={(event) =>
                    change(item.id, "note", event.target.value)
                  }
                />
              </Field>
              <button
                type="button"
                className="sb-button"
                aria-label={`删除文献 ${index + 1}`}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    items: (current.items as Reference[]).filter(
                      (entry) => entry.id !== item.id,
                    ),
                  }))
                }
              >
                <Trash2 size={14} />
                删除
              </button>
            </fieldset>
          ))}
          {error && (
            <p className="sb-error" role="alert">
              {error}
            </p>
          )}
          <div className="sb-panel-footer">
            <button
              type="button"
              className="sb-button"
              disabled={draftItems.length >= 500}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  items: [
                    ...(current.items as Reference[]),
                    { id: uid(), title: "" },
                  ],
                }))
              }
            >
              <Plus size={14} />
              添加文献
            </button>
            <button
              type="button"
              className="sb-button sb-primary"
              onClick={save}
            >
              <Check size={14} />
              保存
            </button>
          </div>
        </div>
      )}
      {items.length ? (
        <ol className="sb-reference-list">
          {items.map((item, index) => {
            const url = referenceUrl(item);
            return (
              <li key={item.id} id={`ref-${item.id}`}>
                <span className="sb-reference-number">[{index + 1}]</span>
                <div className="sb-reference-entry">
                  <div className="sb-reference-meta">
                    {[item.authors, item.year].filter(Boolean).join(" · ")}
                  </div>
                  {url ? (
                    <a
                      className="sb-reference-title"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.title}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <strong className="sb-reference-title">{item.title}</strong>
                  )}
                  {item.venue && (
                    <div className="sb-reference-venue">{item.venue}</div>
                  )}
                  {item.doi && (
                    <a
                      className="sb-reference-doi"
                      href={referenceUrl({ doi: item.doi })}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      doi:
                      {item.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}
                    </a>
                  )}
                  {item.note && (
                    <p className="sb-reference-note">{item.note}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          icon={<BookOpen size={28} strokeWidth={1.4} />}
          title="添加参考文献"
          description="整理作者、年份、出处与 DOI"
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={open}>
                <Plus size={14} />
                添加文献
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
