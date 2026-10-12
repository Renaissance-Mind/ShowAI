import { useLayoutEffect, useRef, useState } from "react";

/** Adapter to ShowAI's existing personal viewport-lock protocol; no content writes. */
export function useReadingLock() {
  const ref = useRef<HTMLElement>(null);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState("");
  const key = useRef("");
  const bridge = useRef<{ channel: string; scope: string } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    const owner =
      element.closest("[data-block-id], [data-surface-id]") || document.body;
    const instance = [
      ...owner.querySelectorAll('[data-viewport-lock-scope="text-diagram"]'),
    ].indexOf(element);
    const scope = `text-diagram:${instance}`;
    const id =
      owner.getAttribute("data-block-id") ||
      owner.getAttribute("data-surface-id");
    key.current = `showai.viewport-lock.v1:${id || location.pathname}:${scope}`;
    const config = document.getElementById("showai-component-data");
    const channel = config
      ? JSON.parse(config.textContent || "{}").channel
      : undefined;
    if (channel && parent !== window) {
      bridge.current = { channel, scope };
      const receive = (event: MessageEvent) => {
        if (
          event.source !== parent ||
          event.data?.channel !== channel ||
          event.data?.scope !== scope ||
          event.data?.type !== "showai:viewport-lock-state"
        )
          return;
        if (typeof event.data.locked === "boolean")
          setLocked(event.data.locked);
        setError(event.data.error || "");
      };
      // Native scrolling inside a tall drawing remains available while locked.
      // At its edge the existing host bridge resumes normal document reading.
      const wheel = (event: WheelEvent) => {
        if (element.dataset.viewportLocked !== "true") return;
        if (!event.ctrlKey && !event.metaKey) {
          for (
            let target = event.target instanceof Element ? event.target : null;
            target && target !== element;
            target = target.parentElement
          ) {
            const style = getComputedStyle(target);
            if (
              /auto|scroll/.test(style.overflowY) &&
              ((event.deltaY > 0 &&
                target.scrollTop + target.clientHeight <
                  target.scrollHeight - 1) ||
                (event.deltaY < 0 && target.scrollTop > 0))
            )
              return;
            if (
              /auto|scroll/.test(style.overflowX) &&
              ((event.deltaX > 0 &&
                target.scrollLeft + target.clientWidth <
                  target.scrollWidth - 1) ||
                (event.deltaX < 0 && target.scrollLeft > 0))
            )
              return;
          }
        }
        event.preventDefault();
        event.stopPropagation();
        parent.postMessage(
          {
            channel,
            type: "showai:reading-wheel",
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          },
          "*",
        );
      };
      window.addEventListener("message", receive);
      element.addEventListener("wheel", wheel, {
        capture: true,
        passive: false,
      });
      parent.postMessage(
        { channel, scope, type: "showai:viewport-lock-get" },
        "*",
      );
      return () => {
        window.removeEventListener("message", receive);
        element.removeEventListener("wheel", wheel, true);
      };
    }
    try {
      setLocked(localStorage.getItem(key.current) !== "unlocked");
    } catch (caught) {
      setError(`无法读取阅读锁状态：${String(caught)}`);
    }
  }, []);
  function toggle() {
    const next = !locked;
    if (bridge.current) {
      parent.postMessage(
        { ...bridge.current, type: "showai:viewport-lock-set", locked: next },
        "*",
      );
      return;
    }
    try {
      localStorage.setItem(key.current, next ? "locked" : "unlocked");
      setError("");
    } catch (caught) {
      setError(`无法保存阅读锁状态：${String(caught)}`);
    }
    setLocked(next);
  }
  return { ref, locked, toggle, error };
}
