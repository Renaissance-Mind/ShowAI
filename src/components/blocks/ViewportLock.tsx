import { useLayoutEffect, useRef, useState } from "react";
import { LockKeyhole, UnlockKeyhole } from "../../ui/icons";
import "./viewport-lock.css";

export function viewportLockKey(element: Element, scope: string) {
  const owner = element.closest("[data-block-id], [data-surface-id]");
  const id =
    owner?.getAttribute("data-block-id") ||
    owner?.getAttribute("data-surface-id");
  return `showai.viewport-lock.v1:${id || location.pathname}:${scope}`;
}

export function readViewportLock(key: string) {
  return localStorage.getItem(key) !== "unlocked";
}

export function writeViewportLock(key: string, locked: boolean) {
  localStorage.setItem(key, locked ? "locked" : "unlocked");
}

/** Personal reading preference, independent of content and editing permissions. */
export function useViewportLock(scope: string, storageKey?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const key = useRef("");
  const bridge = useRef<{ channel: string; scope: string } | null>(null);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const element = ref.current!;
    const owner =
      element.closest("[data-block-id], [data-surface-id]") ||
      element.ownerDocument.body;
    const instances = [
      ...owner.querySelectorAll(`[data-viewport-lock-scope="${scope}"]`),
    ];
    const instanceScope = `${scope}:${instances.indexOf(element)}`;
    key.current = storageKey || viewportLockKey(element, instanceScope);
    const config = element.ownerDocument.getElementById(
      "showai-component-data",
    );
    const channel = config
      ? JSON.parse(config.textContent || "{}").channel
      : undefined;
    if (channel && window.parent !== window) {
      bridge.current = { channel, scope: instanceScope };
      const receive = (event: MessageEvent) => {
        if (
          event.source !== parent ||
          event.data?.channel !== channel ||
          event.data?.type !== "showai:viewport-lock-state" ||
          event.data.scope !== instanceScope
        )
          return;
        if (typeof event.data.locked === "boolean")
          setLocked(event.data.locked);
        setError(event.data.error || "");
      };
      const wheel = (event: WheelEvent) => {
        if (element.dataset.viewportLocked !== "true") return;
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
        { channel, type: "showai:viewport-lock-get", scope: instanceScope },
        "*",
      );
      return () => {
        window.removeEventListener("message", receive);
        element.removeEventListener("wheel", wheel, true);
      };
    }
    try {
      setLocked(readViewportLock(key.current));
    } catch (caught) {
      setError(`无法读取阅读锁状态：${String(caught)}`);
    }
  }, [scope, storageKey]);
  const toggle = () => {
    const next = !locked;
    if (bridge.current) {
      parent.postMessage(
        { ...bridge.current, type: "showai:viewport-lock-set", locked: next },
        "*",
      );
      return;
    }
    try {
      writeViewportLock(key.current, next);
      setError("");
    } catch (caught) {
      setError(`无法保存阅读锁状态：${String(caught)}`);
    }
    setLocked(next);
  };
  return { ref, locked, toggle, error };
}

export function ViewportLockButton({
  locked,
  toggle,
  error = "",
  label,
}: {
  locked: boolean;
  toggle: () => void;
  error?: string;
  label: string;
}) {
  const action = `${locked ? "解锁" : "锁定"}${label}`;
  return (
    <button
      type="button"
      className="viewport-lock-button"
      data-surface-ui
      aria-label={action}
      aria-pressed={locked}
      title={
        error ||
        `${action}：${locked ? "允许缩放和移动" : "保持视图，正常滚动阅读"}`
      }
      onClick={toggle}
    >
      {locked ? <LockKeyhole size={16} /> : <UnlockKeyhole size={16} />}
      {error && (
        <span className="viewport-lock-error" role="alert">
          {error}
        </span>
      )}
    </button>
  );
}
