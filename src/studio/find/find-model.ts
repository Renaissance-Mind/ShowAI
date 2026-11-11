/** A match inside one text segment: a block of text that a match cannot cross. */
export interface SegmentMatch {
  segment: number;
  start: number;
  end: number;
}

export interface FindOptions {
  caseSensitive: boolean;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The pattern a query searches for; literal text, no regular expressions. */
export function findPattern(query: string, options: FindOptions) {
  return query
    ? new RegExp(escape(query), options.caseSensitive ? "gu" : "giu")
    : null;
}

/** Every non-overlapping occurrence of the query, in segment order. */
export function findInSegments(
  segments: readonly string[],
  query: string,
  options: FindOptions,
): SegmentMatch[] {
  const pattern = findPattern(query, options);
  if (!pattern) return [];
  const matches: SegmentMatch[] = [];
  segments.forEach((text, segment) => {
    pattern.lastIndex = 0;
    for (let found = pattern.exec(text); found; found = pattern.exec(text))
      matches.push({
        segment,
        start: found.index,
        end: found.index + found[0].length,
      });
  });
  return matches;
}

/** The match to show after a step forward or back, wrapping at either end. */
export function stepMatch(current: number, count: number, direction: 1 | -1) {
  if (!count) return -1;
  if (current < 0) return direction > 0 ? 0 : count - 1;
  return (current + direction + count) % count;
}

/**
 * After the matches are found again, keep the current one near the place it
 * was: the first match at or after the previous match's start.
 */
export function nearestMatch(
  matches: readonly SegmentMatch[],
  previous: SegmentMatch | null,
) {
  if (!matches.length) return -1;
  if (!previous) return 0;
  const index = matches.findIndex(
    (match) =>
      match.segment > previous.segment ||
      (match.segment === previous.segment && match.start >= previous.start),
  );
  return index < 0 ? 0 : index;
}

/** A text range in one editor, as document positions. */
export interface EditorRange {
  from: number;
  to: number;
}

/**
 * Replacements for one editor, last first, so earlier positions stay valid
 * while a single transaction applies them. Overlapping ranges are dropped.
 */
export function replacementOrder(ranges: readonly EditorRange[]) {
  const sorted = [...ranges].sort((a, b) => b.from - a.from);
  const kept: EditorRange[] = [];
  for (const range of sorted) {
    const last = kept[kept.length - 1];
    if (last && range.to > last.from) continue;
    kept.push(range);
  }
  return kept;
}
