import { useId } from "react";
import {
  portableInkGeometry,
  portableInkColor,
  type PortableInk,
} from "./portable-ink.mjs";

/** Shared brush output; the SVG is editable geometry, never a raster preview. */
export function PortableInkPaths({
  ink,
  color,
  width,
  pressure,
}: {
  ink: PortableInk;
  color: string;
  width?: number;
  pressure?: boolean;
}) {
  const id = useId(),
    geometry = portableInkGeometry(ink, width, pressure);
  return (
    <>
      {geometry.mask && (
        <defs>
          <clipPath id={id} clipPathUnits="userSpaceOnUse">
            <path
              d={geometry.mask}
              transform={`matrix(${ink.transform.join(" ")})`}
            />
          </clipPath>
        </defs>
      )}
      {[false, true].map((dark) => (
        <path
          key={String(dark)}
          className={dark ? "board-ink-dark" : "board-ink-light"}
          data-portable-ink="1"
          d={geometry.path}
          fill={portableInkColor(color, dark)}
          stroke="none"
          opacity={ink.opacity}
          clipPath={geometry.mask ? `url(#${id})` : undefined}
        />
      ))}
    </>
  );
}
