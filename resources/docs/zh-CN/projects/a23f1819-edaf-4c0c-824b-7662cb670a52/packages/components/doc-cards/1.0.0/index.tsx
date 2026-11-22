import React from 'react';
import './style.css';

type Tone = 'brand' | 'teal' | 'warm' | 'violet' | 'rose' | 'slate';
type Card = { icon?: string; title: string; body: string; href?: string; tag?: string; tone?: Tone };
type Data = { columns?: 2 | 3 | 4; variant?: 'tile' | 'row'; cards: Card[] };

// ---------------------------------------------------------------- shared markdown-lite (kept identical across the docs kit)
const DOCS = 'https://showai.renaissancemind.ai/doc';
/** `doc:slug#anchor` -> canonical docs URL; script URLs are dropped; anything else passes through. */
export function href(target: string) {
  const t = target.trim();
  if (/^(javascript|data|vbscript):/i.test(t)) return '#';
  if (!t.startsWith('doc:')) return t;
  const [slug, anchor] = t.slice(4).split('#');
  return DOCS + (slug ? `/${slug}` : '') + (anchor ? `#${anchor}` : '');
}
const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
/** **bold**, `code`, [label](href) -> React nodes. `links: false` renders link labels as text (inside another link). */
export function md(src: string, links = true, k = 'm'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = new RegExp(TOKEN.source, 'g');
  let pos = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > pos) out.push(src.slice(pos, m.index));
    const key = `${k}.${i++}`;
    if (m[1] !== undefined) out.push(<strong key={key}>{md(m[1], links, key)}</strong>);
    else if (m[2] !== undefined) out.push(<code key={key}>{m[2]}</code>);
    else if (links) out.push(<a key={key} href={href(m[4])}>{md(m[3], false, key)}</a>);
    else out.push(<span key={key}>{md(m[3], false, key)}</span>);
    pos = re.lastIndex;
  }
  if (pos < src.length) out.push(src.slice(pos));
  return out;
}
const plain = (s: string) => s.replace(TOKEN, (_, b, c, l) => b ?? c ?? l ?? '');

const TONES: Tone[] = ['brand', 'teal', 'warm', 'violet', 'rose', 'slate'];
const toneOf = (t?: string) => (TONES.includes(t as Tone) ? (t as Tone) : 'brand');

function columnsFor(data: Data) {
  const n = data.cards.length;
  if (data.columns) return data.columns;
  if ((data.variant ?? 'tile') === 'row') return n > 3 ? 2 : 1;
  return n === 4 ? 2 : Math.max(1, Math.min(3, n));
}

export function readData(data: Data) {
  return {
    variant: data.variant ?? 'tile',
    columns: columnsFor(data),
    cards: data.cards.map((c) => ({ title: c.title, body: plain(c.body), href: c.href ? href(c.href) : null, tag: c.tag ?? null })),
  };
}

const Arrow = () => (
  <svg className="dk-cards-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8.5 4l4 4-4 4" /></svg>
);

export default function DocCards({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const variant = data.variant === 'row' ? 'row' : 'tile';
  const cols = columnsFor(data);
  return (
    <div className={`dk dk-cards dk-cards--${variant}`} style={{ '--cols': cols } as React.CSSProperties} data-cols={cols}>
      <ul className="dk-cards-grid">
        {data.cards.map((c, i) => {
          const tone = toneOf(c.tone);
          const linked = !!c.href;
          const inner = variant === 'tile' ? (
            <>
              {(c.icon || c.tag) && (
                <span className="dk-cards-top">
                  {c.icon ? <span className="dk-cards-icon" aria-hidden="true">{c.icon}</span> : <span />}
                  {c.tag && <span className="dk-cards-tag">{c.tag}</span>}
                </span>
              )}
              <span className="dk-cards-title">
                <span>{c.title}</span>
                {linked && <Arrow />}
              </span>
              <span className="dk-cards-body">{md(c.body, !linked)}</span>
            </>
          ) : (
            <>
              {c.icon && <span className="dk-cards-icon" aria-hidden="true">{c.icon}</span>}
              <span className="dk-cards-text">
                <span className="dk-cards-title">
                  <span>{c.title}</span>
                  {c.tag && <span className="dk-cards-tag">{c.tag}</span>}
                </span>
                <span className="dk-cards-body">{md(c.body, !linked)}</span>
              </span>
              {linked && <Arrow />}
            </>
          );
          return (
            <li key={i} className={`dk-cards-item tone-${tone}`}>
              {linked
                ? <a className="dk-cards-card is-link" href={href(c.href!)}>{inner}</a>
                : <div className="dk-cards-card">{inner}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
