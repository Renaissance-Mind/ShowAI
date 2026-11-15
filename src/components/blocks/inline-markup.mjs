import { findNote, plainNotes } from "../../document/note-markup.mjs";
import { parsePageLink } from "../../document/page-link.mjs";

const INLINE =
  /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|==([^=\s](?:[^=]*?[^=\s])?)==/g;

export function isSafeHref(href) {
  if (
    typeof href !== "string" ||
    !href.trim() ||
    /[\s\u0000-\u001f]/.test(href)
  )
    return false;
  if (/^(https?:\/\/[^/]|mailto:)/i.test(href) || parsePageLink(href))
    return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//");
}

export const isExternalHref = (href) => /^https?:\/\//i.test(href);

export function parseInline(source) {
  const out = [];
  const pattern = new RegExp(INLINE.source, "g");
  let position = 0;
  let match;
  for (;;) {
    pattern.lastIndex = position;
    match = pattern.exec(source);
    const note = findNote(source, position);
    if (note && (!match || note.index <= match.index)) {
      if (note.index > position)
        out.push({ type: "text", text: source.slice(position, note.index) });
      out.push({
        type: "note",
        note: note.note,
        children: parseInline(note.label),
      });
      position = note.end;
      continue;
    }
    if (!match) break;
    if (match.index > position)
      out.push({ type: "text", text: source.slice(position, match.index) });
    if (match[1] !== undefined)
      out.push({ type: "strong", children: parseInline(match[1]) });
    else if (match[2] !== undefined) out.push({ type: "code", text: match[2] });
    else if (match[5] !== undefined)
      out.push({ type: "highlight", children: parseInline(match[5]) });
    else
      out.push({
        type: "link",
        href: match[4],
        children: parseInline(match[3]),
      });
    position = pattern.lastIndex;
  }
  if (position < source.length)
    out.push({ type: "text", text: source.slice(position) });
  return out;
}

export const plainInline = (source) =>
  plainNotes(source).replace(
    INLINE,
    (_, bold, code, label, _href, highlight) =>
      bold ?? code ?? label ?? highlight,
  );

export function unsafeInlineLinks(source) {
  const found = [];
  const visit = (segments) => {
    for (const segment of segments) {
      if (segment.type === "link" && !isSafeHref(segment.href))
        found.push(segment.href);
      if (segment.children) visit(segment.children);
    }
  };
  visit(parseInline(source));
  return found;
}
