import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Search, Focus, Expand } from "../ui/icons";
import { previewFit, previewZoom } from "./preview-geometry";
import { errorMessage } from "./bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";

export default function CatalogPreview({
  children,
  label,
  width = 960,
  resetKey,
  accessory,
  thumbnail = false,
  minHeight,
}: {
  children: ReactNode;
  label: string;
  width?: number;
  resetKey?: string | number;
  accessory?: ReactNode;
  thumbnail?: boolean;
  minHeight?: number;
}) {
  const t = useTranslator(messages);
  const stage = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  const zoomMenu = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width, height: 1, fit: 1 });
  const [manual, setManual] = useState<number | null>(null),
    [zoomOpen, setZoomOpen] = useState(false),
    [error, setError] = useState("");
  const scale = manual ?? size.fit;
  useEffect(() => {
    setManual(null);
    setZoomOpen(false);
  }, [resetKey]);
  useLayoutEffect(() => {
    const paper = content.current,
      area = viewport.current;
    if (!paper || !area) return;
    let frame = 0;
    const measure = () => {
      const w = Math.max(width, paper.scrollWidth),
        h = Math.max(1, paper.scrollHeight, paper.offsetHeight);
      const fit = previewFit(
        area.clientWidth,
        Math.max(1, area.clientHeight - (accessory ? 46 : 0)),
        w,
        h,
        thumbnail ? 10 : 24,
      );
      setSize((current) =>
        current.width === w && current.height === h && current.fit === fit
          ? current
          : { width: w, height: h, fit },
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(paper);
    observer.observe(area);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [width, resetKey, thumbnail, !!accessory]);
  useEffect(() => {
    if (!zoomOpen) return;
    const outside = (event: PointerEvent) => {
      if (!zoomMenu.current?.contains(event.target as Node)) setZoomOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [zoomOpen]);
  return (
    <div
      ref={stage}
      className={`catalog-preview${thumbnail ? " is-thumbnail" : ""}`}
      aria-label={label}
      data-preview-scale={scale}
    >
      {accessory && (
        <div className="catalog-preview-accessory">{accessory}</div>
      )}
      <div
        ref={viewport}
        className="catalog-preview-viewport"
        tabIndex={thumbnail ? undefined : 0}
      >
        <div
          className="catalog-preview-center"
          style={{
            minWidth: size.width * scale,
            minHeight: size.height * scale,
          }}
        >
          <div
            className="catalog-preview-frame"
            style={{ width: size.width * scale, height: size.height * scale }}
          >
            <div
              ref={content}
              className="catalog-preview-content"
              style={{ width, minHeight, transform: `scale(${scale})` }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
      {!thumbnail && (
        <div
          className="catalog-preview-tools"
          role="group"
          aria-label={t("previewActions")}
        >
          <div
            className="catalog-zoom-menu"
            ref={zoomMenu}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setZoomOpen(false);
              }
            }}
          >
            <button
              className="studio-icon"
              type="button"
              aria-label={t("adjustPreviewZoom")}
              title={t("zoom")}
              aria-expanded={zoomOpen}
              onClick={() => setZoomOpen(!zoomOpen)}
            >
              <Search size={18} />
            </button>
            {zoomOpen && (
              <div className="catalog-zoom-popover">
                <input
                  type="range"
                  min="5"
                  max="300"
                  step="5"
                  aria-label={t("previewZoom")}
                  value={Math.round(scale * 100)}
                  onChange={(event) =>
                    setManual(previewZoom(Number(event.target.value) / 100))
                  }
                />
                <output>{Math.round(scale * 100)}%</output>
              </div>
            )}
          </div>
          <button
            className="studio-icon"
            type="button"
            aria-label={t("fitPreview")}
            title={t("fit")}
            onClick={() => {
              setManual(null);
              setZoomOpen(false);
              viewport.current?.scrollTo({ top: 0, left: 0 });
            }}
          >
            <Focus size={18} />
          </button>
          <button
            className="studio-icon"
            type="button"
            aria-label={t("fullscreenPreview")}
            title={t("fullscreen")}
            onClick={() => {
              setError("");
              void (
                document.fullscreenElement === stage.current
                  ? document.exitFullscreen()
                  : stage.current!.requestFullscreen()
              ).catch((reason) => setError(errorMessage(reason)));
            }}
          >
            <Expand size={18} />
          </button>
        </div>
      )}
      {error && (
        <p className="catalog-preview-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
