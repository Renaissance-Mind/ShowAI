import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useReaderStateScope } from "../../surface/reader-state";

const BATCH = 3;
const VIEW_MARGIN = 200;
const HEIGHT_SLOT = "layout.height";

function distanceFromView(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  if (!box.width && !box.height) return Infinity;
  if (box.bottom < 0) return -box.bottom;
  if (box.top > window.innerHeight) return box.top - window.innerHeight;
  return 0;
}

export class MountQueue {
  private waiting = new Map<HTMLElement, () => void>();
  private rendering = new Set<HTMLElement>();
  private timer = 0;
  request(element: HTMLElement, mount: () => void) {
    this.waiting.set(element, mount);
    this.schedule();
    return () => {
      this.waiting.delete(element);
      if (this.rendering.delete(element) && !this.rendering.size)
        this.schedule();
    };
  }
  flush() {
    const mounts = [...this.waiting.values()];
    this.waiting.clear();
    flushSync(() => mounts.forEach((mount) => mount()));
  }
  dispose() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.waiting.clear();
    this.rendering.clear();
  }
  private schedule() {
    if (!this.timer && !this.rendering.size && this.waiting.size)
      this.timer = window.setTimeout(this.run, 0);
  }
  private run = () => {
    this.timer = 0;
    const order = [...this.waiting.keys()];
    const near = order.filter(
      (element) => distanceFromView(element) <= window.innerHeight,
    );
    const batch = [...new Set([...near, ...order])].slice(0, BATCH);
    const mounts = batch.map((element) => this.waiting.get(element)!);
    for (const element of batch) {
      this.waiting.delete(element);
      this.rendering.add(element);
    }
    startTransition(() => mounts.forEach((mount) => mount()));
  };
}

export const MountQueueContext = createContext<MountQueue | null>(null);

export function useQueuedMount() {
  const queue = useContext(MountQueueContext);
  const reader = useReaderStateScope();
  const [mounted, setMounted] = useState(!queue);
  const placeholder = useRef<HTMLDivElement>(null);
  const measured = useRef<{
    parent: HTMLElement;
    chrome: number;
    baseline: number;
  } | null>(null);
  useLayoutEffect(() => {
    const element = placeholder.current;
    if (mounted || !queue || !element) return;
    const parent = element.parentElement;
    if (parent) {
      const baseline = parent.offsetHeight;
      measured.current = {
        parent,
        baseline,
        chrome: baseline - element.offsetHeight,
      };
    }
    if (distanceFromView(element) <= VIEW_MARGIN) {
      setMounted(true);
      return;
    }
    return queue.request(element, () => setMounted(true));
  }, [mounted, queue]);
  useLayoutEffect(() => {
    const target = measured.current;
    if (!mounted || !target?.parent.isConnected) return;
    const scroller = target.parent.closest<HTMLElement>(".container-page");
    if (!scroller || scroller.dataset.restoringScroll) return;
    const top = target.parent.getBoundingClientRect().top;
    if (top + target.baseline <= scroller.getBoundingClientRect().top)
      scroller.scrollTop += target.parent.offsetHeight - target.baseline;
  }, [mounted]);
  useEffect(() => {
    const target = measured.current;
    if (!mounted || !target || !reader?.block) return;
    const { store, page, block } = reader;
    const observer = new ResizeObserver(() => {
      const height = target.parent.offsetHeight - target.chrome;
      if (target.parent.offsetHeight && height > 0)
        store.write(page, block, HEIGHT_SLOT, Math.round(height));
    });
    observer.observe(target.parent);
    return () => observer.disconnect();
  }, [mounted, reader]);
  const saved = reader?.block
    ? reader.store.read(reader.page, reader.block, HEIGHT_SLOT)
    : undefined;
  return {
    mounted,
    placeholder,
    height: typeof saved === "number" && saved > 0 ? saved : undefined,
  };
}
