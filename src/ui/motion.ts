/**
 * Motion values shared by the workbench's script-driven animations. Durations
 * and curves come from the tokens in design/tokens.css, so CSS and scripts
 * keep one scale.
 */

export type MotionToken =
  | "--duration-fast"
  | "--duration-base"
  | "--duration-slow"
  | "--ease-out"
  | "--ease-in-out";

const fallback: Record<MotionToken, string> = {
  "--duration-fast": "140ms",
  "--duration-base": "200ms",
  "--duration-slow": "320ms",
  "--ease-out": "cubic-bezier(0.23, 1, 0.32, 1)",
  "--ease-in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
};

/** Milliseconds for a CSS time such as `140ms` or `0.2s`. */
export function parseDuration(value: string): number {
  const text = value.trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return 0;
  return text.endsWith("ms") ? number : number * 1000;
}

export function motionToken(token: MotionToken, element?: Element): string {
  const target = element ?? document.documentElement;
  const value = getComputedStyle(target).getPropertyValue(token).trim();
  return value || fallback[token];
}

export function motionDuration(
  token: Extract<MotionToken, `--duration-${string}`>,
  element?: Element,
) {
  return parseDuration(motionToken(token, element));
}

export function prefersReducedMotion(view: Window = window) {
  return view.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How an overlay leaves: the reverse of the way it entered, and shorter. */
export type ExitStyle = "fade" | "pop" | "drop" | "rise";

export function exitKeyframes(style: ExitStyle): Keyframe[] {
  switch (style) {
    case "fade":
      return [{ opacity: 1 }, { opacity: 0 }];
    case "pop":
      return [
        { opacity: 1, scale: "1" },
        { opacity: 0, scale: "0.96" },
      ];
    case "drop":
      return [
        { opacity: 1, translate: "0 0" },
        { opacity: 0, translate: "0 -4px" },
      ];
    case "rise":
      return [
        { opacity: 1, translate: "0 0" },
        { opacity: 0, translate: "0 4px" },
      ];
  }
}
