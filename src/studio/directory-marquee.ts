export interface MarqueeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** All coordinates are in scroll-content space, including offscreen entries. */
export function marqueeIds(
  entries: (MarqueeBounds & { id: string })[],
  bounds: MarqueeBounds,
  base: string[],
) {
  const ids = new Set(base);
  for (const entry of entries)
    if (
      entry.right > bounds.left &&
      entry.left < bounds.right &&
      entry.bottom > bounds.top &&
      entry.top < bounds.bottom
    )
      ids.add(entry.id);
  return [...ids];
}
