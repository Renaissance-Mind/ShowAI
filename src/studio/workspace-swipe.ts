import { GESTURE_IDLE } from "../surface/model";

export { GESTURE_IDLE as SWIPE_IDLE };
const INTENT_DISTANCE = 8;
const NAVIGATION_DISTANCE = 150;

export interface SwipeInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
}

export interface SwipePreview {
  direction: -1 | 1;
  progress: number;
  committed: boolean;
}

/** The first recipient keeps the complete wheel burst, including momentum. */
export class WorkspaceSwipe {
  private lastWheel = -Infinity;
  private owner: "pending" | "content" | "history" = "pending";
  private x = 0;
  private y = 0;
  private direction: -1 | 1 = -1;
  private distance = 0;
  committed = false;

  cancel() {
    if (!this.committed) this.owner = "content";
  }

  push(
    input: SwipeInput,
    now: number,
    {
      blocked,
      canBack,
      canForward,
    }: {
      blocked: boolean;
      canBack: boolean;
      canForward: boolean;
    },
  ): { owned: boolean; preview?: SwipePreview; navigate?: -1 | 1 } {
    if (now - this.lastWheel > GESTURE_IDLE) {
      this.owner = "pending";
      this.x = this.y = this.distance = 0;
      this.committed = false;
    }
    this.lastWheel = now;
    if (this.committed) return { owned: true };
    if (
      blocked ||
      input.defaultPrevented ||
      input.deltaMode !== 0 ||
      input.ctrlKey ||
      input.metaKey ||
      input.altKey ||
      input.shiftKey
    )
      this.owner = "content";
    if (this.owner === "content") return { owned: false };

    if (this.owner === "pending") {
      this.x += input.deltaX;
      this.y += input.deltaY;
      if (Math.max(Math.abs(this.x), Math.abs(this.y)) < INTENT_DISTANCE)
        return { owned: false };
      if (Math.abs(this.x) < Math.abs(this.y) * 1.5) {
        this.owner = "content";
        return { owned: false };
      }
      this.direction = this.x < 0 ? -1 : 1;
      this.distance = Math.abs(this.x);
      this.owner = "history";
    } else {
      this.distance = Math.max(
        0,
        this.distance + input.deltaX * this.direction,
      );
    }
    if (this.direction < 0 ? !canBack : !canForward) {
      this.owner = "content";
      return { owned: false };
    }
    this.committed = this.distance >= NAVIGATION_DISTANCE;
    return {
      owned: true,
      preview: {
        direction: this.direction,
        progress: Math.min(1, this.distance / NAVIGATION_DISTANCE),
        committed: this.committed,
      },
      ...(this.committed ? { navigate: this.direction } : {}),
    };
  }
}

/** Even a scroller at its edge keeps its gesture; it must never leave a Page. */
export function ownsHorizontalSwipe(event: WheelEvent, root: HTMLElement) {
  const path = event.composedPath();
  if (!path.includes(root)) return true;
  for (const target of path) {
    if (target === root) break;
    if (!(target instanceof Element)) continue;
    if (
      target.matches(
        '.page-surface[data-input-surface],.react-flow,iframe,input,textarea,select,[contenteditable="true"],[role="slider"],[role="dialog"],[role="menu"],[data-editor-keyboard-scope]',
      )
    )
      return true;
    const axes = target.getAttribute("data-surface-gesture")?.split(/\s+/);
    if (axes?.includes("own") || axes?.includes("x")) return true;
    const style = getComputedStyle(target);
    if (
      /auto|scroll/.test(style.overflowX) &&
      target.scrollWidth > target.clientWidth + 1
    )
      return true;
  }
  return false;
}
