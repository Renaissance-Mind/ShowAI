import type { PageWidthMode } from "./types";
import "./page-width.css";

const modes = ["standard", "wide", "full"] as const;
const labels = ["标准", "更宽", "全宽"] as const;

export function PageWidthSwitch({
  value,
  onChange,
}: {
  value: PageWidthMode;
  onChange: (mode: PageWidthMode) => void;
}) {
  const position = modes.indexOf(value);
  return (
    <div className="page-width-switch">
      <span
        className="page-width-switch-thumb"
        style={{ transform: `translateX(${position * 100}%)` }}
        aria-hidden="true"
      />
      <div className="page-width-switch-labels" aria-hidden="true">
        {labels.map((label, index) => (
          <span key={label} data-active={index === position}>
            {label}
          </span>
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={2}
        step={1}
        value={position}
        aria-label="页面宽度"
        aria-valuetext={labels[position]}
        onChange={(event) => onChange(modes[Number(event.target.value)])}
        onKeyDown={(event) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
            ].includes(event.key)
          )
            event.stopPropagation();
        }}
      />
    </div>
  );
}
