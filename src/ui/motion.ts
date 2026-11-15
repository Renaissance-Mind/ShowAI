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

export interface RowBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface RowMotionPlan {
  moves: { key: string; dx: number; dy: number }[];
  enters: string[];
  exits: string[];
}

export const ROW_MOTION_LIMIT = 200;

export function planRowMotion(
  before: ReadonlyMap<string, RowBox>,
  after: ReadonlyMap<string, RowBox>,
  view: { top: number; bottom: number },
  limit = ROW_MOTION_LIMIT,
): RowMotionPlan | null {
  const visible = (box: RowBox | undefined) =>
    !!box && box.top + box.height > view.top && box.top < view.bottom;
  const moves: RowMotionPlan["moves"] = [];
  const enters: string[] = [];
  const exits: string[] = [];
  let changed = 0;
  for (const [key, next] of after) {
    const old = before.get(key);
    if (!old) {
      changed++;
      if (visible(next)) enters.push(key);
      continue;
    }
    const dx = old.left - next.left;
    const dy = old.top - next.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    changed++;
    if (visible(old) || visible(next)) moves.push({ key, dx, dy });
  }
  for (const [key, old] of before) {
    if (after.has(key)) continue;
    changed++;
    if (visible(old)) exits.push(key);
  }
  if (changed > limit) return null;
  if (!moves.length && !enters.length && !exits.length) return null;
  return { moves, enters, exits };
}
