import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import type { CatalogComponent } from "../core/component-categories";
import { desktop, errorMessage } from "./bridge";

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
}: {
  item: CatalogComponent;
  browser: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1);
  const key = JSON.stringify(componentPreviewReference(item));
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
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
    if (!visible || browser) return;
    let cancelled = false;
    setImage("");
    setError("");
    void desktop
      .invoke<string>("components:thumbnail", JSON.parse(key))
      .then((image) => {
        if (!cancelled) setImage(image);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [key, visible, browser]);
  const previewUrl = new URL(location.href);
  previewUrl.search = "";
  previewUrl.searchParams.set("componentPreview", key);
  return (
    <div className="component-card-preview" ref={container} aria-hidden="true">
      {image ? (
        <img src={image} alt="" draggable={false} />
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
