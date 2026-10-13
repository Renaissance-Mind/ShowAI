import { useLayoutEffect, useRef } from "react";
import PageIcon from "../components/PageIcon";
import { ImagePlus } from "../ui/icons";
import "./page-heading.css";

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
        icon && <PageIcon value={icon} size={56} />
      ) : (
        <button
          type="button"
          className={`studio-page-heading-icon${icon ? "" : " is-empty"}`}
          aria-label={icon ? "设置页面图标" : "添加图标"}
          title={icon ? "设置页面图标" : "添加图标"}
          aria-haspopup="dialog"
          onClick={onEditIcon}
        >
          {icon ? (
            <PageIcon value={icon} size={56} />
          ) : (
            <>
              <ImagePlus size={16} />
              <span>添加图标</span>
            </>
          )}
        </button>
      )}
      {readOnly ? (
        <h1 className="studio-page-heading-title">{title || "无标题"}</h1>
      ) : (
        <textarea
          ref={input}
          className="studio-page-heading-title"
          aria-label="正文页面标题"
          placeholder="无标题"
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
