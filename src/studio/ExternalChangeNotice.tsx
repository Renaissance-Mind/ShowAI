import { useEffect, useRef, useState } from "react";
import { Info, X } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import { getLocale } from "../i18n";
import pageSessionMessages from "../i18n/messages/pageSession";
import type { ExternalChangeNotice as Notice } from "./page-session";
import { authorName } from "./external-change";
import "./external-change.css";

/**
 * Outlines changed blocks for a few seconds without touching editor DOM
 * (ProseMirror re-reads nodes whose attributes change). Boxes are fixed-position,
 * follow the blocks each frame and are clipped to the page's scroll area.
 */
let stopFlash: (() => void) | undefined;
export function flashBlocks(
  root: HTMLElement | null,
  blockIds: readonly string[],
  duration = 4200,
) {
  stopFlash?.();
  if (!root || !blockIds.length) return;
  const layer = document.createElement("div");
  layer.className = "external-change-layer";
  layer.style.setProperty("--external-change-duration", `${duration}ms`);
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const boxes = blockIds.map(() => layer.appendChild(document.createElement("div")));
  let frame = 0;
  const started = performance.now();
  const paint = (now: number) => {
    if (now - started > duration) return stop();
    const bounds = root.getBoundingClientRect();
    blockIds.forEach((id, index) => {
      const box = boxes[index];
      const target = root.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
      const rect = target?.getBoundingClientRect();
      const top = rect && Math.max(rect.top - 3, bounds.top);
      const bottom = rect && Math.min(rect.bottom + 3, bounds.bottom);
      if (!rect || !rect.height || top! >= bottom!) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      box.className = "external-change-box";
      box.style.left = `${rect.left - 6}px`;
      box.style.width = `${rect.width + 12}px`;
      box.style.top = `${top}px`;
      box.style.height = `${bottom! - top!}px`;
    });
    frame = requestAnimationFrame(paint);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    layer.remove();
    if (stopFlash === stop) stopFlash = undefined;
  };
  stopFlash = stop;
  frame = requestAnimationFrame(paint);
}

/** Scrolls the first changed block into view and outlines the changes again. */
export function locateBlocks(root: HTMLElement | null, blockIds: readonly string[]) {
  const first = blockIds
    .map((id) => root?.querySelector(`[data-block-id="${CSS.escape(id)}"]`))
    .find(Boolean);
  first?.scrollIntoView({ block: "center", behavior: "smooth" });
  flashBlocks(root, blockIds);
}

const channelKey = {
  mcp: "MCP",
  cli: "CLI",
  desktop: "Desktop",
  browser: "Browser",
  external: "External",
  system: "System",
} as const;

/** Hovering or focusing the banner pauses this; leaving restarts it. */
const AUTO_DISMISS_MS = 8000;

/**
 * 「<名称> 刚更新了这个页面的 N 处」: a one-line banner floating over the top
 * of the page that dismisses itself unless the pointer or focus is on it.
 */
export function ExternalChangeNotice({
  change,
  onLocate,
  onUndo,
  onDismiss,
}: {
  change: Notice;
  onLocate: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslator(pageSessionMessages);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const held = hovered || focused;
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => dismiss.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [held]);
  const name = authorName(change.author);
  const title = t("external.title", { name, count: change.count });
  const details = t("external.details", {
    name,
    channel: change.author ? channelKey[change.author.channel] : "-",
    time: new Date(change.author?.at ?? change.at).toLocaleString(getLocale()),
  });
  return (
    <div
      className="external-change-notice"
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <Info size={14} aria-hidden className="external-change-notice-icon" />
      <span className="external-change-notice-title" title={details}>
        {title}
      </span>
      {!!change.blockIds.length && (
        <button className="external-change-notice-action" onClick={onLocate}>
          {t("external.locate")}
        </button>
      )}
      <button className="external-change-notice-action" onClick={onUndo}>
        {t("external.undo")}
      </button>
      <button
        className="external-change-notice-close"
        aria-label={t("external.dismiss")}
        onClick={onDismiss}
      >
        <X size={13} />
      </button>
    </div>
  );
}
