import {
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownToLine,
  Expand,
  FileText,
  GripHorizontal,
  Minus,
  Maximize2,
  MoveUpRight,
  Plus,
  Trash2,
} from "lucide-react";
import { MAX_ZOOM, MIN_ZOOM, type CanvasPlacement } from "./model";
import { useSurfaceViewport } from "./useSurfaceViewport";
import "./surface.css";

export interface SurfaceHandle {
  insertPosition: () => CanvasPlacement;
  reveal: (position: CanvasPlacement) => void;
}

export interface SurfaceItem {
  id: string;
  position: CanvasPlacement;
  content: ReactNode;
}

interface Props {
  children: ReactNode;
  items: SurfaceItem[];
  ref?: Ref<SurfaceHandle>;
  onAdd?: () => void;
  onMove?: (id: string, position: CanvasPlacement) => void;
  onDock?: (id: string) => void;
  onDelete?: (id: string) => void;
  extraActions?: ReactNode;
}

function SurfaceCard({
  item,
  scale,
  onMove,
  onDock,
  onDelete,
}: { item: SurfaceItem; scale: number } & Pick<
  Props,
  "onMove" | "onDock" | "onDelete"
>) {
  const cardRef = useRef<HTMLElement>(null);
  const current = useRef({ item, onMove });
  current.current = { item, onMove };
  const [moving, setMoving] = useState(false);
  const pending = useRef<null | {
    id: number;
    x: number;
    y: number;
    initial: CanvasPlacement;
    next: CanvasPlacement;
    resize: boolean;
  }>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const cancelDrag = () => {
    const drag = pending.current;
    if (!drag) return;
    pending.current = null;
    setMoving(false);
    const position = current.current.item.position;
    const card = cardRef.current!;
    card.style.left = `${position.x}px`;
    card.style.top = `${position.y}px`;
    card.style.width = `${position.width}px`;
    if (handleRef.current?.hasPointerCapture(drag.id))
      handleRef.current.releasePointerCapture(drag.id);
  };
  useEffect(() => {
    window.addEventListener("blur", cancelDrag);
    return () => window.removeEventListener("blur", cancelDrag);
  }, []);

  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    resize = false,
  ) => {
    if (event.button !== 0 || !onMove) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    handleRef.current = event.currentTarget;
    pending.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      initial: item.position,
      next: item.position,
      resize,
    };
    setMoving(true);
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = (event.clientX - drag.x) / scale,
      dy = (event.clientY - drag.y) / scale;
    drag.next = drag.resize
      ? {
          ...drag.initial,
          width: Math.max(240, Math.min(1600, drag.initial.width + dx)),
        }
      : {
          ...drag.initial,
          x: Math.max(-1000000, Math.min(1000000, drag.initial.x + dx)),
          y: Math.max(-1000000, Math.min(1000000, drag.initial.y + dy)),
        };
    const card = cardRef.current!;
    card.style.left = `${drag.next.x}px`;
    card.style.top = `${drag.next.y}px`;
    card.style.width = `${drag.next.width}px`;
  };
  const finish = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) => {
    const drag = pending.current;
    if (!drag || drag.id !== event.pointerId) return;
    pending.current = null;
    setMoving(false);
    // A file refresh during a drag wins; never overwrite it with stale coordinates.
    const latest = current.current.item.position;
    const unchanged =
      latest.x === drag.initial.x &&
      latest.y === drag.initial.y &&
      latest.width === drag.initial.width;
    const position =
      cancelled || !unchanged ? current.current.item.position : drag.next;
    const card = cardRef.current!;
    card.style.left = `${position.x}px`;
    card.style.top = `${position.y}px`;
    card.style.width = `${position.width}px`;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && unchanged) current.current.onMove?.(item.id, position);
  };
  const handlers = {
    onPointerMove: move,
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => finish(event),
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) =>
      finish(event, true),
    onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) =>
      finish(event, true),
  };
  return (
    <section
      ref={cardRef}
      className={`surface-card${moving ? " is-moving" : ""}`}
      data-surface-content
      data-surface-item={item.id}
      style={{
        left: item.position.x,
        top: item.position.y,
        width: item.position.width,
      }}
      aria-label="画布内容"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && pending.current) {
          event.preventDefault();
          event.stopPropagation();
          cancelDrag();
        }
      }}
    >
      <div className="surface-card-bar" data-surface-ui>
        {onMove ? (
          <button
            className="surface-card-grip"
            data-surface-handle
            aria-label="移动画布内容"
            title="拖动移动；方向键微调，Shift 加速"
            onPointerDown={(event) => start(event)}
            {...handlers}
            onKeyDown={(event) => {
              const deltas: Record<string, [number, number]> = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              };
              const delta = deltas[event.key];
              if (delta) {
                event.preventDefault();
                event.stopPropagation();
                const step = event.shiftKey ? 50 : 10;
                onMove(item.id, {
                  ...item.position,
                  x: Math.max(
                    -1000000,
                    Math.min(1000000, item.position.x + delta[0] * step),
                  ),
                  y: Math.max(
                    -1000000,
                    Math.min(1000000, item.position.y + delta[1] * step),
                  ),
                });
              }
            }}
          >
            <GripHorizontal size={16} />
            <span>画布内容</span>
          </button>
        ) : (
          <span>画布内容</span>
        )}
        {onDock && (
          <button
            aria-label="收回正文"
            title="将内容移到正文末尾"
            onClick={() => onDock(item.id)}
          >
            <ArrowDownToLine size={15} />
          </button>
        )}
        {onDelete && (
          <button
            aria-label="删除画布内容"
            title="删除画布内容"
            onClick={() => onDelete(item.id)}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="surface-card-content">{item.content}</div>
      {onMove && (
        <button
          className="surface-card-resize"
          data-surface-handle
          aria-label="调整画布内容宽度"
          title="拖动调整宽度；左右方向键微调"
          onPointerDown={(event) => start(event, true)}
          {...handlers}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            onMove(item.id, {
              ...item.position,
              width: Math.max(
                240,
                Math.min(
                  1600,
                  item.position.width +
                    (event.key === "ArrowLeft" ? -1 : 1) *
                      (event.shiftKey ? 100 : 20),
                ),
              ),
            });
          }}
        >
          <MoveUpRight size={13} />
        </button>
      )}
    </section>
  );
}

/** The editor DOM stays mounted when its viewport changes between scroll and pan. */
export default function PageSurface({
  children,
  items,
  ref,
  onAdd,
  onMove,
  onDock,
  onDelete,
  extraActions,
}: Props) {
  const viewport = useSurfaceViewport(items.length > 0);
  const {
    rootRef,
    scrollRef,
    worldRef,
    documentRef,
    mode,
    scale,
    camera,
    controls,
  } = viewport;
  const reveal = (position: CanvasPlacement) => {
    controls.current.enter();
    const root = rootRef.current!,
      world = worldRef.current!;
    const left = (scrollRef.current!.clientWidth - world.offsetWidth) / 2;
    camera.current = {
      x:
        root.clientWidth / 2 -
        left -
        (position.x + position.width / 2) * camera.current.scale,
      y: root.clientHeight * 0.25 - position.y * camera.current.scale,
      scale: camera.current.scale,
    };
    controls.current.paint();
  };
  const fit = () => {
    controls.current.enter();
    const root = rootRef.current!,
      world = worldRef.current!,
      body = documentRef.current!;
    const cards = [...world.querySelectorAll<HTMLElement>(".surface-card")];
    const minX = Math.min(0, ...items.map((item) => item.position.x));
    const minY = Math.min(0, ...items.map((item) => item.position.y));
    const maxX = Math.max(
      world.offsetWidth,
      ...items.map((item) => item.position.x + item.position.width),
    );
    const maxY = Math.max(
      body.offsetHeight,
      ...items.map(
        (item, index) => item.position.y + (cards[index]?.offsetHeight ?? 160),
      ),
    );
    const scale = Math.max(
      MIN_ZOOM,
      Math.min(
        1,
        (root.clientWidth - 80) / (maxX - minX),
        (root.clientHeight - 140) / (maxY - minY),
      ),
    );
    const left = (scrollRef.current!.clientWidth - world.offsetWidth) / 2;
    camera.current = {
      x: root.clientWidth / 2 - left - ((minX + maxX) / 2) * scale,
      y: 48 - minY * scale,
      scale,
    };
    controls.current.paint();
  };
  useImperativeHandle(ref, () => ({
    insertPosition: () => {
      const root = rootRef.current!,
        world = worldRef.current!;
      const left = (scrollRef.current!.clientWidth - world.offsetWidth) / 2;
      const c = camera.current;
      let x = (root.clientWidth / 2 - left - c.x) / c.scale - 180;
      if (x > -400 && x < world.offsetWidth + 40)
        x = world.offsetWidth + 64 + (items.length % 4) * 32;
      return {
        x,
        y:
          mode === "document"
            ? scrollRef.current!.scrollTop + 64
            : (root.clientHeight * 0.25 - c.y) / c.scale,
        width: 360,
      };
    },
    reveal,
  }));
  return (
    <div
      ref={rootRef}
      className="page-surface"
      data-mode={mode}
      tabIndex={0}
      role="region"
      aria-label="页面工作区"
      aria-description="正文可上下滚动。持续横向滑动可展开画布，也可使用下方按钮。画布空白处可拖动，方向键可平移，Escape 回到正文。"
    >
      <div className="surface-grid" aria-hidden="true" />
      <div ref={scrollRef} className="surface-scroll">
        <div ref={worldRef} className="surface-world">
          <div
            ref={documentRef}
            className="surface-document"
            data-surface-content
          >
            {children}
          </div>
          {items.map((item) => (
            <SurfaceCard
              key={item.id}
              item={item}
              scale={scale}
              onMove={onMove}
              onDock={onDock}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
      <div className="surface-resistance" aria-hidden="true">
        <Expand size={15} />
        <span>继续横向滑动，展开画布</span>
      </div>
      <div
        className="surface-toolbar"
        data-surface-ui
        role="group"
        aria-label="页面视图"
      >
        {mode === "document" ? (
          <button onClick={() => controls.current.enter()} title="展开自由画布">
            <Expand size={15} />
            <span>展开画布</span>
          </button>
        ) : (
          <>
            <button
              onClick={() => controls.current.home()}
              title="回到正文位置（Escape）"
            >
              <FileText size={15} />
              <span>回到正文</span>
            </button>
            <span className="surface-toolbar-divider" />
            <button
              aria-label="缩小画布"
              disabled={scale <= MIN_ZOOM}
              onClick={() => controls.current.zoom(scale / 1.2)}
            >
              <Minus size={15} />
            </button>
            <button
              className="surface-zoom"
              aria-label="重置画布缩放"
              title="重置为 100%"
              onClick={() => controls.current.zoom(1)}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              aria-label="放大画布"
              disabled={scale >= MAX_ZOOM}
              onClick={() => controls.current.zoom(scale * 1.2)}
            >
              <Plus size={15} />
            </button>
            <button
              aria-label="总览画布内容"
              title="总览画布内容"
              onClick={fit}
            >
              <Maximize2 size={15} />
            </button>
            {onAdd && (
              <>
                <span className="surface-toolbar-divider" />
                <button onClick={onAdd}>
                  <Plus size={15} />
                  <span>添加内容</span>
                </button>
              </>
            )}
          </>
        )}
        {extraActions}
      </div>
      {mode === "canvas" && (
        <div className="surface-orientation" data-surface-ui>
          <span>
            {items.length ? `${items.length} 个画布内容` : "自由画布"}
          </span>
          {items.length > 0 && (
            <button onClick={() => reveal(items[0].position)}>定位内容</button>
          )}
          <span className="surface-gesture-help">
            拖动空白处 · 双指平移与缩放
          </span>
        </div>
      )}
      <span className="surface-sr-only" role="status" aria-live="polite">
        {mode === "canvas" ? "已展开自由画布" : "文档模式"}
      </span>
    </div>
  );
}
