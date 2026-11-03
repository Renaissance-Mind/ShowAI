import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/sidebar";
import { ArrowLeft, ArrowRight } from "../ui/icons";
import {
  ownsHorizontalSwipe,
  SWIPE_IDLE,
  WorkspaceSwipe,
  type SwipePreview,
} from "./workspace-swipe";
import "./workspace-swipe.css";

export function WorkspaceSwipeNavigation({
  rootRef,
  busy,
  canBack,
  canForward,
  locationKey,
  onStep,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  canBack: boolean;
  canForward: boolean;
  locationKey: string;
  onStep: (offset: number) => void;
}) {
  const t = useTranslator(messages);
  const machine = useRef(new WorkspaceSwipe());
  const latest = useRef({ busy, canBack, canForward, onStep });
  latest.current = { busy, canBack, canForward, onStep };
  const [preview, setPreview] = useState<SwipePreview | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dismiss = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Ordinary scrolling must not schedule renders: only a visible preview does.
  const shown = useRef(false);
  const show = (next: SwipePreview | null) => {
    shown.current = next !== null;
    setPreview(next);
  };

  useEffect(() => {
    if (!machine.current.committed) {
      machine.current.cancel();
      show(null);
    }
  }, [locationKey, busy]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const handled = new WeakSet<WheelEvent>();
    const observations = new Set<ReturnType<typeof setTimeout>>();
    const hide = () => {
      setLeaving(true);
      clearTimeout(dismiss.current);
      dismiss.current = setTimeout(() => show(null), 180);
    };
    const cancel = () => {
      machine.current.cancel();
      if (shown.current) show(null);
    };
    const observe = (event: WheelEvent) => {
      const now = performance.now();
      if (machine.current.settled(now)) return;
      // A child may stop propagation instead of preventDefault. Remember that
      // recipient too, before a later momentum event reaches another element.
      const observation = setTimeout(() => {
        observations.delete(observation);
        if (handled.has(event)) return;
        machine.current.push(event, now, { ...latest.current, blocked: true });
        if (shown.current) show(null);
      }, 0);
      observations.add(observation);
    };
    // Bubble on window: native and React component handlers have first refusal.
    // The listener is passive so the compositor never waits for it to scroll.
    const wheel = (event: WheelEvent) => {
      handled.add(event);
      const current = latest.current;
      const result = machine.current.push(event, performance.now(), {
        ...current,
        blocked: current.busy || event.defaultPrevented,
        contentOwns: () => ownsHorizontalSwipe(event, root),
      });
      if (result.preview) {
        clearTimeout(dismiss.current);
        setLeaving(false);
        show(result.preview);
      } else if (!result.owned && shown.current) show(null);
      if (shown.current) {
        clearTimeout(idle);
        idle = setTimeout(hide, SWIPE_IDLE);
      }
      if (result.navigate) current.onStep(result.navigate);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("wheel", observe, { capture: true, passive: true });
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    window.addEventListener("pointerdown", cancel);
    return () => {
      clearTimeout(idle);
      clearTimeout(dismiss.current);
      observations.forEach(clearTimeout);
      window.removeEventListener("wheel", observe, true);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointerdown", cancel);
    };
  }, [rootRef]);

  if (!preview) return null;
  return (
    <div
      className="studio-history-swipe"
      data-direction={preview.direction < 0 ? "back" : "forward"}
      data-committed={preview.committed || undefined}
      data-leaving={leaving || undefined}
      style={{ "--swipe-progress": preview.progress } as CSSProperties}
      role="status"
      aria-label={t(preview.direction < 0 ? "back" : "forward")}
    >
      {preview.direction < 0 ? (
        <ArrowLeft size={23} />
      ) : (
        <ArrowRight size={23} />
      )}
    </div>
  );
}
