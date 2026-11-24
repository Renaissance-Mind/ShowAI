import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PageThumbnail from "./PageThumbnail";
import {
  pageHoverPreviewPosition,
  type PageHoverPreviewPoint,
  type PageHoverPreviewTarget,
} from "./page-hover-preview";
import "./page-hover-preview.css";

const HOVER_DELAY_MS = 120;

export function usePageHoverPreview() {
  const [preview, setPreview] = useState<{
    target: PageHoverPreviewTarget;
    point: PageHoverPreviewPoint;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const ticket = useRef(0);
  const point = useRef<PageHoverPreviewPoint>({ x: 0, y: 0 });
  const visibleKey = useRef("");
  const hide = useCallback(() => {
    ticket.current++;
    clearTimeout(timer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    visibleKey.current = "";
    setPreview(null);
  }, []);
  const show = useCallback(
    (
      target: PageHoverPreviewTarget | undefined,
      nextPoint: PageHoverPreviewPoint,
    ) => {
      point.current = nextPoint;
      if (!target) {
        hide();
        return;
      }
      const key = `${target.projectId}:${target.pageId}:${target.updatedAt}`;
      if (visibleKey.current === key) {
        setPreview({ target, point: nextPoint });
        return;
      }
      ticket.current++;
      clearTimeout(timer.current);
      visibleKey.current = "";
      setPreview(null);
      const current = ticket.current;
      timer.current = setTimeout(() => {
        if (ticket.current !== current) return;
        visibleKey.current = key;
        setPreview({ target, point: point.current });
      }, HOVER_DELAY_MS);
    },
    [hide],
  );
  const move = useCallback((nextPoint: PageHoverPreviewPoint) => {
    point.current = nextPoint;
    if (!visibleKey.current || frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      setPreview((current) =>
        current ? { ...current, point: point.current } : current,
      );
    });
  }, []);
  useEffect(() => {
    const resize = () => move(point.current);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", resize);
      ticket.current++;
      clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [hide, move]);
  return {
    show,
    move,
    hide,
    element: preview
      ? createPortal(
          <PageHoverPreview target={preview.target} point={preview.point} />,
          document.body,
        )
      : null,
  };
}

function PageHoverPreview({
  target,
  point,
}: {
  target: PageHoverPreviewTarget;
  point: PageHoverPreviewPoint;
}) {
  const position = pageHoverPreviewPosition(point, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return (
    <div
      className="page-hover-preview"
      data-page-hover-preview={target.pageId}
      aria-hidden="true"
      inert
      style={position}
    >
      <PageThumbnail
        key={`${target.projectId}:${target.pageId}:${target.updatedAt}`}
        projectId={target.projectId}
        pageId={target.pageId}
        updatedAt={target.updatedAt}
        hash={target.hash}
        padding={24}
        showLoading
      />
    </div>
  );
}
