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

/** Load only visible cards; the library stays inexpensive even with large folders.
 * The page fills the card width at a 4:3 stage, so boards and documents share one shape. */
export default function PageThumbnail({
  projectId,
  pageId,
  updatedAt,
}: {
  projectId: string;
  pageId: string;
  updatedAt: string;
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
  const boardTransform = useMemo(() => {
    if (!record || record.document.content.attrs?.kind !== "board")
      return undefined;
    const doc = record.document;
    const boxes = (doc.content.content ?? []).flatMap((node) => {
      const frame = doc.layout?.[node.attrs?.id];
      return frame
        ? [frameBounds({ ...frame, height: frame.height ?? 460 })]
        : [];
    });
    if (!boxes.length) return "none";
    const left = Math.min(...boxes.map((b) => b.x)),
      top = Math.min(...boxes.map((b) => b.y));
    const width = Math.max(...boxes.map((b) => b.x + b.width)) - left;
    const height = Math.max(...boxes.map((b) => b.y + b.height)) - top;
    const scale = Math.min(920 / Math.max(1, width), 680 / Math.max(1, height));
    return `translate(${(960 - width * scale) / 2 - left * scale}px, ${(720 - height * scale) / 2 - top * scale}px) scale(${scale})`;
  }, [record]);
  return (
    <span
      ref={host}
      className="studio-page-thumbnail"
      aria-hidden="true"
      inert
      style={{ "--thumbnail-transform": boardTransform } as CSSProperties}
    >
      {error ? (
        <span>{error}</span>
      ) : (
        record &&
        visible && (
          <CustomComponentsProvider components={record.components}>
            <CatalogPreview
              thumbnail
              fitWidth
              label={record.document.title}
              resetKey={updatedAt}
              width={960}
            >
              {boardTransform ? (
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
