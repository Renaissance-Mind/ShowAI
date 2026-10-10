import {
  CAPACITY,
  assertContent,
  formatBytes,
} from "../../portable/capacity.mjs";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Expand,
  Images,
  Plus,
  Trash2,
  Upload,
  X,
} from "../../ui/icons";
import { safeImageUrl, text, uid } from "./helpers";
import { BlockHeader, EmptyState, Field } from "./shared";
import type { BlockProps } from "./types";

interface GalleryImage {
  id: string;
  src: string;
  alt: string;
  caption: string;
}
const MAX_IMAGE_BYTES = CAPACITY.resourceBytes;
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function imageFileToDataUrl(file: File): Promise<string> {
  if (!imageTypes.has(file.type))
    return Promise.reject(
      new Error("支持 PNG、JPEG、GIF、WebP 和 AVIF 图片。"),
    );
  if (file.size > MAX_IMAGE_BYTES)
    return Promise.reject(
      new Error(
        `「${file.name}」为 ${formatBytes(file.size)}，单个资源上限 ${formatBytes(MAX_IMAGE_BYTES)}。`,
      ),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取「${file.name}」。`));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function Lightbox({
  images,
  index,
  onIndex,
  close,
  portalHost,
}: {
  images: GalleryImage[];
  index: number;
  onIndex: (index: number) => void;
  close: () => void;
  portalHost: HTMLElement;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = portalHost.style.overflow;
    portalHost.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      portalHost.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [portalHost]);
  const item = images[index];
  if (!item) return null;
  return createPortal(
    <div
      className="sb-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.alt || "图片预览"}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onIndex((index - 1 + images.length) % images.length);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onIndex((index + 1) % images.length);
        }
        if (event.key === "Tab") {
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
          );
          const first = buttons[0],
            last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <button
        ref={closeButton}
        type="button"
        className="sb-lightbox-close"
        aria-label="关闭图片预览"
        onClick={close}
      >
        <X size={24} />
      </button>
      {images.length > 1 && (
        <button
          type="button"
          className="sb-lightbox-prev"
          aria-label="上一张图片"
          onClick={() => onIndex((index - 1 + images.length) % images.length)}
        >
          <ChevronLeft size={28} />
        </button>
      )}
      <figure>
        <img
          src={safeImageUrl(item.src)}
          alt={item.alt}
          referrerPolicy="no-referrer"
        />
        <figcaption>
          {item.caption || item.alt}
          <span>
            {index + 1} / {images.length}
          </span>
        </figcaption>
      </figure>
      {images.length > 1 && (
        <button
          type="button"
          className="sb-lightbox-next"
          aria-label="下一张图片"
          onClick={() => onIndex((index + 1) % images.length)}
        >
          <ChevronRight size={28} />
        </button>
      )}
    </div>,
    portalHost,
  );
}

export function GalleryBlock({ data, onChange, readOnly }: BlockProps) {
  const galleryRoot = useRef<HTMLElement>(null);
  const images: GalleryImage[] = Array.isArray(data.images)
    ? data.images
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({
          id: text(item.id, String(index)),
          src: text(item.src),
          alt: text(item.alt),
          caption: text(item.caption),
        }))
    : [];
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftImages, setDraftImages] = useState<GalleryImage[]>([]);
  const [draftColumns, setDraftColumns] = useState(2);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editable = Boolean(onChange && !readOnly);
  const visibleImages = images.filter((item) => safeImageUrl(item.src));
  const columns = data.columns === 1 || data.columns === 3 ? data.columns : 2;
  const openEditor = () => {
    setDraftTitle(text(data.title));
    setDraftImages(images.map((item) => ({ ...item })));
    setDraftColumns(columns);
    setError("");
    setEditing(!editing);
  };
  const updateImage = (index: number, changes: Partial<GalleryImage>) =>
    setDraftImages((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...changes } : item,
      ),
    );
  const moveImage = (index: number, offset: number) =>
    setDraftImages((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      const additions = await Promise.all(
        Array.from(files).map(async (file) => ({
          id: uid(),
          src: await imageFileToDataUrl(file),
          alt: file.name.replace(/\.[^.]+$/, ""),
          caption: "",
        })),
      );
      assertContent([...draftImages, ...additions], "Gallery structure");
      setDraftImages((current) => [...current, ...additions]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片导入失败。");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const save = () => {
    if (draftImages.some((item) => !safeImageUrl(item.src.trim()))) {
      setError("每张图片需要有效的网址或本地图片。");
      return;
    }
    onChange?.({
      ...data,
      title: draftTitle,
      columns: draftColumns,
      images: draftImages.map((item) => ({ ...item, src: item.src.trim() })),
    });
    setEditing(false);
  };
  return (
    <section
      ref={galleryRoot}
      className="sb-block sb-gallery"
      aria-label={text(data.title) || "图片画廊"}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle="图片画廊"
        description={text(data.description)}
        icon={<Images size={17} />}
        editable={editable && !busy}
        editing={editing}
        onEdit={openEditor}
      />
      {editing && (
        <div className="sb-editor-panel">
          <div className="sb-form-row">
            <Field label="标题">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
            </Field>
            <Field label="排列">
              <select
                value={draftColumns}
                onChange={(event) =>
                  setDraftColumns(Number(event.target.value))
                }
              >
                <option value={1}>单列</option>
                <option value={2}>两列</option>
                <option value={3}>三列</option>
              </select>
            </Field>
          </div>
          {draftImages.map((item, index) => (
            <div className="sb-gallery-editor" key={item.id}>
              <div className="sb-gallery-editor-preview">
                {safeImageUrl(item.src) ? (
                  <img
                    src={safeImageUrl(item.src)}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <Images size={20} />
                )}
              </div>
              <div className="sb-gallery-editor-fields">
                <Field label={`图片 ${index + 1} 地址`}>
                  <input
                    value={
                      item.src.startsWith("data:") ? "已嵌入本地图片" : item.src
                    }
                    readOnly={item.src.startsWith("data:")}
                    placeholder="https://…"
                    onChange={(event) =>
                      updateImage(index, { src: event.target.value })
                    }
                  />
                </Field>
                <Field label="图片描述">
                  <input
                    value={item.alt}
                    onChange={(event) =>
                      updateImage(index, { alt: event.target.value })
                    }
                  />
                </Field>
                <Field label="图注">
                  <input
                    value={item.caption}
                    onChange={(event) =>
                      updateImage(index, { caption: event.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="sb-gallery-editor-actions">
                <button
                  type="button"
                  className="sb-icon-button"
                  aria-label={`上移图片 ${index + 1}`}
                  disabled={index === 0 || busy}
                  onClick={() => moveImage(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="sb-icon-button"
                  aria-label={`下移图片 ${index + 1}`}
                  disabled={index === draftImages.length - 1 || busy}
                  onClick={() => moveImage(index, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="sb-icon-button sb-danger"
                  aria-label={`删除图片 ${index + 1}`}
                  disabled={busy}
                  onClick={() =>
                    setDraftImages((current) =>
                      current.filter(
                        (_, currentIndex) => currentIndex !== index,
                      ),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          <input
            className="sb-hidden"
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            multiple
            aria-label="选择本地图片"
            onChange={(event) => void upload(event.target.files)}
          />
          {error && (
            <p className="sb-error" role="alert">
              {error}
            </p>
          )}
          <div className="sb-panel-footer">
            <div className="sb-actions">
              <button
                type="button"
                className="sb-button"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={14} />
                {busy ? "读取中…" : "上传图片"}
              </button>
              <button
                type="button"
                className="sb-button"
                disabled={busy}
                onClick={() =>
                  setDraftImages((current) => [
                    ...current,
                    { id: uid(), src: "", alt: "", caption: "" },
                  ])
                }
              >
                <Plus size={14} />
                添加链接
              </button>
            </div>
            <button
              type="button"
              className="sb-button sb-primary"
              disabled={busy}
              onClick={save}
            >
              <Check size={14} />
              保存画廊
            </button>
          </div>
        </div>
      )}
      {visibleImages.length ? (
        <div className={`sb-gallery-grid sb-gallery-columns-${columns}`}>
          {visibleImages.map((item, index) => (
            <figure key={`${item.id}-${index}`}>
              <button
                type="button"
                onClick={() => setPreview(index)}
                aria-label={`查看图片：${item.alt || item.caption || index + 1}`}
              >
                <img
                  src={safeImageUrl(item.src)}
                  alt={item.alt}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <span className="sb-gallery-expand">
                  <Expand size={16} />
                </span>
              </button>
              {item.caption && <figcaption>{item.caption}</figcaption>}
            </figure>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Images size={29} strokeWidth={1.4} />}
          title="给想法更多画面"
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={openEditor}>
                <Plus size={14} />
                添加图片
              </button>
            ) : undefined
          }
        />
      )}
      {preview !== null && visibleImages[preview] && (
        <Lightbox
          images={visibleImages}
          index={preview}
          onIndex={setPreview}
          close={() => setPreview(null)}
          portalHost={
            galleryRoot.current?.closest<HTMLElement>(
              "[data-showai-inline-root]",
            ) ?? document.body
          }
        />
      )}
    </section>
  );
}
