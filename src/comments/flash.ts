export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let stop: (() => void) | undefined;
/**
 * Outline the given rects for a moment, following it each frame
 * (scrolling, Board panning) without touching editor DOM.
 */
export function flashTarget(rectsOf: () => DOMRect[], duration = 1600) {
  stop?.();
  const box = document.createElement("div");
  box.className = "comment-flash";
  box.setAttribute("aria-hidden", "true");
  box.style.setProperty("--comment-flash-duration", `${duration}ms`);
  document.body.append(box);
  const started = performance.now();
  let frame = 0;
  const paint = (now: number) => {
    if (now - started > duration) return end();
    const rects = rectsOf().filter((rect) => rect.width || rect.height);
    box.hidden = !rects.length;
    if (rects.length) {
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      box.style.left = `${left - 4}px`;
      box.style.top = `${top - 3}px`;
      box.style.width = `${right - left + 8}px`;
      box.style.height = `${bottom - top + 6}px`;
    }
    frame = requestAnimationFrame(paint);
  };
  const end = () => {
    cancelAnimationFrame(frame);
    box.remove();
    if (stop === end) stop = undefined;
  };
  stop = end;
  frame = requestAnimationFrame(paint);
}
