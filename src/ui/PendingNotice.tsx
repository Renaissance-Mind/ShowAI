import type { CSSProperties, Ref } from "react";
import { useDelayedFlag } from "./delayed-flag";
import "./pending.css";

export function PendingNotice({
  label,
  active = true,
  minHeight,
  lines = 0,
  overlay = false,
  className = "",
  style,
  ...rest
}: {
  label: string;
  active?: boolean;
  minHeight?: number;
  lines?: number;
  overlay?: boolean;
  className?: string;
  style?: CSSProperties;
  "data-preview-pending"?: "true";
  ref?: Ref<HTMLDivElement>;
}) {
  const visible = useDelayedFlag(active);
  if (!active) return null;
  const notice = (
    <div
      {...rest}
      className={`showai-pending${overlay ? " is-overlay" : ""}${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
      style={
        minHeight
          ? { [overlay ? "height" : "minHeight"]: minHeight, ...style }
          : style
      }
    >
      {visible && (
        <>
          <span className="showai-pending-label">{label}</span>
          {Array.from({ length: lines }, (_, index) => (
            <span key={index} className="showai-pending-bar" aria-hidden="true" />
          ))}
        </>
      )}
    </div>
  );
  return overlay ? <div className="showai-pending-anchor">{notice}</div> : notice;
}
