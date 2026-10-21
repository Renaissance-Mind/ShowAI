import type { PortableInkV2 } from "./portable-ink.mjs";
/** Actual coalesced/predicted input→finish, retaining every actual pressure knot. */
export function longCubicInputFixture(
  count?: number,
  varyingPressure?: boolean,
): PortableInkV2;
