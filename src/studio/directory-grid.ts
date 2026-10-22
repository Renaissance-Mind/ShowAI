import { useEffect, useState } from "react";

/** Narrowest card each thumbnail size accepts before a column is dropped. */
export const directoryCardWidths = {
  small: 220,
  medium: 300,
  large: 480,
} as const;

export type DirectoryThumbnailSize = keyof typeof directoryCardWidths;

/**
 * Equal-width columns fill the row: as many cards of at least the preferred
 * width as fit, never fewer than one and never more than four.
 */
export function directoryColumns(
  width: number,
  size: DirectoryThumbnailSize,
  gap = 16,
) {
  const fit = Math.floor((width + gap) / (directoryCardWidths[size] + gap));
  return Math.max(1, Math.min(4, fit));
}

/** Track the list width so the column count follows the window and side panels. */
export function useDirectoryColumns(size: DirectoryThumbnailSize | null) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element || !size) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, size]);
  return {
    ref: setElement,
    columns: size && width ? directoryColumns(width, size) : undefined,
  };
}
