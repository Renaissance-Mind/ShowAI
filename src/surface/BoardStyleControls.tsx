import type { JSONContent } from "@tiptap/core";
import { useState } from "react";
import type { BoardTool, DrawingStyle } from "./types";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";

function StrokeWidthSlider({
  width,
  label,
  onChange,
}: {
  width: number | undefined;
  label: string;
  onChange: (patch: Partial<DrawingStyle>) => void;
}) {
  const t = useTranslator(messages);
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
        aria-valuetext={width === undefined ? t("style.mixed") : undefined}
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
  const t = useTranslator(messages);
  const drawings = nodes.filter(
    (node) => node.type === "drawing" && !node.attrs?.ink,
  );
  if (!drawings.length && nodes.some((node) => node.attrs?.ink))
    return <span className="board-style-controls">{t("style.inkNotice")}</span>;
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
      aria-label={drawings.length ? t("style.selection") : t("style.drawing")}
    >
      <label title={color === undefined ? t("style.colorsDiffer") : undefined}>
        {filled ? t("style.border") : t("style.color")}
        <input
          type="color"
          aria-label={filled ? t("style.borderColor") : t("style.penColor")}
          value={color ?? "#252629"}
          onInput={(event) => onChange({ color: event.currentTarget.value })}
        />
        {color === undefined && <small>{t("style.mixed")}</small>}
      </label>
      {filled && (
        <label>
          {t("style.fill")}
          <input
            type="color"
            aria-label={t("style.fillColor")}
            value={fill && fill !== "none" ? fill : "#ffffff"}
            onInput={(event) =>
              onChange({ fillColor: event.currentTarget.value })
            }
          />
          <button
            type="button"
            aria-label={t("style.transparentFill")}
            aria-pressed={fill === "none"}
            title={t("style.transparentFill")}
            onClick={() => onChange({ fillColor: "none" })}
          >
            {t("style.none")}
          </button>
          {fill === undefined && <small>{t("style.mixed")}</small>}
        </label>
      )}
      <label>
        {t("style.weight")}
        <StrokeWidthSlider
          width={width}
          label={filled ? t("style.borderWeight") : t("style.penWeight")}
          onChange={onChange}
        />
        {width === undefined && <small>{t("style.mixed")}</small>}
      </label>
    </div>
  );
}
