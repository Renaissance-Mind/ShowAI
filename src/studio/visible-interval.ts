/**
 * Calls `tick` every `ms` while the window is visible. A hidden window does no
 * polling; when it becomes visible again `tick` runs at once and the interval
 * resumes. Returns a function that stops polling.
 */
export function visibleInterval(tick: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = () => {
    if (timer === undefined) timer = setInterval(tick, ms);
  };
  const pause = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const changed = () => {
    if (document.visibilityState === "hidden") pause();
    else {
      tick();
      start();
    }
  };
  if (document.visibilityState !== "hidden") start();
  document.addEventListener("visibilitychange", changed);
  return () => {
    pause();
    document.removeEventListener("visibilitychange", changed);
  };
}
