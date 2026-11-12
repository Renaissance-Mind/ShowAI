import { BlockSettings } from "./action-host";
import {
  CAPACITY,
  assertContent,
  formatBytes,
} from "../../portable/capacity.mjs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Expand,
  Images,
  Link2,
  Plus,
  Trash2,
  Upload,
  X,
} from "../../ui/icons";
import { safeImageUrl, text, uid } from "./helpers";
import { BlockHeader, EmptyState, Field, blockLabel } from "./shared";
import type { BlockProps } from "./types";
import { translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/gallery";
import mediaMessages from "../../i18n/messages/media";
import {
  LocalResourceNotice,
  useLocalFileChooser,
  useResource,
} from "../local-resources";
import {
  isLocalResourceRef,
  localRefName,
} from "../../document/local-files.mjs";

interface GalleryImage {
  id: string;
  src: string;
  alt: string;
  caption: string;
}
const MAX_IMAGE_BYTES = CAPACITY.resourceBytes;
const translate = translator(messages);
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function imageFileToDataUrl(file: File): Promise<string> {
  if (!imageTypes.has(file.type))
    return Promise.reject(new Error(translate("error.unsupportedType")));
  if (file.size > MAX_IMAGE_BYTES)
    return Promise.reject(
      new Error(
        translate("error.tooLarge", {
          name: file.name,
          size: formatBytes(file.size),
          limit: formatBytes(MAX_IMAGE_BYTES),
        }),
      ),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error(translate("error.cannotRead", { name: file.name })));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error(translate("error.readFailed")));
    reader.readAsDataURL(file);
  });
}

/** An image a gallery can show: a web address, embedded data or a linked local file. */
const isGalleryImage = (src: string) =>
  !!safeImageUrl(src) || isLocalResourceRef(src, "image");

/** One gallery image, with a linked local file granted by the host. */
function ResourceImage({
  src,
  alt,
  lazy,
  fallback,
}: {
  src: string;
  alt: string;
  lazy?: boolean;
  /** Shown while a linked file is not available. */
  fallback?: ReactNode;
}) {
  const view = useResource(src, "image");
  if (view.local && view.status !== "ready")
    return fallback ?? <LocalResourceNotice view={view} kind="image" />;
  return (
    <img
      src={view.local ? view.url : safeImageUrl(src)}
      alt={alt}
      loading={lazy ? "lazy" : undefined}
      referrerPolicy="no-referrer"
      onError={view.local ? view.failed : undefined}
    />
  );
}

/** A grid cell: the image opens the preview; a linked file it cannot show offers its fixes. */
function GalleryItem({
  item,
  label,
  onPreview,
  onReplace,
}: {
  item: GalleryImage;
  label: string;
  onPreview: () => void;
  onReplace?: (ref: string) => void;
}) {
  const view = useResource(item.src, "image");
  if (view.local && view.status !== "ready")
    return (
      <figure>
        <LocalResourceNotice view={view} kind="image" onReplace={onReplace} />
        {item.caption && <figcaption>{item.caption}</figcaption>}
      </figure>
    );
  return (
    <figure>
      <button type="button" onClick={onPreview} aria-label={label}>
        <img
          src={view.local ? view.url : safeImageUrl(item.src)}
          alt={item.alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={view.local ? view.failed : undefined}
        />
        <span className="sb-gallery-expand">
          <Expand size={16} />
        </span>
      </button>
      {item.caption && <figcaption>{item.caption}</figcaption>}
    </figure>
  );
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
  const t = useTranslator(messages);
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
      aria-label={item.alt || t("imagePreview")}
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
        aria-label={t("closePreview")}
        onClick={close}
      >
        <X size={24} />
      </button>
      {images.length > 1 && (
        <button
          type="button"
          className="sb-lightbox-prev"
          aria-label={t("previousImage")}
          onClick={() => onIndex((index - 1 + images.length) % images.length)}
        >
          <ChevronLeft size={28} />
        </button>
      )}
      <figure>
        <ResourceImage src={item.src} alt={item.alt} />
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
          aria-label={t("nextImage")}
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
  const t = useTranslator(messages);
  const tm = useTranslator(mediaMessages);
  const chooseFiles = useLocalFileChooser();
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
  const visibleImages = images.filter((item) => isGalleryImage(item.src));
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
      setError(
        caught instanceof Error ? caught.message : t("error.importFailed"),
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const link = async () => {
    if (!chooseFiles) return;
    setBusy(true);
    setError("");
    try {
      const additions = (await chooseFiles("image", true)).map((file) => ({
        id: uid(),
        src: file.ref,
        alt: file.name.replace(/\.[^.]+$/, ""),
        caption: "",
      }));
      setDraftImages((current) => [...current, ...additions]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("error.importFailed"),
      );
    } finally {
      setBusy(false);
    }
  };
  /** Stores another linked file for one image, keeping the others. */
  const replaceImage = (id: string, ref: string) =>
    onChange?.({
      ...data,
      images: images.map((item) => (item.id === id ? { ...item, src: ref } : item)),
    });
  const save = () => {
    if (draftImages.some((item) => !isGalleryImage(item.src.trim()))) {
      setError(t("error.invalidSource"));
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
      aria-label={blockLabel(data.title, t("gallery"))}
    >
      <BlockHeader
        title={text(data.title)}
        // i18n-exempt: matches the saved default title
        defaultTitle="图片画廊"
        description={text(data.description)}
        icon={<Images size={17} />}
        editable={editable && !busy}
        editing={editing}
        onEdit={openEditor}
      />
      {editing && (
        <BlockSettings>
          <div className="sb-editor-panel">
            <div className="sb-form-row">
              <Field label={t("title")}>
                <input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                />
              </Field>
              <Field label={t("arrangement")}>
                <select
                  value={draftColumns}
                  onChange={(event) =>
                    setDraftColumns(Number(event.target.value))
                  }
                >
                  <option value={1}>{t("oneColumn")}</option>
                  <option value={2}>{t("twoColumns")}</option>
                  <option value={3}>{t("threeColumns")}</option>
                </select>
              </Field>
            </div>
            {draftImages.map((item, index) => (
              <div className="sb-gallery-editor" key={item.id}>
                <div className="sb-gallery-editor-preview">
                  {isGalleryImage(item.src) ? (
                    <ResourceImage
                      src={item.src}
                      alt=""
                      fallback={<Images size={20} />}
                    />
                  ) : (
                    <Images size={20} />
                  )}
                </div>
                <div className="sb-gallery-editor-fields">
                  <Field label={t("imageAddress", { index: index + 1 })}>
                    <input
                      value={
                        item.src.startsWith("data:")
                          ? t("embeddedImage")
                          : isLocalResourceRef(item.src)
                            ? tm("linkedFile", { name: localRefName(item.src) })
                            : item.src
                      }
                      readOnly={
                        item.src.startsWith("data:") ||
                        isLocalResourceRef(item.src)
                      }
                      placeholder="https://…"
                      onChange={(event) =>
                        updateImage(index, { src: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={t("altText")}>
                    <input
                      value={item.alt}
                      onChange={(event) =>
                        updateImage(index, { alt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={t("caption")}>
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
                    aria-label={t("moveUp", { index: index + 1 })}
                    disabled={index === 0 || busy}
                    onClick={() => moveImage(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="sb-icon-button"
                    aria-label={t("moveDown", { index: index + 1 })}
                    disabled={index === draftImages.length - 1 || busy}
                    onClick={() => moveImage(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="sb-icon-button sb-danger"
                    aria-label={t("deleteImage", { index: index + 1 })}
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
              aria-label={t("chooseLocalImages")}
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
                  {busy ? t("reading") : t("uploadImages")}
                </button>
                {chooseFiles && (
                  <button
                    type="button"
                    className="sb-button"
                    disabled={busy}
                    onClick={() => void link()}
                  >
                    <Link2 size={14} />
                    {tm("linkOriginal")}
                  </button>
                )}
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
                  {t("addLink")}
                </button>
              </div>
              <button
                type="button"
                className="sb-button sb-primary"
                disabled={busy}
                onClick={save}
              >
                <Check size={14} />
                {t("saveGallery")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
      {visibleImages.length ? (
        <div className={`sb-gallery-grid sb-gallery-columns-${columns}`}>
          {visibleImages.map((item, index) => (
            <GalleryItem
              key={`${item.id}-${index}`}
              item={item}
              label={t("viewImage", {
                name: item.alt || item.caption || index + 1,
              })}
              onPreview={() => setPreview(index)}
              onReplace={
                editable ? (ref) => replaceImage(item.id, ref) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Images size={29} strokeWidth={1.4} />}
          title={t("empty.title")}
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={openEditor}>
                <Plus size={14} />
                {t("addImages")}
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
