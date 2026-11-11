import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { prefersReducedMotion } from "./motion";

export type PresenceState = "hidden" | "entering" | "shown" | "exiting";

/**
 * Keeps an element mounted while it animates out. `show` and `hide` may be
 * called in any order: an exit ends only through `settle`, and showing again
 * before it settles cancels the pending unmount.
 */
export class PresenceController {
  private generation = 0;
  state: PresenceState;

  constructor(
    open: boolean,
    private report: (state: PresenceState) => void,
  ) {
    // An element that is open from the start appears without an entrance.
    this.state = open ? "shown" : "hidden";
  }

  private set(state: PresenceState) {
    if (state === this.state) return;
    this.state = state;
    this.report(state);
  }

  show(animate: boolean) {
    this.generation++;
    if (this.state === "shown" || this.state === "entering") return;
    this.set(animate ? "entering" : "shown");
  }

  /** Marks the element shown once `done` resolves, unless it was hidden meanwhile. */
  entered(done: Promise<unknown>) {
    if (this.state !== "entering") return;
    const generation = this.generation;
    void done.then(() => {
      if (generation === this.generation && this.state === "entering")
        this.set("shown");
    });
  }

  hide(animate: boolean) {
    if (this.state === "hidden") return;
    this.generation++;
    this.set(animate ? "exiting" : "hidden");
  }

  /** Unmounts once `done` resolves, unless the element was shown again meanwhile. */
  settle(done: Promise<unknown>) {
    if (this.state !== "exiting") return;
    const generation = this.generation;
    void done.then(() => {
      if (generation === this.generation && this.state === "exiting")
        this.set("hidden");
    });
  }
}

/** Waits for every animation running on the element, ignoring cancelled ones. */
export function animationsSettled(element: Element) {
  return Promise.all(
    element
      .getAnimations()
      .map((animation) => animation.finished.catch(() => undefined)),
  );
}

/**
 * `mounted` stays true until the exit animation of `ref` ends. The element
 * reads `state` (as a data attribute) to choose its entrance or exit
 * animation; while exiting it should be inert so it takes no clicks or focus.
 * Under reduced motion, or when `animate` is false, it mounts and unmounts
 * at once.
 */
export function usePresence(
  open: boolean,
  ref: RefObject<Element | null>,
  animate = true,
) {
  const [state, setState] = useState<PresenceState>(open ? "shown" : "hidden");
  const controller = useRef<PresenceController | null>(null);
  controller.current ??= new PresenceController(open, setState);
  const latestAnimate = useRef(animate);
  latestAnimate.current = animate;
  useLayoutEffect(() => {
    const motion = latestAnimate.current && !prefersReducedMotion();
    if (open) controller.current!.show(motion);
    else controller.current!.hide(motion && !!ref.current);
  }, [open, ref]);
  useLayoutEffect(() => {
    // Runs after the new state rendered, so its CSS animation exists.
    const done = ref.current
      ? animationsSettled(ref.current)
      : Promise.resolve();
    if (state === "exiting") controller.current!.settle(done);
    if (state === "entering") controller.current!.entered(done);
  }, [state, ref]);
  return {
    mounted: open || state !== "hidden",
    state: open && state === "exiting" ? "entering" : state,
  };
}
