import { useMemo, type CSSProperties } from "react";
import { upgradeResource } from "../surface/containers.mjs";
import { ContainerRuntime } from "../surface/ContainerRuntime";
import { PageContent } from "../portable/PageContent";
import { frameBounds } from "../surface/geometry.mjs";
import { SurfaceReader } from "../portable/SurfaceReader";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import CatalogPreview from "./CatalogPreview";
import type { LoadedPage } from "./usePage";

/** Shared renderer, used in the capture process instead of the desktop directory. */
export default function PageThumbnailContent({
  record,
  updatedAt,
  padding,
}: {
  record: LoadedPage;
  updatedAt: string;
  padding?: number;
}) {
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
      className="studio-page-thumbnail-content"
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
      <CustomComponentsProvider components={record.components}>
        <CatalogPreview
          thumbnail
          label={record.document.title}
          resetKey={updatedAt}
          width={board?.width ?? 960}
          maxColumns={board ? 1 : 4}
          fitMode={board ? "contain" : "width"}
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
    </span>
  );
}
