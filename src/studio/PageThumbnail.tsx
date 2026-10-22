import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { upgradeResource } from "../surface/containers.mjs";
import { ContainerRuntime } from "../surface/ContainerRuntime";
import { PageContent } from "../portable/PageContent";
import { frameBounds } from "../surface/geometry.mjs";
import { SurfaceReader } from "../portable/SurfaceReader";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import CatalogPreview from "./CatalogPreview";
import { desktop, errorMessage } from "./bridge";
import type { LoadedPage } from "./usePage";

/**
 * Load only visible cards; the library stays inexpensive even with large folders.
 * Documents flow into up to four columns to fill the card; boards show their
 * content's bounds with a margin, centred, so a drawn shape never becomes the edge.
 */
export default function PageThumbnail({
  projectId,
  pageId,
  updatedAt,
  padding,
}: {
  projectId: string;
  pageId: string;
  updatedAt: string;
  /** Margin around the page; small previews inside folder cards use less. */
  padding?: number;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [record, setRecord] = useState<LoadedPage | null>(null);
  const [error, setError] = useState("");
  const loadedKey = useRef("");
  const key = `${projectId}:${pageId}:${updatedAt}`;
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "100px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || loadedKey.current === key) return;
    let cancelled = false;
    setError("");
    void desktop.invoke<LoadedPage>("pages:get", { projectId, pageId }).then(
      (value) => {
        if (!cancelled) {
          loadedKey.current = key;
          setRecord(value);
        }
      },
      (reason) => {
        if (!cancelled) setError(errorMessage(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [visible, projectId, pageId, updatedAt]);
  const previewDocument = useMemo(
    () => (record ? upgradeResource(record.document) : null),
    [record],
  );
  const board = useMemo(() => {
    if (!record || record.document.content.attrs?.kind !== "board")
      return undefined;
    const doc = record.document;
    const boxes = (doc.content.content ?? []).flatMap((node) => {
      const frame = doc.layout?.[node.attrs?.id];
      return frame
        ? [frameBounds({ ...frame, height: frame.height ?? 460 })]
        : [];
    });
    if (!boxes.length) return { width: 960, height: 640, transform: "none" };
    const left = Math.min(...boxes.map((b) => b.x)),
      top = Math.min(...boxes.map((b) => b.y));
    const width = Math.max(...boxes.map((b) => b.x + b.width)) - left;
    const height = Math.max(...boxes.map((b) => b.y + b.height)) - top;
    const margin = Math.max(48, 0.14 * Math.max(width, height));
    return {
      width: Math.ceil(width + margin * 2),
      height: Math.ceil(height + margin * 2),
      transform: `translate(${margin - left}px, ${margin - top}px)`,
    };
  }, [record]);
  return (
    <span
      ref={host}
      className="studio-page-thumbnail"
      aria-hidden="true"
      inert
      data-board={board ? true : undefined}
      style={
        board
          ? ({
              "--thumbnail-transform": board.transform,
              "--board-width": `${board.width}px`,
              "--board-height": `${board.height}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {error ? (
        <span>{error}</span>
      ) : (
        record &&
        visible && (
          <CustomComponentsProvider components={record.components}>
            <CatalogPreview
              thumbnail
              label={record.document.title}
              resetKey={updatedAt}
              width={board?.width ?? 960}
              maxColumns={board ? 1 : 4}
              padding={padding}
            >
              {board ? (
                <ContainerRuntime
                  document={previewDocument!}
                  hideTitle
                  nativeInkBackground
                  renderContent={({ content, componentData }) => (
                    <PageContent content={content} data={componentData} />
                  )}
                />
              ) : (
                <SurfaceReader
                  document={previewDocument!}
                  heading={null}
                  partial
                  presentation="spatial"
                />
              )}
            </CatalogPreview>
          </CustomComponentsProvider>
        )
      )}
    </span>
  );
}
