import { useLayoutEffect, useRef } from "react";
import PageIcon from "../components/PageIcon";
import { ImagePlus } from "../ui/icons";
import "./page-heading.css";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";

export default function PageHeading({
  title,
  icon,
  readOnly,
  onTitleChange,
  onEditIcon,
}: {
  title: string;
  icon: string;
  readOnly: boolean;
  onTitleChange: (title: string) => void;
  onEditIcon: () => void;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [title, readOnly]);

  return (
    <div className="studio-page-heading">
      {readOnly ? (
        icon && <PageIcon value={icon} size={48} />
      ) : (
        <button
          type="button"
          className={`studio-page-heading-icon${icon ? "" : " is-empty"}`}
          aria-label={icon ? t("setPageIcon") : t("addIcon")}
          title={icon ? t("setPageIcon") : t("addIcon")}
          aria-haspopup="dialog"
          onClick={onEditIcon}
        >
          {icon ? <PageIcon value={icon} size={48} /> : <ImagePlus size={28} />}
        </button>
      )}
      {readOnly ? (
        <h1 className="studio-page-heading-title">{title || tc("untitled")}</h1>
      ) : (
        <textarea
          ref={input}
          className="studio-page-heading-title"
          aria-label={t("bodyPageTitle")}
          placeholder={tc("untitled")}
          rows={1}
          maxLength={1000}
          value={title}
          onChange={(event) =>
            onTitleChange(event.target.value.replace(/[\r\n]/g, ""))
          }
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            event.preventDefault();
            input.current
              ?.closest("[data-container-root]")
              ?.querySelector<HTMLElement>('[contenteditable="true"]')
              ?.focus();
          }}
        />
      )}
    </div>
  );
}
