import type { SearchResult } from "../core/library-index";

export interface PageHoverPreviewTarget {
  projectId: string;
  pageId: string;
  updatedAt: string;
  hash?: string;
}

export interface PageHoverPreviewPoint {
  x: number;
  y: number;
}

export function searchResultPagePreview(
  result: Pick<SearchResult, "path" | "revision">,
): PageHoverPreviewTarget | undefined {
  const match = result.path.match(/^projects\/([^/]+)\/pages\/([^/]+)\.json$/);
  if (!match) return undefined;
  return {
    projectId: match[1],
    pageId: match[2],
    updatedAt: result.revision,
  };
}

export function pageHoverPreviewPosition(
  point: PageHoverPreviewPoint,
  viewport: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const margin = Math.max(
    0,
    Math.min(12, viewport.width / 4, viewport.height / 4),
  );
  const width = Math.max(
    0,
    Math.min(
      380,
      viewport.width - margin * 2,
      ((viewport.height - margin * 2) * 16) / 11,
    ),
  );
  const height = (width * 11) / 16;
  const gap = 14;
  const preferredLeft = point.x + gap;
  const unclampedLeft =
    preferredLeft + width <= viewport.width - margin
      ? preferredLeft
      : point.x - width - gap;
  const left = Math.max(
    margin,
    Math.min(unclampedLeft, viewport.width - margin - width),
  );
  const top = Math.max(
    margin,
    Math.min(point.y - height / 2, viewport.height - margin - height),
  );
  return { left, top, width, height };
}
