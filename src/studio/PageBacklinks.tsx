import { useEffect, useId, useRef, useState } from "react";
import PageIcon from "../components/PageIcon";
import { usePageReferences } from "../components/page-references";
import { requestNavigation } from "../portable/page-link.mjs";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/mentions";
import commonMessages from "../i18n/messages/common";
import "./page-backlinks.css";

/** The count of pages referring to this page, opening their list. */
export default function PageBacklinks() {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const references = usePageReferences({ direction: "to" });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useId();
  const count = new Set(
    references.items.map((item) => `${item.projectId}/${item.pageId}`),
  ).size;
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        if (event instanceof KeyboardEvent)
          root.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!count) return null;
  return (
    <div className="studio-page-backlinks" ref={root}>
      <button
        type="button"
        className="studio-page-backlinks-count"
        aria-expanded={open}
        aria-controls={list}
        onClick={() => setOpen((value) => !value)}
      >
        {t("backlinkCount", { count })}
      </button>
      {open && (
        <div className="studio-page-backlinks-list" id={list} role="list">
          {references.items.map((item, index) => (
            <button
              key={`${item.projectId}/${item.pageId}/${item.blockId}/${index}`}
              type="button"
              role="listitem"
              className="studio-page-backlink"
              onClick={(event) => {
                setOpen(false);
                requestNavigation(event.currentTarget, {
                  projectId: item.projectId,
                  pageId: item.pageId,
                  blockIds: item.blockId ? [item.blockId] : [],
                });
              }}
            >
              <span className="studio-page-backlink-title">
                {item.icon && <PageIcon value={item.icon} size={16} />}
                {item.title || tc("untitled")}
              </span>
              {item.snippet && <small>{item.snippet}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
