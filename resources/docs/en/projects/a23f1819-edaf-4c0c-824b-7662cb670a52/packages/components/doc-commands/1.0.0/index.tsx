import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import './style.css';

type Flag = { flag: string; meaning: string };
type Command = { group: string; command: string; summary: string; detail?: string; flags?: Flag[]; example?: string };
type Group = { id: string; label: string };
type Data = { groups: Group[]; commands: Command[]; placeholder?: string };

const DOCS = 'https://showai.renaissancemind.ai/doc';
const ALL = '\u0000all';
const OTHER = '\u0000other';
const LIMIT = 6;

/* ---------- md(): **bold**, `code`, [label](href) as React elements (shared kit helper) ---------- */
const MD = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
function href(target: string): string | null {
  if (target.startsWith('doc:')) {
    const [slug, anchor] = target.slice(4).split('#');
    return DOCS + (slug ? `/${slug}` : '') + (anchor ? `#${anchor}` : '');
  }
  return /^(https?:|mailto:|#)/i.test(target) ? target : null;
}
export function md(source: string, key = 'm'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = new RegExp(MD.source, 'g');
  let pos = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m.index > pos) out.push(source.slice(pos, m.index));
    const k = `${key}.${i++}`;
    if (m[1] != null) out.push(<strong key={k}>{md(m[1], k)}</strong>);
    else if (m[2] != null) out.push(<code key={k}>{m[2]}</code>);
    else {
      const url = href(m[4]);
      out.push(url ? <a key={k} href={url}>{md(m[3], k)}</a> : <span key={k}>{md(m[3], k)}</span>);
    }
    pos = re.lastIndex;
  }
  if (pos < source.length) out.push(source.slice(pos));
  return out;
}
/** md() whose plain-text and code pieces also carry search highlights. */
function mdHL(source: string, terms: string[], key = 'q'): React.ReactNode[] {
  if (!terms.length) return md(source, key);
  const out: React.ReactNode[] = [];
  const re = new RegExp(MD.source, 'g');
  let pos = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m.index > pos) out.push(...highlight(source.slice(pos, m.index), terms, `${key}p${i}`));
    const k = `${key}.${i++}`;
    if (m[1] != null) out.push(<strong key={k}>{mdHL(m[1], terms, k)}</strong>);
    else if (m[2] != null) out.push(<code key={k}>{highlight(m[2], terms, k)}</code>);
    else out.push(<span key={k}>{mdHL(m[3], terms, k)}</span>);
    pos = re.lastIndex;
  }
  if (pos < source.length) out.push(...highlight(source.slice(pos), terms, `${key}e`));
  return out;
}
/** Paragraphs separated by blank lines; a paragraph whose lines all start with "- " becomes a list. */
function mdBlock(source: string, cls: string) {
  return source.trim().split(/\n\s*\n/).map((para, i) => {
    const lines = para.split('\n');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l)))
      return <ul key={i} className={cls}>{lines.map((l, j) => <li key={j}>{md(l.replace(/^\s*[-•]\s+/, ''), `${i}.${j}`)}</li>)}</ul>;
    return <p key={i} className={cls}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{md(l, `${i}.${j}`)}</React.Fragment>)}</p>;
  });
}

/* ---------- copy (clipboard API is denied in the sandbox) ---------- */
function copyText(text: string, target: HTMLElement | null): 'copied' | 'selected' {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    if (ok) return 'copied';
  } catch { /* fall through to manual selection */ }
  if (target) {
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  return 'selected';
}
function CodePanel({ code, lang }: { code: string; lang?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    const r = copyText(code, ref.current);
    setState(r);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), r === 'copied' ? 1500 : 4000);
  };
  return (
    <div className="dk-commands-code">
      <div className="dk-commands-codebar">
        <span className="dk-commands-lang">{lang || "Examples"}</span>
        <span className="dk-commands-copystate" aria-live="polite">{state === 'selected' ? "Selected, press ⌘C / Ctrl+C to copy" : ''}</span>
        <button type="button" className={`dk-commands-copy${state === 'copied' ? ' is-done' : ''}`} onClick={copy}>
          {state === 'copied' ? (
            <><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5" /></svg>{"Copied"}</>
          ) : (
            <><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" /><path d="M10.5 3.5v-.4A1.6 1.6 0 0 0 8.9 1.5H4.1A1.6 1.6 0 0 0 2.5 3.1v4.8a1.6 1.6 0 0 0 1.6 1.6h.4" /></svg>{"Copy"}</>
          )}
        </button>
      </div>
      <pre><code ref={ref}>{code}</code></pre>
    </div>
  );
}

/* ---------- search ---------- */
const termsOf = (q: string) => [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))];
type Range = [number, number];
function ranges(text: string, terms: string[]): Range[] {
  if (!terms.length) return [];
  const low = text.toLowerCase();
  const out: Range[] = [];
  for (const t of terms) for (let i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + t.length)) out.push([i, i + t.length]);
  out.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
/** Render text[from,to) with <mark> over the matched ranges. */
function marked(text: string, rs: Range[], from = 0, to = text.length, key = 'h'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let pos = from, n = 0;
  for (const [a, b] of rs) {
    if (b <= pos || a >= to) continue;
    const s = Math.max(a, pos), e = Math.min(b, to);
    if (s > pos) out.push(text.slice(pos, s));
    out.push(<mark key={`${key}${n++}`}>{text.slice(s, e)}</mark>);
    pos = e;
  }
  if (pos < to) out.push(text.slice(pos, to));
  return out;
}
function highlight(text: string, terms: string[], key = 'h') { return marked(text, ranges(text, terms), 0, text.length, key); }

/** Command line: program muted, sub-command verbs bold, flags and placeholders styled; matches highlighted across tokens. */
function CommandLine({ text, terms }: { text: string; terms: string[] }) {
  const rs = ranges(text, terms);
  const out: React.ReactNode[] = [];
  const re = /\S+/g;
  // name: the first token after an optional program prefix is always the command name (CLI sub-command
  // or an MCP tool name such as page_read / showai_capabilities). Tool names (with _ or .) end the name;
  // plain lowercase words after a CLI sub-command continue it ("pages read").
  let m: RegExpExecArray | null, pos = 0, verbs = true, first = true, named = false, i = 0;
  while ((m = re.exec(text))) {
    const tok = m[0], start = m.index, end = start + tok.length;
    if (start > pos) out.push(text.slice(pos, start));
    let cls: string;
    if (first && /^(showai|\.\/showai|showai\.cmd|npx|npm|node)$/.test(tok)) cls = 'prog';
    else if (!named && /^[A-Za-z_][\w.-]*$/.test(tok) && !/^[A-Z][A-Z0-9_]*$/.test(tok)) {
      cls = 'verb';
      named = true;
      if (/[_.]/.test(tok)) verbs = false;
    } else if (verbs && /^[a-z][a-z0-9-]*$/.test(tok)) cls = 'verb';
    else {
      verbs = false;
      cls = /^\[?-{1,2}[A-Za-z]/.test(tok) ? 'flag' : /^[\[<(]?[A-Z][A-Z0-9_]*(?:[|,.][A-Z0-9_]+)*[\]>)]?\]?$|^[\[<].*[\]>]$/.test(tok) ? 'ph' : 'arg';
    }
    first = false;
    out.push(<span key={i} className={`dk-commands-${cls}${tok.length > 32 ? ' is-long' : ''}`}>{marked(text, rs, start, end, `t${i}.`)}</span>);
    i++;
    pos = end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return <code className="dk-commands-cmd">{out}</code>;
}

type Indexed = Command & { key: string; groupKey: string; hay: { cmd: string; sum: string; flags: string[] } };
function prepare(data: Data): Indexed[] {
  const known = new Set((data.groups ?? []).map((g) => g.id));
  return (data.commands ?? []).map((c, i) => ({
    ...c,
    key: `${i}`,
    groupKey: known.has(c.group) ? c.group : OTHER,
    hay: {
      cmd: c.command.toLowerCase(),
      sum: c.summary.replace(/\*\*|`/g, '').toLowerCase(),
      flags: (c.flags ?? []).map((f) => `${f.flag} ${f.meaning}`.toLowerCase()),
    },
  }));
}
const matches = (c: Indexed, terms: string[]) =>
  terms.every((t) => c.hay.cmd.includes(t) || c.hay.sum.includes(t) || c.hay.flags.some((f) => f.includes(t)));

export function readData(data: Data) {
  const list = prepare(data);
  const groups = (data.groups ?? []).map((g) => ({ id: g.id, label: g.label, count: list.filter((c) => c.groupKey === g.id).length }));
  return {
    groups,
    total: list.length,
    ungrouped: list.filter((c) => c.groupKey === OTHER).map((c) => c.command),
    commands: list.map((c) => ({
      group: c.group,
      command: c.command,
      summary: c.summary,
      flags: (c.flags ?? []).map((f) => f.flag),
      hasDetail: !!c.detail,
      hasExample: !!c.example,
    })),
    derived: true,
  };
}

/* ---------- component ---------- */
export default function DocCommands({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const list = useMemo(() => prepare(data), [data]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>(ALL);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [more, setMore] = useState<Set<string>>(() => new Set());
  const q = useDeferredValue(query);
  const terms = useMemo(() => termsOf(q), [q]);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => (terms.length ? list.filter((c) => matches(c, terms)) : list), [list, terms]);
  const sections = useMemo(() => {
    const defs: { id: string; label: string }[] = [...(data.groups ?? [])];
    if (list.some((c) => c.groupKey === OTHER)) defs.push({ id: OTHER, label: "other" });
    return defs.map((g) => ({ ...g, total: list.filter((c) => c.groupKey === g.id).length, items: hits.filter((c) => c.groupKey === g.id) }));
  }, [data.groups, list, hits]);
  const shown = sections.filter((s) => (group === ALL || s.id === group) && s.items.length);
  const shownCount = shown.reduce((n, s) => n + s.items.length, 0);
  const activeLabel = sections.find((s) => s.id === group)?.label;

  const toggle = (key: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
  const clear = () => { setQuery(''); input.current?.focus(); };
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
    if (e.key === 'ArrowDown') {
      const first = listRef.current?.querySelector<HTMLButtonElement>('.dk-commands-row');
      if (first) { e.preventDefault(); first.focus(); }
    }
  };
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.dk-commands-row') ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) input.current?.focus();
    else rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const multi = shown.length > 1 || group === ALL;
  // In the unfiltered overview, long groups show their first LIMIT commands with a "show all" control.
  const capped = (id: string, n: number) => group === ALL && !terms.length && !more.has(id) && n > LIMIT + 2;

  return (
    <div className="dk dk-commands">
      <div className="dk-commands-search">
        <svg className="dk-commands-glass" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" /><path d="M10.4 10.4l3.3 3.3" /></svg>
        <input
          ref={input}
          type="search"
          value={query}
          placeholder={data.placeholder || "Search for a command, parameter or purpose"}
          aria-label={"search command"}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onSearchKey}
        />
        {query ? (
          <button type="button" className="dk-commands-clear" onClick={clear} aria-label={"Clear search"}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" /></svg>
          </button>
        ) : (
          <span className="dk-commands-total">{list.length}{"command"}</span>
        )}
      </div>

      <div className="dk-commands-chips" role="group" aria-label={"Filter by group"}>
        <button type="button" aria-pressed={group === ALL} onClick={() => setGroup(ALL)}>{"All"}<span>{hits.length}</span>
        </button>
        {sections.map((s) => {
          const n = s.items.length;
          return (
            <button type="button" key={s.id} aria-pressed={group === s.id} className={n ? '' : 'is-zero'} onClick={() => setGroup((g) => (g === s.id ? ALL : s.id))}>
              {s.label}<span>{n}</span>
            </button>
          );
        })}
      </div>

      {shownCount ? (
        <div className="dk-commands-list" ref={listRef} onKeyDown={onListKey}>
          {shown.map((s) => (
            <section key={s.id} className="dk-commands-section" aria-label={s.label}>
              {multi && (
                <div className="dk-commands-grouphead">
                  <span>{s.label}</span>
                  <span className="dk-commands-groupcount">{terms.length ? `${s.items.length} / ${s.total}` : s.total}</span>
                </div>
              )}
              <ul>
                {(capped(s.id, s.items.length) ? s.items.slice(0, LIMIT) : s.items).map((c) => {
                  const isOpen = open.has(c.key);
                  const id = `dk-commands-d${c.key}`;
                  const flagHits = terms.length
                    ? (c.flags ?? []).filter((f) => terms.some((t) => !c.hay.cmd.includes(t) && !c.hay.sum.includes(t) && `${f.flag} ${f.meaning}`.toLowerCase().includes(t)))
                    : [];
                  const expandable = !!(c.detail || c.flags?.length || c.example);
                  return (
                    <li key={c.key} className={`dk-commands-item${isOpen ? ' is-open' : ''}`}>
                      <button
                        type="button"
                        className="dk-commands-row"
                        aria-expanded={expandable ? isOpen : undefined}
                        aria-controls={expandable ? id : undefined}
                        onClick={() => expandable && toggle(c.key)}
                        data-static={expandable ? undefined : ''}
                      >
                        <span className="dk-commands-main">
                          <CommandLine text={c.command} terms={terms} />
                          <span className="dk-commands-summary">{mdHL(c.summary, terms)}</span>
                          {flagHits.length > 0 && (
                            <span className="dk-commands-flaghits">{"Parameters"}{flagHits.slice(0, 4).map((f) => <code key={f.flag}>{highlight(f.flag, terms)}</code>)}
                            </span>
                          )}
                        </span>
                        {expandable && (
                          <svg className="dk-commands-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.75L6 7.75 9 4.75" /></svg>
                        )}
                      </button>
                      {expandable && isOpen && (
                        <div className="dk-commands-detail" id={id}>
                          {c.detail && <div className="dk-commands-body">{mdBlock(c.detail, 'dk-commands-para')}</div>}
                          {c.flags && c.flags.length > 0 && (
                            <table className="dk-commands-flags">
                              <thead><tr><th scope="col">{"parameter"}</th><th scope="col">{"illustrate"}</th></tr></thead>
                              <tbody>
                                {c.flags.map((f) => (
                                  <tr key={f.flag}>
                                    <th scope="row"><code>{highlight(f.flag, terms)}</code></th>
                                    <td>{md(f.meaning)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {c.example && <CodePanel code={c.example} lang={"Examples"} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {capped(s.id, s.items.length) && (
                <button type="button" className="dk-commands-more" onClick={() => setMore((m) => new Set(m).add(s.id))}>{"Show the remaining "}{s.items.length - LIMIT}{"strip"}{s.label}{" commands"}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.75L6 7.75 9 4.75" /></svg>
                </button>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="dk-commands-empty" role="status">
          <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="18" cy="18" r="10" /><path d="M25.5 25.5l7 7" /><path d="M14 18h8" /></svg>
          <p className="dk-commands-emptytitle">
            {query.trim() ? <>{"Nothing to do with \""}{query.trim()}{"\"matching command"}{group !== ALL && activeLabel ? `（${activeLabel}）` : ''}</> : `There is no command in "${activeLabel ?? ''}"`}
          </p>
          <p className="dk-commands-emptyhint">{"Try shorter keywords, or search parameter names, e.g."}<code>--project</code>。</p>
          <div className="dk-commands-emptyactions">
            {group !== ALL && hits.length > 0 && (
              <button type="button" onClick={() => setGroup(ALL)}>{"View in all groups ("}{hits.length}{"strip)"}</button>
            )}
            {query && <button type="button" onClick={clear}>{"Clear search"}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
