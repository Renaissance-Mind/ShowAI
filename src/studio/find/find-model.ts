export interface SegmentMatch {
  segment: number;
  start: number;
  end: number;
}

export interface FindOptions {
  caseSensitive: boolean;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findPattern(query: string, options: FindOptions) {
  return query
    ? new RegExp(escape(query), options.caseSensitive ? "gu" : "giu")
    : null;
}

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

export function stepMatch(current: number, count: number, direction: 1 | -1) {
  if (!count) return -1;
  if (current < 0) return direction > 0 ? 0 : count - 1;
  return (current + direction + count) % count;
}

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

export interface EditorRange {
  from: number;
  to: number;
}

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
