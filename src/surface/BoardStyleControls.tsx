import type { JSONContent } from "@tiptap/core";
import { useState } from "react";
import type { BoardTool, DrawingStyle } from "./types";

function StrokeWidthSlider({
  width,
  label,
  onChange,
}: {
  width: number | undefined;
  label: string;
  onChange: (patch: Partial<DrawingStyle>) => void;
}) {
  const [active, setActive] = useState(false);
  const current = width ?? 2.5;
  const position = ((current - 0.5) / 39.5) * 100;
  return (
    <span className="board-stroke-slider" data-active={active || undefined}>
      <svg
        viewBox="0 0 120 24"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="board-stroke-track"
      >
        <path d="M 8 11.5 L 112 7 Q 117 7 117 12 Q 117 17 112 17 L 8 12.5 Q 7 12 8 11.5 Z" />
      </svg>
      <span className="board-stroke-value-rail" aria-hidden="true">
        <output style={{ left: `${position}%` }}>{current}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={width === undefined ? "混合" : undefined}
        min={0.5}
        max={40}
        step={0.5}
        value={current}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setActive(true);
        }}
        onPointerUp={() => setActive(false)}
        onPointerCancel={() => setActive(false)}
        onLostPointerCapture={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onKeyDown={() => setActive(true)}
        onKeyUp={() => setActive(false)}
        onChange={(event) =>
          onChange({ strokeWidth: event.currentTarget.valueAsNumber })
        }
      />
    </span>
  );
}

export function BoardStyleControls({
  tool,
  style,
  nodes,
  onChange,
}: {
  tool?: BoardTool | null;
  style: DrawingStyle;
  nodes: JSONContent[];
  onChange: (patch: Partial<DrawingStyle>) => void;
}) {
  const drawings = nodes.filter(
    (node) => node.type === "drawing" && !node.attrs?.ink,
  );
  if (!drawings.length && nodes.some((node) => node.attrs?.ink))
    return (
      <span className="board-style-controls">
        手写笔迹 · 在 iPad 上编辑笔迹
      </span>
    );
  if (!drawings.length && (!tool || tool === "region")) return null;
  const value = (key: keyof DrawingStyle) => {
    if (!drawings.length) return style[key];
    const applicable =
      key === "fillColor"
        ? drawings.filter((node) =>
            ["rectangle", "ellipse"].includes(node.attrs!.tool),
          )
        : drawings;
    const values = new Set(
      applicable.map(
        (node) =>
          node.attrs?.[key] ?? (key === "fillColor" ? "none" : style[key]),
      ),
    );
    return values.size === 1 ? [...values][0] : undefined;
  };
  const filled = drawings.length
    ? drawings.some((node) =>
        ["rectangle", "ellipse"].includes(node.attrs!.tool),
      )
    : tool === "rectangle" || tool === "ellipse";
  const color = value("color"),
    fill = value("fillColor"),
    width = value("strokeWidth");
  return (
    <div
      className="board-style-controls"
      role="group"
      aria-label={drawings.length ? "选中对象样式" : "绘制设置"}
    >
      <label title={color === undefined ? "选中对象颜色不同" : undefined}>
        {filled ? "边框" : "颜色"}
        <input
          type="color"
          aria-label={filled ? "边框颜色" : "画笔颜色"}
          value={color ?? "#252629"}
          onInput={(event) => onChange({ color: event.currentTarget.value })}
        />
        {color === undefined && <small>混合</small>}
      </label>
      {filled && (
        <label>
          内部
          <input
            type="color"
            aria-label="内部颜色"
            value={fill && fill !== "none" ? fill : "#ffffff"}
            onInput={(event) =>
              onChange({ fillColor: event.currentTarget.value })
            }
          />
          <button
            type="button"
            aria-label="透明填充"
            aria-pressed={fill === "none"}
            title="透明填充"
            onClick={() => onChange({ fillColor: "none" })}
          >
            空
          </button>
          {fill === undefined && <small>混合</small>}
        </label>
      )}
      <label>
        粗细
        <StrokeWidthSlider
          width={width}
          label={filled ? "边框粗细" : "画笔粗细"}
          onChange={onChange}
        />
        {width === undefined && <small>混合</small>}
      </label>
    </div>
  );
}
