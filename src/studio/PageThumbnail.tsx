import { memo, startTransition, useEffect, useRef, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import type { LoadedPage } from "./usePage";
import PageThumbnailContent from "./PageThumbnailContent";
import { ThumbnailRetention } from "./thumbnail-retention";
import { previewWork } from "./preview-work";
import { useAppearanceTheme } from "../design/useAppearanceTheme";
import { ImageOff } from "../ui/icons";

const retainedPreviews = new ThumbnailRetention(32);
interface ThumbnailProps {
  projectId: string;
  pageId: string;
  updatedAt: string;
  hash?: string;
  padding?: number;
}

/**
 * Load nearby cards and retain recent renders while scrolling back.
 * Documents flow into up to four columns to fill the card; boards show their
 * content's bounds with a margin, centred, so a drawn shape never becomes the edge.
 */
export const LivePageThumbnail = memo(function LivePageThumbnail({
  projectId,
  pageId,
  updatedAt,
  padding,
}: ThumbnailProps) {
  const host = useRef<HTMLSpanElement>(null);
  const retentionKey = useRef(Symbol());
  const [visible, setVisible] = useState(false);
  const [record, setRecord] = useState<LoadedPage | null>(null);
  const [error, setError] = useState("");
  const loadedKey = useRef("");
  const key = `${projectId}:${pageId}:${updatedAt}`;
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        retainedPreviews.update(
          retentionKey.current,
          entry.isIntersecting,
          () => setVisible(false),
        );
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: "100px" },
    );
    if (host.current) observer.observe(host.current);
    return () => {
      observer.disconnect();
      retainedPreviews.remove(retentionKey.current);
    };
  }, []);
  useEffect(() => {
    if (!visible || loadedKey.current === key) return;
    let cancelled = false;
    const controller = new AbortController();
    setError("");
    void previewWork(async () => {
      const value = await desktop.invoke<LoadedPage>("pages:get", {
        projectId,
        pageId,
      });
      if (!cancelled)
        startTransition(() => {
          loadedKey.current = key;
          setRecord(value);
        });
      // Let the mounted reader commit and paint before admitting another one.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return value;
    }, controller.signal).catch((reason) => {
      if (!cancelled) setError(errorMessage(reason));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [visible, projectId, pageId, updatedAt]);
  return (
    <span ref={host} className="studio-page-thumbnail" aria-hidden="true" inert>
      {error ? (
        <span>{error}</span>
      ) : (
        record &&
        visible && (
          <PageThumbnailContent
            record={record}
            updatedAt={updatedAt}
            padding={padding}
          />
        )
      )}
    </span>
  );
});

function RasterPageThumbnail({
  projectId,
  pageId,
  hash,
  updatedAt,
  padding = 10,
}: ThumbnailProps) {
  const host = useRef<HTMLSpanElement>(null);
  const theme = useAppearanceTheme();
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0, padding: 0 });
  const [generation, setGeneration] = useState(0);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const loadedKey = useRef("");
  const key = JSON.stringify({
    projectId,
    pageId,
    hash: hash ?? updatedAt,
    theme,
    ...size,
    generation,
  });
  useEffect(() => {
    const element = host.current!;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "200px" },
    );
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const pixels = Math.min(
        768,
        Math.max(128, Math.ceil((width * devicePixelRatio) / 64) * 64),
      );
      const next = {
        width: pixels,
        height: Math.max(32, Math.round((height / width) * pixels)),
        padding: Math.round((padding * pixels) / width),
      };
      setSize((previous) =>
        previous.width === next.width &&
        previous.height === next.height &&
        previous.padding === next.padding
          ? previous
          : next,
      );
    });
    observer.observe(element);
    resize.observe(element);
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, [padding]);
  useEffect(
    () =>
      desktop.onChange((change) => {
        if (
          change.type === "home" ||
          change.all ||
          change.allPages ||
          change.catalog ||
          change.datasets?.length ||
          change.pageIds?.includes(pageId)
        )
          setGeneration((value) => value + 1);
      }),
    [pageId],
  );
  useEffect(() => {
    if (!visible || !size.width || loadedKey.current === key) return;
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    let submitted = false;
    setError("");
    // The desktop capture queue owns expensive work. Submit raster requests
    // immediately so cached images do not wait for other pages or input idle.
    void Promise.resolve()
      .then(async () => {
        if (controller.signal.aborted) return "";
        submitted = true;
        const bounds = host.current!.getBoundingClientRect();
        return desktop.invoke<string>("pages:thumbnail", {
          projectId,
          pageId,
          hash: hash ?? updatedAt,
          theme,
          ...size,
          refresh: generation > 0,
          requestId,
          priority: Math.min(
            100000,
            Math.max(0, bounds.top - innerHeight, -bounds.bottom),
          ),
        });
      })
      .then(
        (value) => {
          if (!controller.signal.aborted)
            startTransition(() => {
              loadedKey.current = key;
              setImage(value);
            });
        },
        (reason) => {
          if (!controller.signal.aborted) setError(errorMessage(reason));
        },
      );
    return () => {
      controller.abort();
      if (submitted)
        void desktop
          .invoke("pages:thumbnailCancel", { requestId })
          .catch((reason) =>
            console.warn("Couldn't cancel the page preview", reason),
          );
    };
  }, [visible, key]);
  return (
    <span
      ref={host}
      className="studio-page-thumbnail"
      aria-hidden="true"
      inert
      data-preview-raster
    >
      {image ? (
        <img src={image} alt="" decoding="async" draggable={false} />
      ) : error ? (
        <span title={error}>
          <ImageOff size={18} />
        </span>
      ) : null}
    </span>
  );
}

export default memo(function PageThumbnail(props: ThumbnailProps) {
  return window.showai?.pageThumbnails ? (
    <RasterPageThumbnail {...props} />
  ) : (
    <LivePageThumbnail {...props} />
  );
});
