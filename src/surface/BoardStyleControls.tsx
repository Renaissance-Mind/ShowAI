import type { JSONContent } from "@tiptap/core";
import type { BoardTool, DrawingStyle } from "./types";

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
        <input
          type="number"
          aria-label={filled ? "边框粗细" : "画笔粗细"}
          min={0.5}
          max={40}
          step={0.5}
          placeholder="混合"
          value={width ?? ""}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (next >= 0.5 && next <= 40) onChange({ strokeWidth: next });
          }}
        />
      </label>
    </div>
  );
}
