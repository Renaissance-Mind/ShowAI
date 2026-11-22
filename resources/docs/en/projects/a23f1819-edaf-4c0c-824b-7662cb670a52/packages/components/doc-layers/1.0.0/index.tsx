import React, { useMemo, useRef, useState } from 'react';
import './style.css';

type Tone = 'brand' | 'teal' | 'warm' | 'violet' | 'rose' | 'slate';
type Module = { name: string; path?: string; detail: string };
type Layer = { name: string; sub?: string; tone?: Tone; modules: Module[] };
type Data = { layers: Layer[]; caption?: string; initial?: string };

const TONES: Tone[] = ['brand', 'teal', 'warm', 'violet', 'rose', 'slate'];
/** Layers without a tone take these in order. */
const ORDER: Tone[] = ['brand', 'teal', 'violet', 'warm', 'rose', 'slate'];

/* ------------------------------------------------------------ markdown-lite (shared across the kit) */
const DOCS = 'https://showai.renaissancemind.ai/doc';
function linkHref(t: string): string | null {
  if (t.startsWith('doc:')) {
    const [slug, anchor] = t.slice(4).split('#');
    return DOCS + (slug ? `/${slug}` : '') + (anchor ? `#${anchor}` : '');
  }
  return /^(https?:|mailto:|#)/i.test(t) ? t : null;
}
const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
function inline(src: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = new RegExp(TOKEN.source, 'g');
  let pos = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > pos) out.push(src.slice(pos, m.index));
    const k = `${key}.${i++}`;
    if (m[1] != null) out.push(<strong key={k}>{inline(m[1], k)}</strong>);
    else if (m[2] != null) out.push(<code key={k}>{m[2]}</code>);
    else {
      const h = linkHref(m[4]);
      out.push(h ? <a key={k} href={h}>{inline(m[3], k)}</a> : <span key={k}>{inline(m[3], k)}</span>);
    }
    pos = re.lastIndex;
  }
  if (pos < src.length) out.push(src.slice(pos));
  return out;
}
/** Paragraphs split on newlines; **bold**, `code`, [label](href | doc:slug#anchor). Never injects HTML. */
export function md(src?: string): React.ReactNode {
  if (!src) return null;
  return src.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((p, i) => <p key={i}>{inline(p, `p${i}`)}</p>);
}

/* ------------------------------------------------------------ data */
type Clean = { layers: (Layer & { tone: Tone })[]; skipped: string[] };
function clean(data: Data): Clean {
  const skipped: string[] = [];
  const layers = (Array.isArray(data?.layers) ? data.layers : [])
    .filter((l) => {
      const ok = l && typeof l.name === 'string' && l.name.trim();
      if (!ok) skipped.push('layer without name');
      return ok;
    })
    .map((l, i) => ({
      ...l,
      tone: TONES.includes(l.tone as Tone) ? (l.tone as Tone) : ORDER[i % ORDER.length],
      modules: (Array.isArray(l.modules) ? l.modules : []).filter((m) => {
        const ok = m && typeof m.name === 'string' && m.name.trim();
        if (!ok) skipped.push(`${l.name}: module without name`);
        return ok;
      }),
    }));
  return { layers, skipped };
}
const keyOf = (li: number, mi: number) => `${li}:${mi}`;
function findInitial(c: Clean, initial?: string): string | null {
  if (!initial) return null;
  const [a, b] = initial.includes('/') ? initial.split('/', 2) : [null, initial];
  for (let li = 0; li < c.layers.length; li++) {
    if (a != null && c.layers[li].name !== a) continue;
    const mi = c.layers[li].modules.findIndex((m) => m.name === b);
    if (mi >= 0) return keyOf(li, mi);
  }
  return null;
}

export function readData(data: Data) {
  const c = clean(data);
  return {
    layers: c.layers.map((l, i) => ({
      order: i + 1, name: l.name, sub: l.sub ?? null, tone: l.tone,
      modules: l.modules.map((m) => ({ name: m.name, path: m.path ?? null })),
    })),
    moduleCount: c.layers.reduce((n, l) => n + l.modules.length, 0),
    initial: findInitial(c, data?.initial) ? data.initial : null,
    skipped: c.skipped,
  };
}

/* ------------------------------------------------------------ view */
export default function DocLayers({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const c = useMemo(() => clean(data), [data]);
  const init = useMemo(() => findInitial(c, data?.initial), [c, data?.initial]);
  const [sel, setSel] = useState<string | null>(init);
  const [seenInit, setSeenInit] = useState(init);
  if (seenInit !== init) { setSeenInit(init); setSel(init); }
  const refs = useRef(new Map<string, HTMLButtonElement | null>());

  if (!c.layers.length) {
    return (
      <div className="dk dk-layers">
        <div className="dk-layers-empty">{"No layering yet. exist"}<code>layers</code>{"Add layers and modules in top-down order."}</div>
      </div>
    );
  }

  const [sl, sm] = sel ? sel.split(':').map(Number) : [-1, -1];
  const layer = c.layers[sl], mod = layer?.modules[sm];

  const onKey = (e: React.KeyboardEvent, li: number, mi: number) => {
    let t: [number, number] | null = null;
    const row = c.layers[li].modules;
    if (e.key === 'ArrowRight') t = [li, Math.min(row.length - 1, mi + 1)];
    else if (e.key === 'ArrowLeft') t = [li, Math.max(0, mi - 1)];
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const d = e.key === 'ArrowDown' ? 1 : -1;
      for (let k = li + d; k >= 0 && k < c.layers.length; k += d) {
        if (c.layers[k].modules.length) { t = [k, Math.min(mi, c.layers[k].modules.length - 1)]; break; }
      }
    } else if (e.key === 'Escape') { setSel(null); return; }
    if (!t) return;
    e.preventDefault();
    const k = keyOf(t[0], t[1]);
    refs.current.get(k)?.focus();
    setSel(k);
  };

  return (
    <div className="dk dk-layers">
      <div className="dk-layers-top">
        {data?.caption ? <p className="dk-layers-caption">{inline(data.caption, 'cap')}</p> : <span />}
        <span className="dk-layers-hint">{"Click on the module to view the responsibilities and source code location"}</span>
      </div>
      <div className="dk-layers-stack">
        {c.layers.map((l, li) => (
          <React.Fragment key={li}>
            {li > 0 && (
              <div className="dk-layers-link" aria-hidden>
                <svg width="12" height="20" viewBox="0 0 12 20"><path d="M6 1v15" /><path d="M2.5 12.5 6 16.5l3.5-4" /></svg>
              </div>
            )}
            <section className="dk-layers-band" data-tone={l.tone} data-active={li === sl ? '' : undefined} aria-label={l.name}>
              <header className="dk-layers-head">
                <span className="dk-layers-idx">{li + 1}</span>
                <div>
                  <h4>{l.name}</h4>
                  {l.sub && <small>{l.sub}</small>}
                </div>
              </header>
              <div className="dk-layers-mods" role="group" aria-label={`Module of${l.name}`}>
                {l.modules.length ? l.modules.map((m, mi) => {
                  const k = keyOf(li, mi), on = sel === k;
                  return (
                    <button
                      key={mi}
                      type="button"
                      ref={(el) => { refs.current.set(k, el); }}
                      className="dk-layers-chip"
                      aria-pressed={on}
                      onClick={() => setSel(on ? null : k)}
                      onKeyDown={(e) => onKey(e, li, mi)}
                    >
                      <i aria-hidden />
                      {m.name}
                    </button>
                  );
                }) : <span className="dk-layers-none">{"(No module yet)"}</span>}
              </div>
            </section>
          </React.Fragment>
        ))}
      </div>
      <div className="dk-layers-panel" data-tone={layer?.tone} data-empty={mod ? undefined : ''} aria-live="polite">
        {mod ? (
          <>
            <div className="dk-layers-crumb"><span>{layer.name}</span><b>/</b><span>{mod.name}</span></div>
            <h4>{mod.name}</h4>
            {mod.path && <code className="dk-layers-path">{mod.path}</code>}
            <div className="dk-layers-md">{md(mod.detail)}</div>
          </>
        ) : (
          <p>{"Select any module above to see what it is responsible for and where the code is."}</p>
        )}
      </div>
    </div>
  );
}
