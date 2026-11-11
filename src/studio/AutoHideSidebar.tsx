import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, LocateFixed, PanelLeft } from "../ui/icons";
import { appIconForTheme } from "../design/app-icon";
import { useAppearanceTheme } from "../design/useAppearanceTheme";
import { useTranslator } from "../i18n/react";
import sidebarMessages from "../i18n/messages/sidebar";
import navigationMessages from "../i18n/messages/navigation";
import {
  clientIsMac,
  formatShortcut,
  isSidebarToggleShortcut,
} from "./keyboard-shortcuts";
import { locateHoldDuration } from "./sidebar-locate";
import "./auto-hide-sidebar.css";
import { mobileNavigationLayout, sidebarSwipe } from "./mobile-navigation.mjs";
import "./mobile-navigation.css";

/** Toggles the sidebar as the ⌘\ shortcut does. */
export const SIDEBAR_TOGGLE_EVENT = "showai:toggle-sidebar";
const minimumWidth = 200;
const maximumWidth = 480;
const widthPreference = "showai:sidebar-width";
const lockedPreference = "showai:sidebar-locked";

/**
 * The sidebar stays pinned unless the person unpins it; an unpinned sidebar
 * hides while a page is open and edge reveals float over the document.
 */
export default function AutoHideSidebar({
  enabled,
  interactionHeld,
  children,
  navigation,
  history,
  canLocate,
  onLocate,
  topbar,
  switchingTab,
  mobileBoardKey,
  onMobileBack,
  compactOverlay = false,
}: {
  enabled: boolean;
  interactionHeld: boolean;
  children: ReactNode;
  navigation: ReactNode;
  history: ReactNode;
  /** Enabled while a page is shown; reveals its row in the navigation. */
  canLocate: boolean;
  onLocate: () => void;
  topbar: ReactNode;
  switchingTab: boolean;
  mobileBoardKey?: string;
  onMobileBack?: () => void;
  /** Keep settings forms usable in narrow browser/desktop windows. */
  compactOverlay?: boolean;
}) {
  const t = useTranslator(sidebarMessages);
  const tn = useTranslator(navigationMessages);
  const toggleKeys = formatShortcut("Mod+\\", clientIsMac());
  // Keeps an automatically hidden sidebar in view while the located row flashes.
  const [locating, setLocating] = useState(false);
  const appIcon = appIconForTheme(useAppearanceTheme());
  const nativeTouch = document.documentElement.dataset.native === "ios";
  const [nativeOpen, setNativeOpen] = useState(false);
  const [locked, setLocked] = useState(
    () => localStorage.getItem(lockedPreference) !== "false",
  );
  const [position, setPosition] = useState<"docked" | "hidden" | "overlay">(
    "docked",
  );
  const [hovered, setHovered] = useState(false);
  // Hiding reflows the document; never do it under an ongoing drag.
  const [pressed, setPressed] = useState(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() => {
    const saved = localStorage.getItem(widthPreference);
    const value = saved === null ? NaN : Number(saved);
    return Number.isFinite(value)
      ? Math.max(minimumWidth, Math.min(maximumWidth, value))
      : null;
  });
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [viewportOrientation, setViewportOrientation] = useState(
    document.documentElement.dataset.nativeOrientation,
  );
  const nativeLayout = mobileNavigationLayout(
    document.documentElement.dataset.nativeDevice,
    viewportWidth,
    viewportHeight,
    viewportOrientation,
    !!mobileBoardKey,
  );
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
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
  const width = nativeTouch
    ? nativeLayout.width
    : clampWidth(preferredWidth ?? (viewportWidth <= 1100 ? 208 : 240));
  const sidebar = useRef<HTMLElement>(null);
  const compact = compactOverlay && !nativeTouch && viewportWidth < 720;
  const automatic = enabled && !locked && !nativeTouch;
  const mode = nativeTouch
    ? nativeLayout.docked
      ? "docked"
      : nativeOpen
        ? "overlay"
        : "hidden"
    : compact
      ? nativeOpen
        ? "overlay"
        : "hidden"
      : automatic
        ? position
        : "docked";
  const hidden = mode === "hidden";

  const pointerIsInside = (point: { x: number; y: number }) => {
    const bounds = sidebar.current?.parentElement?.getBoundingClientRect();
    return (
      !!bounds &&
      point.x >= bounds.left &&
      point.x <= bounds.left + width + 4 &&
      point.y >= bounds.top - 44 &&
      point.y <= bounds.bottom
    );
  };
  const leave = (event: { clientX: number; clientY: number }) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    // Hiding the edge trigger or moving the panel can cause a DOM leave event
    // while the pointer is still inside the navigation's destination bounds.
    setHovered(pointerIsInside(pointer.current));
  };

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer.current = { x: event.clientX, y: event.clientY };
      if (automatic && !hidden) setHovered(pointerIsInside(pointer.current));
    };
    const exit = () => {
      pointer.current = null;
      setHovered(false);
      setPressed(false);
    };
    const press = (event: globalThis.PointerEvent) =>
      event.pointerType !== "touch" && setPressed(true);
    const release = () => setPressed(false);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerleave", leave);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", exit);
    return () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerleave", leave);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", exit);
    };
  }, [automatic, hidden, width]);

  useEffect(() => {
    setPosition("docked");
    if (nativeTouch || compact) setNativeOpen(false);
  }, [enabled, locked, mobileBoardKey, compact]);

  const toggleLocked = () =>
    setLocked((current) => {
      localStorage.setItem(lockedPreference, String(!current));
      return !current;
    });
  useEffect(() => {
    if (nativeTouch) return;
    const toggle = () => {
      if (compact) setNativeOpen((value) => !value);
      else toggleLocked();
    };
    const key = (event: KeyboardEvent) => {
      if (!isSidebarToggleShortcut(event) || event.repeat) return;
      event.preventDefault();
      toggle();
    };
    // Quick jump runs the same toggle as the shortcut.
    window.addEventListener("keydown", key);
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, toggle);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener(SIDEBAR_TOGGLE_EVENT, toggle);
    };
  }, [nativeTouch, compact]);
  useEffect(() => {
    if (!locating) return;
    const timer = window.setTimeout(
      () => setLocating(false),
      locateHoldDuration,
    );
    return () => window.clearTimeout(timer);
  }, [locating]);

  useEffect(() => {
    const update = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
      setViewportOrientation(
        document.documentElement.dataset.nativeOrientation,
      );
    };
    window.addEventListener("resize", update);
    window.addEventListener("showai-native-layout", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("showai-native-layout", update);
    };
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
      pressed ||
      locating ||
      hidden ||
      resizing
    )
      return;
    // A short grace period bridges the edge, menus and quick pointer crossings.
    const timer = window.setTimeout(() => {
      if (pointer.current && pointerIsInside(pointer.current)) {
        setHovered(true);
        return;
      }
      setPosition("hidden");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    automatic,
    hovered,
    keyboardFocus,
    interactionHeld,
    pressed,
    locating,
    hidden,
    resizing,
    width,
  ]);

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

  const reveal = (event: PointerEvent<HTMLElement>) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    setHovered(true);
    if (hidden) setPosition("overlay");
  };
  const lockLabel =
    nativeTouch || compact
      ? nativeOpen
        ? t("collapseSidebar")
        : t("expandSidebar")
      : tn("withShortcut", {
          label: locked ? tn("autoHideSidebar") : tn("pinSidebar"),
          keys: toggleKeys,
        });
  const locateLabel = tn("locateInSidebar");
  const focusNavigation = () => {
    window.requestAnimationFrame(() => {
      sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
      setKeyboardFocus(true);
    });
  };

  if (nativeTouch)
    return (
      <div
        className="studio-workspace"
        data-mobile-sidebar={mode}
        data-mobile-board={!!mobileBoardKey || undefined}
        inert={switchingTab}
        aria-busy={switchingTab}
      >
        {!nativeLayout.docked && (
          <div className="studio-mobile-navigation-tools">
            {mobileBoardKey ? (
              <button
                type="button"
                aria-label={t("back")}
                onClick={onMobileBack}
              >
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={t("projectNavigation")}
                  aria-controls="studio-project-navigation"
                  aria-expanded={nativeOpen}
                  onClick={() => setNativeOpen((value) => !value)}
                >
                  <PanelLeft size={20} aria-hidden="true" />
                </button>
                {history}
              </>
            )}
          </div>
        )}
        <div
          className="studio-sidebar-shell"
          data-sidebar-mode={mode}
          style={{ "--navigation-width": `${width}px` } as CSSProperties}
        >
          <aside
            ref={sidebar}
            id="studio-project-navigation"
            className="studio-sidebar"
            aria-label={t("projectNavigation")}
            inert={hidden}
            onKeyDown={(event) => {
              if (event.key === "Escape") setNativeOpen(false);
            }}
            onClickCapture={(event) => {
              if (
                !nativeLayout.docked &&
                (event.target as Element).closest(".studio-tree-main")
              )
                setNativeOpen(false);
            }}
          >
            <div className="studio-mobile-sidebar-brand">
              <img src={appIcon} alt="" />
              <strong>ShowAI</strong>
            </div>
            {navigation}
          </aside>
        </div>
        {nativeOpen && !nativeLayout.docked && (
          <button
            className="studio-mobile-sidebar-scrim"
            aria-label={t("closeNavigation")}
            onClick={() => setNativeOpen(false)}
          />
        )}
        {children}
        {!nativeLayout.docked && !nativeOpen && (
          <div
            className="studio-mobile-sidebar-edge"
            aria-hidden="true"
            onPointerDown={(event) => {
              if (event.pointerType !== "touch") return;
              swipe.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = swipe.current;
              if (
                start?.id === event.pointerId &&
                sidebarSwipe(start, { x: event.clientX, y: event.clientY })
              ) {
                setNativeOpen(true);
                swipe.current = null;
              }
            }}
            onPointerUp={() => {
              swipe.current = null;
            }}
            onPointerCancel={() => {
              swipe.current = null;
            }}
          />
        )}
      </div>
    );

  return (
    <>
      <header className="studio-window-topbar">
        <div
          className="studio-topbar-brand"
          style={
            {
              width: nativeTouch && viewportWidth <= 650 ? 56 : width,
            } as CSSProperties
          }
          onPointerEnter={reveal}
          onPointerLeave={leave}
        >
          <span className="studio-app-brand">
            <img src={appIcon} alt="" draggable={false} />
            <strong>ShowAI</strong>
          </span>
          <div className="studio-topbar-actions">
            {history}
            <button
              type="button"
              className="studio-sidebar-locate"
              aria-label={locateLabel}
              title={locateLabel}
              disabled={!canLocate}
              onClick={() => {
                if (hidden) setPosition("overlay");
                setLocating(true);
                onLocate();
              }}
            >
              <LocateFixed size={17} strokeWidth={1.7} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="studio-sidebar-lock"
              aria-label={lockLabel}
              title={lockLabel}
              aria-pressed={nativeTouch || compact ? nativeOpen : locked}
              aria-controls="studio-project-navigation"
              aria-expanded={nativeTouch || compact ? nativeOpen : !hidden}
              onPointerDown={
                nativeTouch
                  ? (event) => {
                      event.preventDefault();
                      setNativeOpen((value) => !value);
                    }
                  : undefined
              }
              onClick={(event) => {
                if (nativeTouch) {
                  if (event.detail === 0) setNativeOpen((value) => !value);
                  return;
                }
                if (compact) {
                  setNativeOpen((value) => !value);
                  return;
                }
                toggleLocked();
              }}
            >
              <PanelLeft size={19} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
        </div>
        {topbar}
      </header>
      <div
        className="studio-workspace"
        data-compact-sidebar={compact || undefined}
        inert={switchingTab}
        aria-busy={switchingTab}
      >
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
            aria-label={t("projectNavigation")}
            inert={hidden}
            onPointerEnter={reveal}
            onPointerLeave={leave}
            onFocusCapture={(event) => {
              if (event.target.matches(":focus-visible"))
                setKeyboardFocus(true);
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setKeyboardFocus(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && compact) {
                event.preventDefault();
                setNativeOpen(false);
                document
                  .querySelector<HTMLButtonElement>(".studio-sidebar-lock")
                  ?.focus();
                return;
              }
              if (event.key !== "Escape" || !automatic || interactionHeld)
                return;
              event.preventDefault();
              event.stopPropagation();
              if (document.activeElement instanceof HTMLElement)
                document.activeElement.blur();
              setKeyboardFocus(false);
              setHovered(false);
              setPosition("hidden");
            }}
          >
            {navigation}
            <div
              ref={resizeHandle}
              className="studio-sidebar-resizer"
              role="separator"
              tabIndex={0}
              aria-label={t("resizeSidebar")}
              aria-orientation="vertical"
              aria-controls="studio-project-navigation"
              aria-valuemin={minimumWidth}
              aria-valuemax={widthLimit}
              aria-valuenow={width}
              aria-valuetext={t("widthPixels", { width })}
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
              aria-label={t("showNavigation")}
              aria-controls="studio-project-navigation"
              aria-expanded={!hidden}
              tabIndex={hidden ? 0 : -1}
              onPointerEnter={reveal}
              onPointerLeave={leave}
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
        {compact && nativeOpen && (
          <button
            type="button"
            className="studio-mobile-sidebar-scrim"
            aria-label={t("closeNavigation")}
            onClick={() => setNativeOpen(false)}
          />
        )}
        {children}
      </div>
    </>
  );
}
