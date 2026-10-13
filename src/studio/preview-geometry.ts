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
