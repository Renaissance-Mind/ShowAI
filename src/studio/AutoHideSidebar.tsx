import { useEffect, useRef, useState, type ReactNode } from "react";
import { LockKeyhole, LockKeyholeOpen } from "../ui/icons";
import "./auto-hide-sidebar.css";

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
  const sidebar = useRef<HTMLElement>(null);
  const automatic = enabled && !locked;
  const mode = automatic ? position : "docked";
  const hidden = mode === "hidden";

  useEffect(() => {
    setPosition("docked");
  }, [enabled, locked]);

  useEffect(() => {
    if (!automatic || hovered || keyboardFocus || interactionHeld || hidden)
      return;
    // A short grace period bridges the edge, menus and quick pointer crossings.
    const timer = window.setTimeout(() => setPosition("hidden"), 300);
    return () => window.clearTimeout(timer);
  }, [automatic, hovered, keyboardFocus, interactionHeld, hidden]);

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
    <div className="studio-sidebar-shell" data-sidebar-mode={mode}>
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
