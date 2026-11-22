import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './style.css';

type Kind = 'dir' | 'file' | 'object' | 'array' | 'field';
type TreeNode = {
  name: string;
  kind?: Kind;
  type?: string;
  badge?: string;
  summary?: string;
  detail?: string;
  example?: string;
  exampleLang?: string;
  children?: TreeNode[];
  open?: boolean;
};
type Data = { nodes: TreeNode[]; initial?: string; caption?: string };
type Item = { node: TreeNode; path: string; depth: number; parent: string | null; kind: Kind; kids: string[] };

const DOCS = 'https://showai.renaissancemind.ai/doc';
const KIND_LABEL: Record<Kind, string> = { dir: '文件夹', file: '文件', object: '对象', array: '数组', field: '字段' };

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
    <div className="dk-tree-code">
      <div className="dk-tree-codebar">
        <span className="dk-tree-lang">{lang || '示例'}</span>
        <span className="dk-tree-copystate" aria-live="polite">{state === 'selected' ? '已选中，按 ⌘C / Ctrl+C 复制' : ''}</span>
        <button type="button" className={`dk-tree-copy${state === 'copied' ? ' is-done' : ''}`} onClick={copy}>
          {state === 'copied' ? (
            <><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5" /></svg>已复制</>
          ) : (
            <><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" /><path d="M10.5 3.5v-.4A1.6 1.6 0 0 0 8.9 1.5H4.1A1.6 1.6 0 0 0 2.5 3.1v4.8a1.6 1.6 0 0 0 1.6 1.6h.4" /></svg>复制</>
          )}
        </button>
      </div>
      <pre><code ref={ref}>{code}</code></pre>
    </div>
  );
}

/* ---------- tree model ---------- */
const seg = (name: string) => name.replace(/\/+$/, '') || name;
const kindOf = (n: TreeNode): Kind => n.kind ?? (n.children?.length ? 'dir' : 'file');
function index(nodes: TreeNode[]) {
  const items = new Map<string, Item>();
  const roots: string[] = [];
  const walk = (list: TreeNode[], parent: string | null, depth: number, into: string[]) => {
    for (const node of list ?? []) {
      let path = (parent ? parent + '/' : '') + seg(node.name);
      for (let n = 2; items.has(path); n++) path = (parent ? parent + '/' : '') + seg(node.name) + '~' + n;
      const item: Item = { node, path, depth, parent, kind: kindOf(node), kids: [] };
      items.set(path, item);
      into.push(path);
      if (node.children?.length) walk(node.children, path, depth + 1, item.kids);
    }
  };
  walk(nodes, null, 0, roots);
  return { items, roots };
}
function resolveInitial(items: Map<string, Item>, initial?: string) {
  if (!initial) return null;
  const clean = initial.split('/').map(seg).filter(Boolean).join('/');
  return items.has(clean) ? clean : null;
}

export function readData(data: Data) {
  const { items } = index(data.nodes);
  const list = [...items.values()];
  return {
    nodes: list.map((it) => ({
      path: it.path,
      depth: it.depth,
      kind: it.kind,
      type: it.node.type ?? null,
      badge: it.node.badge ?? null,
      summary: it.node.summary ?? null,
      children: it.kids.length,
      hasDetail: !!it.node.detail,
      hasExample: !!it.node.example,
    })),
    count: list.length,
    maxDepth: list.reduce((m, it) => Math.max(m, it.depth + 1), 0),
    initial: resolveInitial(items, data.initial),
    initialResolved: data.initial ? resolveInitial(items, data.initial) !== null : null,
    derived: true,
  };
}

/* ---------- icons ---------- */
function KindIcon({ kind, open }: { kind: Kind; open?: boolean }) {
  if (kind === 'dir')
    return (
      <svg className={`dk-tree-icon is-dir${open ? ' is-open' : ''}`} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h2.6l1.4 1.5h6c.69 0 1.25.56 1.25 1.25v6c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z" />
      </svg>
    );
  if (kind === 'file')
    return (
      <svg className="dk-tree-icon is-file" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 1.75h5.2L12.75 5.3v8.2c0 .41-.34.75-.75.75H4a.75.75 0 0 1-.75-.75V2.5c0-.41.34-.75.75-.75z" />
        <path d="M9 1.9v3.6h3.6" />
      </svg>
    );
  if (kind === 'object') return <span className="dk-tree-icon is-glyph is-object" aria-hidden="true">{'{}'}</span>;
  if (kind === 'array') return <span className="dk-tree-icon is-glyph is-array" aria-hidden="true">[ ]</span>;
  return (
    <svg className="dk-tree-icon is-field" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5" y="5" width="6" height="6" rx="1.5" transform="rotate(45 8 8)" />
    </svg>
  );
}
const Chevron = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.75L7.75 6 4.5 9.25" /></svg>
);

/* ---------- component ---------- */
export default function DocTree({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const { items, roots } = useMemo(() => index(data.nodes ?? []), [data.nodes]);

  const initialState = () => {
    const init = resolveInitial(items, data.initial);
    const open = new Set<string>();
    for (const it of items.values()) if (it.node.open && it.kids.length) open.add(it.path);
    let sel = init ?? roots[0] ?? null;
    if (init) {
      for (let p: string | null = init; p; p = items.get(p)!.parent) if (items.get(p)!.kids.length) open.add(p);
    } else if (!open.size && sel && items.get(sel)!.kids.length) open.add(sel);
    return { sel, open };
  };
  const [state, setState] = useState(initialState);
  useEffect(() => setState(initialState()), [items, data.initial]);
  const { sel, open } = state;
  const select = (path: string, toggle?: 'open' | 'close' | 'flip') =>
    setState((s) => {
      const next = new Set(s.open);
      if (toggle === 'open' || (toggle === 'flip' && !next.has(path))) next.add(path);
      else if (toggle === 'close' || toggle === 'flip') next.delete(path);
      return { sel: path, open: next };
    });
  const reveal = (path: string) =>
    setState((s) => {
      const next = new Set(s.open);
      for (let p = items.get(path)?.parent ?? null; p; p = items.get(p)!.parent) next.add(p);
      return { sel: path, open: next };
    });

  const visible = useMemo(() => {
    const out: Item[] = [];
    const walk = (paths: string[]) => {
      for (const p of paths) {
        const it = items.get(p)!;
        out.push(it);
        if (it.kids.length && open.has(p)) walk(it.kids);
      }
    };
    walk(roots);
    return out;
  }, [items, roots, open]);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const kbd = useRef(false);
  useLayoutEffect(() => {
    if (kbd.current && sel) rowRefs.current.get(sel)?.focus();
    kbd.current = false;
  }, [sel, visible]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!sel) return;
    const it = items.get(sel)!;
    const i = visible.findIndex((v) => v.path === sel);
    const go = (path?: string | null, toggle?: 'open' | 'close' | 'flip') => {
      e.preventDefault();
      if (!path) return;
      kbd.current = true;
      select(path, toggle);
    };
    switch (e.key) {
      case 'ArrowDown': return go(visible[i + 1]?.path);
      case 'ArrowUp': return go(visible[i - 1]?.path);
      case 'Home': return go(visible[0]?.path);
      case 'End': return go(visible[visible.length - 1]?.path);
      case 'ArrowRight':
        if (!it.kids.length) return e.preventDefault();
        return open.has(sel) ? go(it.kids[0]) : go(sel, 'open');
      case 'ArrowLeft':
        return it.kids.length && open.has(sel) ? go(sel, 'close') : go(it.parent);
      case 'Enter':
      case ' ':
        return it.kids.length ? go(sel, 'flip') : e.preventDefault();
    }
  };

  const cur = sel ? items.get(sel) : undefined;
  const crumbs: Item[] = [];
  for (let p = sel; p; p = items.get(p)!.parent) crumbs.unshift(items.get(p)!);

  return (
    <div className="dk dk-tree">
      <div className="dk-tree-frame">
        <div className="dk-tree-nav">
          <div className="dk-tree-list" role="tree" aria-label="结构" onKeyDown={onKey}>
            {visible.map((it) => {
              const isOpen = open.has(it.path);
              const isSel = it.path === sel;
              return (
                <div
                  key={it.path}
                  ref={(el) => { if (el) rowRefs.current.set(it.path, el); else rowRefs.current.delete(it.path); }}
                  role="treeitem"
                  aria-level={it.depth + 1}
                  aria-selected={isSel}
                  aria-expanded={it.kids.length ? isOpen : undefined}
                  tabIndex={isSel ? 0 : -1}
                  className={`dk-tree-row${isSel ? ' is-sel' : ''}`}
                  style={{ ['--d' as string]: it.depth }}
                  onClick={() => select(it.path, it.kids.length && (!isOpen || isSel) ? 'flip' : undefined)}
                >
                  {Array.from({ length: it.depth }, (_, g) => (
                    <i key={g} className="dk-tree-guide" style={{ ['--g' as string]: g }} aria-hidden="true" />
                  ))}
                  <span
                    className={`dk-tree-chev${it.kids.length ? '' : ' is-none'}${isOpen ? ' is-open' : ''}`}
                    onClick={(e) => { if (!it.kids.length) return; e.stopPropagation(); select(it.path, 'flip'); }}
                  >
                    {it.kids.length > 0 && <Chevron />}
                  </span>
                  <KindIcon kind={it.kind} open={isOpen} />
                  <span className="dk-tree-name">{it.node.name}</span>
                  {it.node.type && <span className="dk-tree-type">{it.node.type}</span>}
                  {it.node.badge && <span className="dk-tree-badge">{it.node.badge}</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="dk-tree-detail" aria-live="polite">
          {cur ? (
            <>
              <nav className="dk-tree-crumbs" aria-label="路径">
                {crumbs.map((c, i) => (
                  <React.Fragment key={c.path}>
                    {i > 0 && <span className="dk-tree-sep" aria-hidden="true">/</span>}
                    {i < crumbs.length - 1
                      ? <button type="button" onClick={() => select(c.path)}>{seg(c.node.name)}</button>
                      : <span aria-current="location">{seg(c.node.name)}</span>}
                  </React.Fragment>
                ))}
              </nav>
              <div className="dk-tree-title">
                <KindIcon kind={cur.kind} open={false} />
                <h4>{cur.node.name}</h4>
                {cur.node.type && <span className="dk-tree-dtype">{cur.node.type}</span>}
                {cur.node.badge && <span className="dk-tree-badge">{cur.node.badge}</span>}
              </div>
              <div className="dk-tree-meta">
                {KIND_LABEL[cur.kind]}
                {cur.kids.length > 0 && ` · ${cur.kids.length} 个子项`}
              </div>
              {cur.node.summary && <p className="dk-tree-summary">{md(cur.node.summary)}</p>}
              {cur.node.detail && <div className="dk-tree-body">{mdBlock(cur.node.detail, 'dk-tree-para')}</div>}
              {cur.node.example && <CodePanel key={cur.path} code={cur.node.example} lang={cur.node.exampleLang} />}
              {cur.kids.length > 0 && (
                <div className="dk-tree-kids">
                  <div className="dk-tree-kidshead">包含</div>
                  {cur.kids.map((k) => {
                    const kid = items.get(k)!;
                    return (
                      <button type="button" key={k} className="dk-tree-kid" onClick={() => reveal(k)}>
                        <KindIcon kind={kid.kind} />
                        <span className="dk-tree-kidname">{kid.node.name}</span>
                        {kid.node.summary && <span className="dk-tree-kidsum">{md(kid.node.summary.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1'))}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {!cur.node.summary && !cur.node.detail && !cur.node.example && !cur.kids.length && (
                <p className="dk-tree-empty">这一项没有更多说明。</p>
              )}
            </>
          ) : (
            <p className="dk-tree-empty">没有可显示的结构。</p>
          )}
        </div>
      </div>
      {data.caption && <p className="dk-tree-caption">{md(data.caption)}</p>}
    </div>
  );
}
