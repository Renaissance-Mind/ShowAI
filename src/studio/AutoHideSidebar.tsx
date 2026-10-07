import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { LockKeyhole, LockKeyholeOpen } from "lucide-react";
import "./auto-hide-sidebar.css";

const minimumWidth = 200;
const maximumWidth = 480;
const widthPreference = "showai:sidebar-width";

/** Keep the first view docked; subsequent edge reveals float over the document. */
export default function AutoHideSidebar({
  enabled,
  interactionHeld,
  children,
}: {
  enabled: boolean;
  interactionHeld: boolean;
  children: ReactNode;
}) {
  const [locked, setLocked] = useState(
    () => localStorage.getItem("showai:sidebar-locked") === "true",
  );
  const [position, setPosition] = useState<"docked" | "hidden" | "overlay">(
    "docked",
  );
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() => {
    const saved = localStorage.getItem(widthPreference);
    const value = saved === null ? NaN : Number(saved);
    return Number.isFinite(value)
      ? Math.max(minimumWidth, Math.min(maximumWidth, value))
      : null;
  });
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [resizing, setResizing] = useState(false);
  const resize = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    originalPreference: number | null;
    currentWidth: number;
  } | null>(null);
  const resizeHandle = useRef<HTMLDivElement>(null);
  const widthLimit = Math.max(
    minimumWidth,
    Math.min(maximumWidth, viewportWidth - 360),
  );
  const clampWidth = (value: number) =>
    Math.round(Math.max(minimumWidth, Math.min(widthLimit, value)));
  const width = clampWidth(
    preferredWidth ?? (viewportWidth <= 1100 ? 208 : 240),
  );
  const sidebar = useRef<HTMLElement>(null);
  const automatic = enabled && !locked;
  const mode = automatic ? position : "docked";
  const hidden = mode === "hidden";

  useEffect(() => {
    setPosition("docked");
  }, [enabled, locked]);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const cancel = () => {
      const current = resize.current;
      if (!current) return;
      resize.current = null;
      setPreferredWidth(current.originalPreference);
      setResizing(false);
      setHovered(false);
      const handle = resizeHandle.current;
      if (handle?.hasPointerCapture(current.pointerId))
        handle.releasePointerCapture(current.pointerId);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", cancel);
    };
  }, [resizing]);

  useEffect(() => {
    if (
      !automatic ||
      hovered ||
      keyboardFocus ||
      interactionHeld ||
      hidden ||
      resizing
    )
      return;
    // A short grace period bridges the edge, menus and quick pointer crossings.
    const timer = window.setTimeout(() => setPosition("hidden"), 300);
    return () => window.clearTimeout(timer);
  }, [automatic, hovered, keyboardFocus, interactionHeld, hidden, resizing]);

  const saveWidth = (value: number) => {
    const next = clampWidth(value);
    setPreferredWidth(next);
    localStorage.setItem(widthPreference, String(next));
  };
  const endResize = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resize.current = null;
    setResizing(false);
    if (cancel) setPreferredWidth(current.originalPreference);
    else saveWidth(current.currentWidth);
    const rect = sidebar.current!.getBoundingClientRect();
    setHovered(
      !cancel &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right + 4 &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    );
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const reveal = () => {
    setHovered(true);
    if (hidden) setPosition("overlay");
  };
  const lockLabel = locked ? "解锁项目栏，打开文档后自动收起" : "锁定项目栏";
  const focusNavigation = () => {
    window.requestAnimationFrame(() => {
      sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
      setKeyboardFocus(true);
    });
  };

  return (
    <div
      className="studio-sidebar-shell"
      data-sidebar-mode={mode}
      data-sidebar-resizing={resizing || undefined}
      style={{ "--navigation-width": `${width}px` } as CSSProperties}
    >
      <aside
        ref={sidebar}
        id="studio-project-navigation"
        className="studio-sidebar"
        aria-label="项目导航"
        inert={hidden}
        onPointerEnter={reveal}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={(event) => {
          if (event.target.matches(":focus-visible")) setKeyboardFocus(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setKeyboardFocus(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !automatic || interactionHeld) return;
          event.preventDefault();
          event.stopPropagation();
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
          setKeyboardFocus(false);
          setHovered(false);
          setPosition("hidden");
        }}
      >
        {children}
        <button
          type="button"
          className="studio-sidebar-lock"
          aria-label={lockLabel}
          title={lockLabel}
          aria-pressed={locked}
          onClick={() => {
            const next = !locked;
            localStorage.setItem("showai:sidebar-locked", String(next));
            setLocked(next);
          }}
        >
          {locked ? <LockKeyhole size={16} /> : <LockKeyholeOpen size={16} />}
        </button>
        <div
          ref={resizeHandle}
          className="studio-sidebar-resizer"
          role="separator"
          tabIndex={0}
          aria-label="调整项目栏宽度"
          aria-orientation="vertical"
          aria-controls="studio-project-navigation"
          aria-valuemin={minimumWidth}
          aria-valuemax={widthLimit}
          aria-valuenow={width}
          aria-valuetext={`${width} 像素`}
          onPointerDown={(event) => {
            if (event.button !== 0 || resize.current) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resize.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startWidth: width,
              originalPreference: preferredWidth,
              currentWidth: width,
            };
            setResizing(true);
          }}
          onPointerMove={(event) => {
            const current = resize.current;
            if (!current || current.pointerId !== event.pointerId) return;
            current.currentWidth = clampWidth(
              current.startWidth + event.clientX - current.startX,
            );
            setPreferredWidth(current.currentWidth);
          }}
          onPointerUp={endResize}
          onPointerCancel={(event) => endResize(event, true)}
          onLostPointerCapture={(event) => endResize(event, true)}
          onDoubleClick={() => {
            localStorage.removeItem(widthPreference);
            setPreferredWidth(null);
          }}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowLeft"
                ? width - (event.shiftKey ? 32 : 8)
                : event.key === "ArrowRight"
                  ? width + (event.shiftKey ? 32 : 8)
                  : event.key === "Home"
                    ? minimumWidth
                    : event.key === "End"
                      ? widthLimit
                      : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            saveWidth(next);
          }}
        />
      </aside>
      {automatic && (
        <button
          type="button"
          className="studio-sidebar-edge"
          aria-label="展开项目导航"
          aria-controls="studio-project-navigation"
          aria-expanded={!hidden}
          tabIndex={hidden ? 0 : -1}
          onPointerEnter={reveal}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => {
            setKeyboardFocus(true);
            setPosition("overlay");
            focusNavigation();
          }}
          onBlur={(event) => {
            if (!sidebar.current?.contains(event.relatedTarget))
              setKeyboardFocus(false);
          }}
          onClick={() => {
            setPosition("overlay");
            focusNavigation();
          }}
        >
          <span aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
