import type { Page } from "playwright-core";
import type { SceneStep } from "./types";

export async function checkMotion(
  page: Page,
  check: NonNullable<SceneStep["motion"]>,
  preference: "reduce" | "no-preference",
  act: () => Promise<void>,
) {
  const probe = await page.evaluateHandle((config) => {
    const events = new Set<string>(),
      animations = new Set<Animation>();
    const widthTarget = config.stableWidth
      ? document.querySelector(config.stableWidth)
      : null;
    if (config.stableWidth && !widthTarget)
      throw new Error("Missing motion width target: " + config.stableWidth);
    let width = widthTarget?.getBoundingClientRect().width ?? 0,
      widthChanges = 0;
    const observer = widthTarget
      ? new ResizeObserver(([entry]) => {
          const next = entry.borderBoxSize[0].inlineSize;
          if (Math.abs(next - width) > 0.5) {
            widthChanges++;
            width = next;
          }
        })
      : undefined;
    if (widthTarget) observer!.observe(widthTarget, { box: "border-box" });
    const record = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(config.selector))
        return;
      if (
        !(
          event instanceof TransitionEvent || event instanceof AnimationEvent
        ) ||
        event.pseudoElement !== (config.pseudo ?? "")
      )
        return;
      events.add(
        event instanceof TransitionEvent
          ? "transition:" + event.propertyName
          : "animation:" + event.animationName,
      );
      for (const animation of target.getAnimations()) animations.add(animation);
    };
    document.addEventListener("transitionrun", record, true);
    document.addEventListener("animationstart", record, true);
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
      async result() {
        await frame();
        await frame();
        let timer: number | undefined;
        try {
          await Promise.race([
            Promise.allSettled(
              [...animations].map((animation) => animation.finished),
            ),
            new Promise<never>((_, reject) => {
              timer = window.setTimeout(
                () =>
                  reject(
                    new Error("Motion did not settle on " + config.selector),
                  ),
                5000,
              );
            }),
          ]);
        } finally {
          window.clearTimeout(timer);
        }
        await frame();
        return {
          events: [...events].sort(),
          ...(widthTarget ? { widthChanges } : {}),
        };
      },
      release() {
        observer?.disconnect();
        document.removeEventListener("transitionrun", record, true);
        document.removeEventListener("animationstart", record, true);
      },
    };
  }, check);
  try {
    await act();
    const observed = await probe.evaluate((state) => state.result());
    const expected = preference === "reduce" ? [] : check.events;
    if (
      expected.length
        ? expected.some((name) => !observed.events.includes(name))
        : observed.events.length > 0
    )
      throw new Error(
        `Motion mismatch on ${check.selector} (${preference}): expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed.events)}.`,
      );
    if ((observed.widthChanges ?? 0) > 1)
      throw new Error(
        `${check.stableWidth} changed width ${observed.widthChanges} times in one action.`,
      );
    return observed;
  } finally {
    await probe.evaluate((state) => state.release());
    await probe.dispose();
  }
}
