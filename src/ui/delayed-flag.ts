import { useEffect, useState } from "react";

export const PENDING_DELAY_MS = 180;

export function scheduleDelayedFlag(
  active: boolean,
  delay: number,
  report: (visible: boolean) => void,
): () => void {
  if (!active) {
    report(false);
    return () => {};
  }
  if (delay <= 0) {
    report(true);
    return () => {};
  }
  const timer = setTimeout(() => report(true), delay);
  return () => clearTimeout(timer);
}

export function useDelayedFlag(active: boolean, delay = PENDING_DELAY_MS) {
  const [visible, setVisible] = useState(false);
  useEffect(
    () => scheduleDelayedFlag(active, delay, setVisible),
    [active, delay],
  );
  return active && visible;
}
