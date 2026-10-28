import { useLayoutEffect, useRef, type RefObject } from "react";
import { sameLocation, type WorkspaceLocation } from "./workspace-tabs";

/** Animate the committed destination without remounting editors or waiting to navigate. */
export function useNavigationMotion(
  container: RefObject<HTMLElement | null>,
  location: WorkspaceLocation,
  tabId: string,
  depth: number,
  ready: boolean,
) {
  const previous = useRef<{
    location: WorkspaceLocation;
    tabId: string;
    depth: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!ready) return;
    const from = previous.current;
    previous.current = { location, tabId, depth };
    if (
      !from ||
      (from.tabId === tabId && sameLocation(from.location, location))
    )
      return;
    const element = container.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!element?.animate || reduced.matches) return;

    const sameProject = from.location.projectId === location.projectId;
    const direction =
      from.tabId === tabId && sameProject && depth !== from.depth
        ? Math.sign(depth - from.depth)
        : 0;
    const animation = element.animate(
      [
        {
          opacity: 0.45,
          transform: `translate3d(${direction * 16}px, ${direction ? 0 : 5}px, 0)`,
        },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ],
      { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
    // Direct input takes priority, including a changed system motion preference.
    const cancel = () => animation.cancel();
    element.addEventListener("pointerdown", cancel, {
      capture: true,
      once: true,
    });
    element.addEventListener("keydown", cancel, { capture: true, once: true });
    element.addEventListener("wheel", cancel, { passive: true, once: true });
    reduced.addEventListener("change", cancel);
    return () => {
      animation.cancel();
      element.removeEventListener("pointerdown", cancel, true);
      element.removeEventListener("keydown", cancel, true);
      element.removeEventListener("wheel", cancel);
      reduced.removeEventListener("change", cancel);
    };
  }, [
    container,
    location.view,
    location.projectId,
    location.folderId,
    location.pageId,
    tabId,
    depth,
    ready,
  ]);
}
