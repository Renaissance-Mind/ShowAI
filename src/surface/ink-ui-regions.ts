/** Screen-space cutouts must match painted UI, including scrolling/clipping.
 * Offscreen toolbar children still have DOM rectangles; sending those raw
 * rectangles to PencilKit would erase ink beyond the actual toolbar. */
export function inkUIRegions(elements: Iterable<Element>) {
  const cache = new Map<
    Element,
    { style: CSSStyleDeclaration; rect: DOMRect }
  >();
  const read = (element: Element) => {
    let value = cache.get(element);
    if (!value) {
      value = {
        style: getComputedStyle(element),
        rect: element.getBoundingClientRect(),
      };
      cache.set(element, value);
    }
    return value;
  };
  const clips = (overflow: string) =>
    /^(auto|scroll|hidden|clip)$/.test(overflow);
  const regions: { x: number; y: number; width: number; height: number }[] = [];
  for (const element of elements) {
    const { style } = read(element);
    if (style.pointerEvents === "none" || style.visibility !== "visible")
      continue;
    const layer = element.closest(":popover-open,:modal");
    for (const rect of element.getClientRects()) {
      let left = Math.max(0, rect.left),
        top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right),
        bottom = Math.min(innerHeight, rect.bottom);
      for (
        let parent = element === layer ? null : element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const clip = read(parent);
        if (clips(clip.style.overflowX)) {
          left = Math.max(left, clip.rect.left);
          right = Math.min(right, clip.rect.right);
        }
        if (clips(clip.style.overflowY)) {
          top = Math.max(top, clip.rect.top);
          bottom = Math.min(bottom, clip.rect.bottom);
        }
        if (right <= left || bottom <= top || parent === layer) break;
      }
      if (right > left && bottom > top)
        regions.push({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        });
    }
  }
  return regions;
}
