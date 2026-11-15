export const locateHighlightClass = "is-located";
export const locateHighlightDuration = 1600;
export const locateHoldDuration = locateHighlightDuration + 400;

export interface ScrollContainerMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  top: number;
}

export interface RowMetrics {
  top: number;
  height: number;
}

export function centeredScrollTop(
  container: ScrollContainerMetrics,
  row: RowMetrics,
): number {
  const rowOffset = container.scrollTop + row.top - container.top;
  const centered = rowOffset - (container.clientHeight - row.height) / 2;
  const limit = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.round(Math.max(0, Math.min(limit, centered)));
}

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
  const timer = window.setTimeout(finish, locateHighlightDuration + 200);
  row.addEventListener("animationend", onAnimationEnd);
  return true;
}
