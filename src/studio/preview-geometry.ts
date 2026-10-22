/** Fit the entire natural content, preserving its aspect ratio. */
export function previewFit(
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
  padding = 24,
) {
  if (
    width <= 0 ||
    height <= 0 ||
    viewportWidth <= padding * 2 ||
    viewportHeight <= padding * 2
  )
    return 1;
  return Math.min(
    1,
    (viewportWidth - padding * 2) / width,
    (viewportHeight - padding * 2) / height,
  );
}
export function previewZoom(value: number) {
  return Math.max(0.05, Math.min(3, value));
}
/**
 * Split a tall page into balanced columns (1 to `max`) when that lets the
 * preview show it larger: the count whose combined shape best matches the
 * viewport wins, so a long document fills a wide card instead of becoming a
 * thin strip, and a short one keeps a single column.
 */
export function previewColumns(
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
  gap: number,
  max = 4,
  padding = 10,
) {
  let best = 1,
    bestScale = 0;
  for (let columns = 1; columns <= max; columns++) {
    const scale = previewFit(
      viewportWidth,
      viewportHeight,
      columns * width + (columns - 1) * gap,
      height / columns,
      padding,
    );
    // Another column must enlarge the page noticeably to be worth the split.
    if (scale > bestScale * 1.1) {
      best = columns;
      bestScale = scale;
    }
  }
  return best;
}
