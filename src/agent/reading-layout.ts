export function measureReadingLayout(input: { blockIds?: string[] }) {
  const round = (value: number) => Math.round(value * 100) / 100;
  const rect = (r: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => ({
    x: round(r.x),
    y: round(r.y),
    width: round(r.width),
    height: round(r.height),
  });
  const viewport = { x: 0, y: 0, width: innerWidth, height: innerHeight };
  const elements = new Map<string, Element>();
  for (const el of document.querySelectorAll(
    "[data-block-id],[data-surface-id]",
  )) {
    const id =
      el.getAttribute("data-block-id") || el.getAttribute("data-surface-id");
    if (id && !elements.has(id)) elements.set(id, el);
  }
  const ids = input.blockIds ?? [...elements.keys()].slice(0, 200);
  const clippingRect = (el: Element, original: DOMRect) => {
    let left = Math.max(0, original.left),
      top = Math.max(0, original.top);
    let right = Math.min(innerWidth, original.right),
      bottom = Math.min(innerHeight, original.bottom);
    let hidden = false;
    for (
      let ancestor: Element | null = el;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const css = getComputedStyle(ancestor);
      if (
        css.display === "none" ||
        (ancestor === el &&
          (css.visibility === "hidden" || css.visibility === "collapse")) ||
        Number(css.opacity) === 0
      )
        hidden = true;
      if (ancestor === el) continue;
      const r = ancestor.getBoundingClientRect();
      const sx =
        ancestor instanceof HTMLElement && ancestor.offsetWidth
          ? r.width / ancestor.offsetWidth
          : 1;
      const sy =
        ancestor instanceof HTMLElement && ancestor.offsetHeight
          ? r.height / ancestor.offsetHeight
          : 1;
      if (/^(auto|scroll|hidden|clip)$/.test(css.overflowX)) {
        left = Math.max(left, r.left + ancestor.clientLeft * sx);
        right = Math.min(
          right,
          r.left + (ancestor.clientLeft + ancestor.clientWidth) * sx,
        );
      }
      if (/^(auto|scroll|hidden|clip)$/.test(css.overflowY)) {
        top = Math.max(top, r.top + ancestor.clientTop * sy);
        bottom = Math.min(
          bottom,
          r.top + (ancestor.clientTop + ancestor.clientHeight) * sy,
        );
      }
    }
    return {
      x: left,
      y: top,
      width: hidden ? 0 : Math.max(0, right - left),
      height: hidden ? 0 : Math.max(0, bottom - top),
    };
  };
  const blocks = ids.map((blockId) => {
    const el = elements.get(blockId);
    if (!el) return { blockId, status: "not-rendered" as const };
    const r = el.getBoundingClientRect();
    const visible = clippingRect(el, r);
    const css = getComputedStyle(el);
    const area = r.width * r.height;
    return {
      blockId,
      status: "measured" as const,
      rect: rect(r),
      visibleRect: rect(visible),
      visibleFraction:
        area > 0
          ? Math.round(((visible.width * visible.height) / area) * 10000) /
            10000
          : 0,
      viewportHeightRatio: round(r.height / innerHeight),
      overflow: {
        horizontal: el.scrollWidth > el.clientWidth + 1,
        vertical: el.scrollHeight > el.clientHeight + 1,
        modeX: css.overflowX,
        modeY: css.overflowY,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
      },
    };
  });
  const root =
    document.querySelector(
      ".container-page.is-root > .container-page-column",
    ) ?? document.querySelector(".portable-app");
  let contentArea = viewport;
  if (root) {
    const bounds = root.getBoundingClientRect();
    const css = getComputedStyle(root);
    const sx =
      root instanceof HTMLElement && root.offsetWidth
        ? bounds.width / root.offsetWidth
        : 1;
    const sy =
      root instanceof HTMLElement && root.offsetHeight
        ? bounds.height / root.offsetHeight
        : 1;
    const left = (parseFloat(css.paddingLeft) + root.clientLeft) * sx;
    const right = (parseFloat(css.paddingRight) + root.clientLeft) * sx;
    const top = (parseFloat(css.paddingTop) + root.clientTop) * sy;
    const bottom = (parseFloat(css.paddingBottom) + root.clientTop) * sy;
    contentArea = rect(
      clippingRect(
        root,
        new DOMRect(
          bounds.x + left,
          bounds.y + top,
          Math.max(0, bounds.width - left - right),
          Math.max(0, bounds.height - top - bottom),
        ),
      ),
    );
  }
  return {
    protocol: "showai-reading-layout-v1" as const,
    coordinateSpace: "viewport-css-pixels" as const,
    viewport: { width: innerWidth, height: innerHeight },
    contentArea,
    blocks,
    total: input.blockIds?.length ?? elements.size,
    truncated: !input.blockIds && elements.size > ids.length,
    coverage: {
      visibility:
        "viewport-and-ancestor-clipping; excludes sibling occlusion and non-rectangular masks",
      internals:
        "top-document block frames only; no iframe internals, raster text, canvas contents or aesthetic score",
    },
  };
}

export type ReadingLayout = ReturnType<typeof measureReadingLayout>;
