export function previewFit(
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
  padding = 24,
  mode: "contain" | "width" = "contain",
) {
  if (
    width <= 0 ||
    height <= 0 ||
    viewportWidth <= padding * 2 ||
    viewportHeight <= padding * 2
  )
    return 1;
  const horizontal = Math.min(1, (viewportWidth - padding * 2) / width);
  return mode === "width"
    ? horizontal
    : Math.min(horizontal, (viewportHeight - padding * 2) / height);
}
export function previewZoom(value: number) {
  return Math.max(0.05, Math.min(3, value));
}
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
    if (scale > bestScale * 1.1) {
      best = columns;
      bestScale = scale;
    }
  }
  return best;
}
