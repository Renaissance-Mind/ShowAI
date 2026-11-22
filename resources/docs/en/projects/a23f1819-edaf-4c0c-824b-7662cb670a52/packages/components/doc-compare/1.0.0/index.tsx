import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './style.css';

type Tone = 'brand' | 'teal' | 'warm' | 'violet' | 'rose' | 'slate';
type Value = boolean | string;
type Column = { id: string; label: string; sub?: string; tone?: Tone };
type Row = { label: string; hint?: string; group?: string; values: Record<string, Value> };
type Data = { columns: Column[]; rows: Row[]; highlight?: string; note?: string };

const DOCS = 'https://showai.renaissancemind.ai/doc';
const TONES: Tone[] = ['brand', 'teal', 'warm', 'violet', 'rose', 'slate'];
const tone = (t?: string): Tone => (TONES.includes(t as Tone) ? (t as Tone) : 'brand');

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

/* ---------- derived view ---------- */
type Section = { group?: string; rows: Row[] };
function sections(rows: Row[]): Section[] {
  const out: Section[] = [];
  const byGroup = new Map<string, Section>();
  for (const row of rows) {
    const g = row.group?.trim() || '';
    let s = byGroup.get(g);
    if (!s) {
      s = { group: g || undefined, rows: [] };
      byGroup.set(g, s);
      out.push(s);
    }
    s.rows.push(row);
  }
  return out;
}
const kindOf = (v: Value | undefined) =>
  v === true ? 'yes' : v === false ? 'no' : v === 'partial' ? 'partial' : v == null || v === '' ? 'empty' : 'text';

export function readData(data: Data) {
  const columns = data.columns.map((c) => {
    const counts = { yes: 0, partial: 0, no: 0, text: 0, empty: 0 };
    for (const r of data.rows) counts[kindOf(r.values[c.id])]++;
    return { id: c.id, label: c.label, supported: counts.yes, partial: counts.partial, unsupported: counts.no, text: counts.text, missing: counts.empty };
  });
  return {
    columns,
    groups: sections(data.rows).map((s) => ({ group: s.group ?? null, rows: s.rows.length })),
    rows: data.rows.map((r) => ({
      label: r.label,
      group: r.group ?? null,
      values: Object.fromEntries(data.columns.map((c) => {
        const v = r.values[c.id];
        return [c.id, v === true ? 'yes' : v === false ? 'no' : v === 'partial' ? 'partial' : v ?? null];
      })),
    })),
    unknownColumnKeys: [...new Set(data.rows.flatMap((r) => Object.keys(r.values)).filter((k) => !data.columns.some((c) => c.id === k)))],
    highlight: data.columns.some((c) => c.id === data.highlight) ? data.highlight : null,
    derived: true,
  };
}

/* ---------- cells ---------- */
function Mark({ value, t }: { value: Value | undefined; t: Tone }) {
  const k = kindOf(value);
  if (k === 'yes')
    return (
      <span className={`dk-compare-yes dk-compare-t-${t}`} role="img" aria-label={"support"}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.6 10.2l2.9 2.9 5.9-6.1" /></svg>
      </span>
    );
  if (k === 'no')
    return <span className="dk-compare-no" role="img" aria-label={"Not supported"} />;
  if (k === 'partial')
    return (
      <span className={`dk-compare-partial dk-compare-t-${t}`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 2a6 6 0 0 0 0 12z" /></svg>
        <span>{"part"}</span>
      </span>
    );
  if (k === 'empty') return <span className="dk-compare-empty" aria-label={"Not filled in"} />;
  return <span className="dk-compare-text">{md(String(value))}</span>;
}

export default function DocCompare({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const columns = data.columns ?? [];
  const valid = (id?: string) => (id && columns.some((c) => c.id === id) ? id : null);
  const [active, setActive] = useState<string | null>(() => valid(data.highlight));
  useEffect(() => setActive(valid(data.highlight)), [data.highlight, columns.map((c) => c.id).join('\u0000')]);

  const groups = useMemo(() => sections(data.rows ?? []), [data.rows]);
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge((p) => {
      const n = { left: el.scrollLeft > 1, right: max > 1 && el.scrollLeft < max - 1 };
      return n.left === p.left && n.right === p.right ? p : n;
    });
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure, columns.length]);

  const colClass = (c: Column) => `dk-compare-t-${tone(c.tone)}${active === c.id ? ' is-on' : ''}`;

  return (
    <div className="dk dk-compare" style={{ ['--dk-compare-cols' as string]: columns.length }}>
      <div className={`dk-compare-frame${edge.left ? ' at-scrolled' : ''}${edge.right ? ' has-more' : ''}`}>
        <div className="dk-compare-scroll" ref={scroller} onScroll={measure} tabIndex={edge.right || edge.left ? 0 : -1} aria-label={"Comparison table, scrollable horizontally"}>
          <table className="dk-compare-table">
            <colgroup>
              <col className="dk-compare-col-label" />
              {columns.map((c) => <col key={c.id} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="dk-compare-corner" scope="col"><span className="dk-compare-sr">{"Comparative item"}</span></th>
                {columns.map((c) => (
                  <th key={c.id} scope="col" className={`dk-compare-head ${colClass(c)}`}>
                    <button
                      type="button"
                      aria-pressed={active === c.id}
                      title={active === c.id ? "Unhighlight" : "Highlight this column"}
                      onClick={() => setActive((a) => (a === c.id ? null : c.id))}
                    >
                      <span className="dk-compare-label"><i className="dk-compare-dot" aria-hidden="true" />{c.label}</span>
                      {c.sub && <span className="dk-compare-sub">{c.sub}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((s, si) => (
              <tbody key={si}>
                {s.group && (
                  <tr className="dk-compare-group">
                    <th scope="colgroup" className="dk-compare-groupcell">
                      <span>{s.group}</span>
                    </th>
                    {columns.map((c) => <td key={c.id} className={colClass(c)} aria-hidden="true" />)}
                  </tr>
                )}
                {s.rows.map((r, ri) => (
                  <tr key={ri} className="dk-compare-row">
                    <th scope="row" className="dk-compare-rowhead">
                      <span className="dk-compare-rowlabel">{md(r.label)}</span>
                      {r.hint && <span className="dk-compare-hint">{md(r.hint)}</span>}
                    </th>
                    {columns.map((c) => (
                      <td key={c.id} className={`dk-compare-cell ${colClass(c)}`}>
                        <Mark value={r.values?.[c.id]} t={tone(c.tone)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <span className="dk-compare-fade" aria-hidden="true" />
      </div>
      {data.note && <p className="dk-compare-note">{md(data.note)}</p>}
    </div>
  );
}
