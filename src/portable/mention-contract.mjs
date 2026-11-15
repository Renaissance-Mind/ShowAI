export function isoDay(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
