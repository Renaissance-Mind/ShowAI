const SEPARATORS = /[\s\-_/.·:：（）()[\]【】,，、]/;

export function termScore(term: string, text: string): number {
  if (!term) return 1;
  if (text === term) return 1000;
  if (text.startsWith(term)) return 900 - Math.min(99, text.length - term.length);
  const index = text.indexOf(term);
  if (index > 0)
    return (SEPARATORS.test(text[index - 1]) ? 800 : 700) - Math.min(99, index);
  let score = 0,
    position = -1,
    run = 0;
  for (const letter of term) {
    const next = text.indexOf(letter, position + 1);
    if (next < 0) return 0;
    run = next === position + 1 ? run + 1 : 0;
    score +=
      1 + run * 3 + (next === 0 || SEPARATORS.test(text[next - 1]) ? 4 : 0);
    position = next;
  }
  if (term.length > 1 && score < term.length * 2) return 0;
  return Math.min(599, 100 + Math.round((score * 100) / (term.length * 8)));
}

export function titleScore(
  query: string,
  title: string,
  keywords = "",
): number {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const text = title.toLocaleLowerCase();
  const words = keywords.toLocaleLowerCase();
  const phrase = terms.length > 1 ? termScore(terms.join(" "), text) : 0;
  let total = 0;
  for (const term of terms) {
    const inTitle = termScore(term, text);
    const inKeywords =
      words && words.includes(term) ? 300 - Math.min(99, words.indexOf(term)) : 0;
    const best = Math.max(inTitle, inKeywords);
    if (!best) return 0;
    total += best;
  }
  return Math.max(phrase, Math.round(total / terms.length));
}

export function rankByTitle<T>(
  items: readonly T[],
  query: string,
  read: {
    title: (item: T) => string;
    keywords?: (item: T) => string;
    updatedAt?: (item: T) => string | undefined;
  },
  limit: number,
): T[] {
  const newest = (a: T, b: T) =>
    (read.updatedAt?.(b) ?? "").localeCompare(read.updatedAt?.(a) ?? "");
  if (!query.trim()) return [...items].sort(newest).slice(0, limit);
  return items
    .map((item) => ({
      item,
      score: titleScore(query, read.title(item), read.keywords?.(item)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || newest(a.item, b.item))
    .slice(0, limit)
    .map((entry) => entry.item);
}
