import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2 } from "../ui/icons";
import type { CatalogComponent } from "../core/component-categories";
import { desktop, errorMessage } from "./bridge";
import type { AppearanceTheme } from "../design/useAppearanceTheme";

export function componentPreviewReference(item: CatalogComponent) {
  return "kind" in item
    ? { id: item.kind, scope: "builtin" }
    : {
        id: item.id,
        version: item.version,
        scope: item.scope,
        integrity: item.integrity,
        ...(item.projectId ? { projectId: item.projectId } : {}),
      };
}

export default function ComponentThumbnail({
  item,
  browser,
  theme,
}: {
  item: CatalogComponent;
  browser: boolean;
  theme: AppearanceTheme;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState({ key: "", data: "" });
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1);
  const key = JSON.stringify({ ...componentPreviewReference(item), theme });
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      { rootMargin: "180px" },
    );
    observer.observe(container.current);
    const resize = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / 720),
    );
    resize.observe(container.current);
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!visible || browser || image.key === key) return;
    let cancelled = false;
    const requestId = crypto.randomUUID();
    setError("");
    void desktop
      .invoke<string>("components:thumbnail", { ...JSON.parse(key), requestId })
      .then((image) => {
        if (!cancelled) setImage({ key, data: image });
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
      void desktop
        .invoke("components:thumbnailCancel", { requestId })
        .catch((reason) => console.warn("无法取消组件预览", reason));
    };
  }, [key, visible, browser, image.key]);
  const previewUrl = new URL(location.href);
  previewUrl.search = "";
  previewUrl.searchParams.set("componentPreview", key);
  return (
    <div className="component-card-preview" ref={container} aria-hidden="true">
      {image.key === key && image.data ? (
        <img src={image.data} alt="" draggable={false} />
      ) : visible && browser ? (
        <iframe
          title={`${item.name}缩略预览`}
          src={previewUrl.href}
          tabIndex={-1}
          style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        />
      ) : error ? (
        <span className="component-preview-error" title={error}>
          <ImageOff size={20} />
          预览暂不可用
        </span>
      ) : (
        <Loader2 size={18} className="studio-spin component-preview-loading" />
      )}
    </div>
  );
}
