// Days the @ menu offers for a component whose `contributes.mention` has
// `input: "date"`: today, tomorrow and typed dates. The declaration itself is
// validated with the other contributions (components/custom/contributions.ts).
// Shared by the editor and the date component; no dependencies.

/** YYYY-MM-DD of a local calendar day. */
export function isoDay(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Days a typed query names: an ISO day, a numeric month/day (with or without
 * year), or nothing. Relative words are matched by the menu's own labels.
 */
export function typedDays(query, today = new Date()) {
  const text = query.trim();
  const valid = (year, month, day) => {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? isoDay(date)
      : null;
  };
  let match = /^(\d{4})[-/.\u5e74](\d{1,2})[-/.\u6708](\d{1,2})\u65e5?$/.exec(text);
  if (match) {
    const day = valid(+match[1], +match[2], +match[3]);
    return day ? [day] : [];
  }
  match = /^(\d{1,2})[-/.\u6708](\d{1,2})\u65e5?$/.exec(text);
  if (match) {
    const day = valid(today.getFullYear(), +match[1], +match[2]);
    return day ? [day] : [];
  }
  return [];
}
