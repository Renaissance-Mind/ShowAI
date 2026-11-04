/** Row class while the located page is highlighted; see library-row.css. */
export const locateHighlightClass = "is-located";
/** Matches the highlight animation; the sidebar stays revealed as long. */
export const locateHighlightDuration = 1600;
export const locateHoldDuration = locateHighlightDuration + 400;

export interface ScrollContainerMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  /** Viewport top of the container, as getBoundingClientRect reports it. */
  top: number;
}

export interface RowMetrics {
  /** Viewport top of the row, as getBoundingClientRect reports it. */
  top: number;
  height: number;
}

/**
 * Scroll offset that puts the row in the middle of its container. Rows near
 * either end settle at that end instead, since the container cannot scroll
 * further.
 */
export function centeredScrollTop(
  container: ScrollContainerMetrics,
  row: RowMetrics,
): number {
  const rowOffset = container.scrollTop + row.top - container.top;
  const centered = rowOffset - (container.clientHeight - row.height) / 2;
  const limit = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.round(Math.max(0, Math.min(limit, centered)));
}

/**
 * Scrolls the sidebar so the page's row sits in the middle and flashes it.
 * False when the row is not rendered, for example before its folders expand.
 */
export function revealSidebarRow(
  scope: ParentNode,
  target: { projectId: string; pageId: string },
): boolean {
  const main = scope.querySelector<HTMLElement>(
    `.studio-sidebar-projects .studio-tree-main[data-open-page="${CSS.escape(target.pageId)}"][data-open-project="${CSS.escape(target.projectId)}"]`,
  );
  const row = main?.closest<HTMLElement>(".studio-tree-row");
  const container = row?.closest<HTMLElement>(".studio-sidebar-projects");
  if (!row || !container) return false;
  // Folders that just expanded move scroll anchoring in the next rendering
  // update; measuring after that frame keeps the adjustment from landing on
  // top of this scroll.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!row.isConnected) return;
      const box = container.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      container.scrollTo({
        top: centeredScrollTop(
          {
            scrollTop: container.scrollTop,
            clientHeight: container.clientHeight,
            scrollHeight: container.scrollHeight,
            top: box.top,
          },
          { top: rect.top, height: rect.height },
        ),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }),
  );
  // Re-adding the class within one frame would not restart the animation.
  row.classList.remove(locateHighlightClass);
  void row.offsetWidth;
  row.classList.add(locateHighlightClass);
  const finish = () => {
    row.classList.remove(locateHighlightClass);
    row.removeEventListener("animationend", onAnimationEnd);
    window.clearTimeout(timer);
  };
  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.target === row) finish();
  };
  // Reduced motion or a replaced row would otherwise leave the class behind.
  const timer = window.setTimeout(finish, locateHighlightDuration + 200);
  row.addEventListener("animationend", onAnimationEnd);
  return true;
}
